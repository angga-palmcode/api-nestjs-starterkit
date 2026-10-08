import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorageService } from '@nestjs/throttler';
import Redis from 'ioredis';
import { AppLogger } from '../common/logger/app.logger';
import { THROTTLER_STORAGE_OVERRIDE } from '../common/throttle/throttle.tokens';
import { Env } from '../config/env.schema';
import {
  FailOpenThrottlerStorage,
  RedisThrottlerStorage,
} from './redis-throttler.storage';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * A readable reason for a connection error. When both IPv4 and IPv6 are refused ioredis
 * throws an `AggregateError` with an empty message; show the underlying codes instead.
 */
export function describeRedisError(error: Error): string {
  if (error.message) return error.message;
  const inner = (error as { errors?: unknown }).errors;
  const codes = Array.isArray(inner)
    ? inner.map((e: unknown) => {
        const err = e as NodeJS.ErrnoException;
        return err.code ?? err.message ?? 'unknown';
      })
    : [];
  const code = (error as NodeJS.ErrnoException).code;
  return [...new Set(codes)].join(', ') || code || error.name;
}

/**
 * Optional module. `REDIS_CLIENT` is `null` when `REDIS_URL` is unset, so injecting it is
 * always safe. When `REDIS_URL` is set (the only switch) it also provides the shared, fail-open
 * throttle storage. The client never queues commands while disconnected and keeps reconnecting with a
 * capped back-off, so a Redis outage costs a request nothing but a fallback to memory.
 * Deleting `src/redis/` is supported (docs/how-to/optional-modules.md).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService, AppLogger],
      useFactory: (
        config: ConfigService<Env, true>,
        logger: AppLogger,
      ): Redis | null => {
        const url = config.get('REDIS_URL', { infer: true });
        if (!url) return null;
        const client = new Redis(url, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 3_000,
          retryStrategy: (times) => Math.min(times * 200, 5_000),
        });
        let lastLogged = 0;
        client.on('error', (error: Error) => {
          const now = Date.now();
          if (now - lastLogged > 30_000) {
            lastLogged = now;
            logger.warn(
              `Redis connection error: ${describeRedisError(error)} (REDIS_URL is set but Redis is unreachable; rate limits fall back to per-instance memory)`,
              'Redis',
            );
          }
        });
        return client;
      },
    },
    {
      provide: THROTTLER_STORAGE_OVERRIDE,
      inject: [REDIS_CLIENT, AppLogger],
      useFactory: (client: Redis | null, logger: AppLogger) =>
        client
          ? new FailOpenThrottlerStorage(
              new RedisThrottlerStorage(client),
              new ThrottlerStorageService(),
              logger,
            )
          : null,
    },
  ],
  exports: [REDIS_CLIENT, THROTTLER_STORAGE_OVERRIDE],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client && this.client.status !== 'end') {
      await this.client.quit().catch(() => this.client?.disconnect());
    }
  }
}
