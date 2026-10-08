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
 * Optional module. `REDIS_CLIENT` is `null` when `REDIS_URL` is unset, so injecting it is
 * always safe. With `THROTTLE_STORAGE=redis` it also provides the shared, fail-open throttle
 * storage. The client never queues commands while disconnected and keeps reconnecting with a
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
            logger.warn(`Redis connection error: ${error.message}`, 'Redis');
          }
        });
        return client;
      },
    },
    {
      provide: THROTTLER_STORAGE_OVERRIDE,
      inject: [ConfigService, REDIS_CLIENT, AppLogger],
      useFactory: (
        config: ConfigService<Env, true>,
        client: Redis | null,
        logger: AppLogger,
      ) =>
        config.get('THROTTLE_STORAGE', { infer: true }) === 'redis' && client
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
