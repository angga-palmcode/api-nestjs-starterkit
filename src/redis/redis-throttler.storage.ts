import type { ThrottlerStorage } from '@nestjs/throttler';
import type { LoggerService } from '@nestjs/common';

/** The record shape (the package does not export the type from its entry point). */
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

/** The one ioredis method we need (also what tests fake). */
export interface RedisLike {
  eval(
    script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

/**
 * Atomic fixed-window counter. KEYS: hits key, block key. ARGV: window ms, limit, block ms.
 * Returns { hits, windowTtlMs, blocked (0|1), blockTtlMs }.
 */
const SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { current, redis.call('PTTL', KEYS[1]), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
if hits > tonumber(ARGV[2]) then
  local blockMs = tonumber(ARGV[3])
  if blockMs > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', blockMs)
    return { hits, ttl, 1, blockMs }
  end
  return { hits, ttl, 1, ttl }
end
return { hits, ttl, 0, 0 }
`;

const seconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

/** Throttle counters shared by every app instance. Fixed window, one round trip per hit. */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = 'throttle',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}:${throttlerName}:${key}`;
    const reply = (await this.redis.eval(
      SCRIPT,
      2,
      base,
      `${base}:blocked`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];
    if (!Array.isArray(reply) || reply.length !== 4) {
      throw new Error('Unexpected reply from Redis throttler script');
    }
    const [hits, windowTtl, blocked, blockTtl] = reply.map(Number);
    return {
      totalHits: hits,
      timeToExpire: seconds(windowTtl),
      isBlocked: blocked === 1,
      timeToBlockExpire: blocked === 1 ? seconds(blockTtl) : 0,
    };
  }
}

/**
 * Redis is a convenience, not a dependency: when it errors the request is counted by the
 * per-instance fallback instead of failing (rate limiting degrades, the API stays up).
 * Recovery is automatic on the next healthy call. The warning is logged at most once per `logEveryMs`.
 */
export class FailOpenThrottlerStorage implements ThrottlerStorage {
  private lastWarning = 0;
  private degraded = false;

  constructor(
    private readonly primary: ThrottlerStorage,
    private readonly fallback: ThrottlerStorage,
    private readonly logger: Pick<LoggerService, 'warn' | 'log'>,
    private readonly logEveryMs = 30_000,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const record = await this.primary.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
      if (this.degraded) {
        this.degraded = false;
        this.logger.log('Redis throttler storage recovered', 'Throttle');
      }
      return record;
    } catch (error) {
      this.degraded = true;
      const now = Date.now();
      if (now - this.lastWarning >= this.logEveryMs) {
        this.lastWarning = now;
        this.logger.warn(
          {
            message: 'throttler_redis_unavailable_using_memory',
            error: error instanceof Error ? error.message : String(error),
          },
          'Throttle',
        );
      }
      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }
}
