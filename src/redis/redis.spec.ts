import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { THROTTLER_STORAGE_OVERRIDE } from '../common/throttle/throttle.tokens';
import { ThrottleModule } from '../common/throttle/throttle.module';
import { AppLogger } from '../common/logger/app.logger';
import { createApp } from '../../test/helpers/create-app';
import { baseEnv, testEnv } from '../../test/helpers/test-env';
import { validateEnv } from '../config/env.schema';
import {
  FailOpenThrottlerStorage,
  RedisThrottlerStorage,
} from './redis-throttler.storage';
import { REDIS_CLIENT, RedisModule, describeRedisError } from './redis.module';

describe('RedisThrottlerStorage', () => {
  it('runs the script atomically with namespaced keys and maps the reply', async () => {
    const evalFn = jest.fn().mockResolvedValue([3, 42_000, 0, 0]);
    const storage = new RedisThrottlerStorage({ eval: evalFn }, 'app');

    const record = await storage.increment(
      '1.2.3.4-ctrl-handler',
      60_000,
      5,
      0,
      'default',
    );

    expect(record).toEqual({
      totalHits: 3,
      timeToExpire: 42,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    const [script, numKeys, hitsKey, blockKey, ttl, limit, block] = evalFn.mock
      .calls[0] as [string, number, string, string, number, number, number];
    expect(script).toContain('INCR');
    expect(numKeys).toBe(2);
    expect(hitsKey).toBe('app:default:1.2.3.4-ctrl-handler');
    expect(blockKey).toBe('app:default:1.2.3.4-ctrl-handler:blocked');
    expect([ttl, limit, block]).toEqual([60_000, 5, 0]);
  });

  it('reports a blocked client with the seconds left (rounded up)', async () => {
    const storage = new RedisThrottlerStorage({
      eval: jest.fn().mockResolvedValue([6, 30_000, 1, 1_500]),
    });
    await expect(
      storage.increment('k', 60_000, 5, 2_000, 'default'),
    ).resolves.toEqual({
      totalHits: 6,
      timeToExpire: 30,
      isBlocked: true,
      timeToBlockExpire: 2,
    });
  });

  it('rejects a malformed script reply (so the fail-open wrapper can take over)', async () => {
    const storage = new RedisThrottlerStorage({
      eval: jest.fn().mockResolvedValue('OK'),
    });
    await expect(storage.increment('k', 1, 1, 0, 'default')).rejects.toThrow(
      /Unexpected reply/,
    );
  });
});

describe('FailOpenThrottlerStorage', () => {
  const logger = { warn: jest.fn(), log: jest.fn() };
  const down = (): ThrottlerStorage => ({
    increment: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  });
  beforeEach(() => jest.clearAllMocks());

  it('uses the primary when it works', async () => {
    const record = {
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
    const primary = { increment: jest.fn().mockResolvedValue(record) };
    const fallback = { increment: jest.fn() };
    const storage = new FailOpenThrottlerStorage(primary, fallback, logger);
    await expect(storage.increment('k', 60_000, 5, 0, 'default')).resolves.toBe(
      record,
    );
    expect(fallback.increment).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps enforcing limits per instance when Redis is down', async () => {
    const storage = new FailOpenThrottlerStorage(
      down(),
      new ThrottlerStorageService(),
      logger,
    );
    const hits: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      hits.push(
        (await storage.increment('k', 60_000, 2, 0, 'default')).isBlocked,
      );
    }
    expect(hits).toEqual([false, false, true, true]);
  });

  it('logs the outage once per interval, and the recovery', async () => {
    let healthy = false;
    const primary: ThrottlerStorage = {
      increment: jest.fn().mockImplementation(() =>
        healthy
          ? Promise.resolve({
              totalHits: 1,
              timeToExpire: 1,
              isBlocked: false,
              timeToBlockExpire: 0,
            })
          : Promise.reject(new Error('ECONNREFUSED')),
      ),
    };
    const storage = new FailOpenThrottlerStorage(
      primary,
      new ThrottlerStorageService(),
      logger,
      60_000,
    );
    for (let i = 0; i < 5; i++)
      await storage.increment('k', 1000, 100, 0, 'default');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'throttler_redis_unavailable_using_memory',
      }),
      'Throttle',
    );

    healthy = true;
    await storage.increment('k', 1000, 100, 0, 'default');
    await storage.increment('k', 1000, 100, 0, 'default');
    expect(logger.log).toHaveBeenCalledTimes(1); // "recovered" is logged once
  });
});

