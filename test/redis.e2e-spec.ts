import Redis from 'ioredis';
import { ThrottlerStorageService } from '@nestjs/throttler';
import {
  FailOpenThrottlerStorage,
  RedisThrottlerStorage,
} from '../src/redis/redis-throttler.storage';

/**
 * Checks the Lua script against a real Redis (it cannot be verified by the unit tests).
 * Runs only with RUN_DB_TESTS=true and REDIS_URL set (CI provides both):
 *   docker compose up -d && RUN_DB_TESTS=true REDIS_URL=redis://localhost:6379 npm run test:e2e
 */
const enabled = process.env.RUN_DB_TESTS === 'true' && !!process.env.REDIS_URL;
const suite = enabled ? describe : describe.skip;

const run = `e2e-${Date.now()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('Redis throttler storage against a real Redis', () => {
  let redis: Redis;
  const prefix = `throttle-test-${run}`;
  const storage = () => new RedisThrottlerStorage(redis, prefix);

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL as string);
  });
  afterAll(async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('counts hits and blocks above the limit', async () => {
    const s = storage();
    const records = [];
    for (let i = 0; i < 4; i++) {
      records.push(await s.increment('count', 60_000, 3, 0, 'default'));
    }
    expect(records.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
    expect(records.map((r) => r.isBlocked)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(records[0].timeToExpire).toBeGreaterThan(55);
    expect(records[3].timeToBlockExpire).toBeGreaterThan(0);
  });

  it('is shared between instances (two app replicas see one counter)', async () => {
    const a = storage();
    const b = storage();
    await a.increment('shared', 60_000, 2, 0, 'default');
    await b.increment('shared', 60_000, 2, 0, 'default');
    const third = await a.increment('shared', 60_000, 2, 0, 'default');
    expect(third).toMatchObject({ totalHits: 3, isBlocked: true });
  });

  it('keeps separate counters per throttler name and per key', async () => {
    const s = storage();
    await s.increment('iso', 60_000, 5, 0, 'default');
    await s.increment('iso', 60_000, 5, 0, 'default');
    expect((await s.increment('iso', 60_000, 5, 0, 'other')).totalHits).toBe(1);
    expect(
      (await s.increment('iso-2', 60_000, 5, 0, 'default')).totalHits,
    ).toBe(1);
  });

  it('the window expires', async () => {
    const s = storage();
    await s.increment('window', 400, 1, 0, 'default');
    expect((await s.increment('window', 400, 1, 0, 'default')).isBlocked).toBe(
      true,
    );
    await sleep(600);
    expect(await s.increment('window', 400, 1, 0, 'default')).toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });

  it('blockDuration keeps a client blocked after the window ends', async () => {
    const s = storage();
    await s.increment('block', 300, 1, 1_500, 'default');
    const blocked = await s.increment('block', 300, 1, 1_500, 'default');
    expect(blocked.isBlocked).toBe(true);
    await sleep(500); // window over, block (1.5s) still active
    const still = await s.increment('block', 300, 1, 1_500, 'default');
    expect(still.isBlocked).toBe(true);
    expect(still.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('has a TTL on every key (no counter can live forever)', async () => {
    await storage().increment('ttl', 5_000, 10, 0, 'default');
    expect(await redis.pttl(`${prefix}:default:ttl`)).toBeGreaterThan(0);
  });

  it('fails open: with an unreachable Redis the fallback still limits', async () => {
    const dead = new Redis('redis://127.0.0.1:1', {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    dead.on('error', () => undefined);
    const failOpen = new FailOpenThrottlerStorage(
      new RedisThrottlerStorage(dead),
      new ThrottlerStorageService(),
      { warn: () => undefined, log: () => undefined },
    );
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        (await failOpen.increment('down', 60_000, 2, 0, 'default')).isBlocked,
      );
    }
    expect(results).toEqual([false, false, true]);
    dead.disconnect();
  });
});