describe('RedisModule', () => {
  const compile = (env: Record<string, string>) => {
    @Global()
    @Module({
      providers: [
        { provide: AppLogger, useValue: { warn: jest.fn(), log: jest.fn() } },
        { provide: ConfigService, useValue: new ConfigService(testEnv(env)) },
      ],
      exports: [AppLogger, ConfigService],
    })
    class FakeCoreModule {}
    return Test.createTestingModule({
      imports: [FakeCoreModule, RedisModule],
    }).compile();
  };

  it('has no client and no storage override without REDIS_URL', async () => {
    const moduleRef = await compile({});
    expect(moduleRef.get(REDIS_CLIENT)).toBeNull();
    expect(moduleRef.get(THROTTLER_STORAGE_OVERRIDE)).toBeNull();
    await moduleRef.close();
  });

  it('with a URL it has a client but keeps the memory storage unless THROTTLE_STORAGE=redis', async () => {
    const moduleRef = await compile({ REDIS_URL: 'redis://127.0.0.1:1' });
    expect(moduleRef.get(REDIS_CLIENT)).not.toBeNull();
    expect(moduleRef.get(THROTTLER_STORAGE_OVERRIDE)).toBeNull();
    await moduleRef.close();
  });

  it('provides the fail-open Redis storage when THROTTLE_STORAGE=redis', async () => {
    const moduleRef = await compile({
      REDIS_URL: 'redis://127.0.0.1:1',
      THROTTLE_STORAGE: 'redis',
    });
    expect(moduleRef.get(THROTTLER_STORAGE_OVERRIDE)).toBeInstanceOf(
      FailOpenThrottlerStorage,
    );
    await moduleRef.close();
  });
});

describe('THROTTLE_STORAGE=redis wiring', () => {
  const env = (o: Record<string, string | undefined>) =>
    validateEnv({ ...baseEnv, ...o });

  it('needs REDIS_URL (boot-time validation)', () => {
    expect(() => env({ THROTTLE_STORAGE: 'redis' })).toThrow(/REDIS_URL/);
    expect(() =>
      env({ THROTTLE_STORAGE: 'redis', REDIS_URL: 'redis://localhost:6379' }),
    ).not.toThrow();
  });

  it('refuses to boot when the redis module is missing (storage not provided)', async () => {
    const attempt = Test.createTestingModule({ imports: [ThrottleModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService(
          testEnv({ THROTTLE_STORAGE: 'redis', REDIS_URL: 'redis://x' }),
        ),
      )
      .compile();
    await expect(attempt).rejects.toBeDefined();
  });

  it('the app keeps rate limiting through the fail-open storage while Redis is down', async () => {
    const storage = new FailOpenThrottlerStorage(
      { increment: () => Promise.reject(new Error('ECONNREFUSED')) },
      new ThrottlerStorageService(),
      { warn: jest.fn(), log: jest.fn() },
    );
    const { app } = await createApp({
      env: {
        THROTTLE_ENABLED: 'true',
        THROTTLE_STORAGE: 'redis',
        REDIS_URL: 'redis://127.0.0.1:1',
      },
      overrides: [{ provide: THROTTLER_STORAGE_OVERRIDE, useValue: storage }],
    });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push(
        (
          await request(app.getHttpServer())
            .post('/auth/forgot-password')
            .send({ email: 'a@example.com' })
        ).status,
      );
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429, 429]);
    await app.close();
  });
});

describe('describeRedisError', () => {
  it('uses the message when there is one', () => {
    expect(describeRedisError(new Error('boom'))).toBe('boom');
  });

  it('explains an empty AggregateError (IPv4 + IPv6 refused) by its codes', () => {
    const refused = (code: string) => Object.assign(new Error(''), { code });
    const aggregate = Object.assign(new Error(''), {
      name: 'AggregateError',
      errors: [refused('ECONNREFUSED'), refused('ECONNREFUSED')],
    });
    expect(describeRedisError(aggregate)).toBe('ECONNREFUSED');
  });

  it('falls back to the error code, then the name', () => {
    expect(
      describeRedisError(Object.assign(new Error(''), { code: 'ETIMEDOUT' })),
    ).toBe('ETIMEDOUT');
    expect(describeRedisError(new Error(''))).toBe('Error');
  });
});
