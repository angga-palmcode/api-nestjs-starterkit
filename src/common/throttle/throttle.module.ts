import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModule,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { Env } from '../../config/env.schema';
import { THROTTLER_STORAGE_OVERRIDE } from './throttle.tokens';

/**
 * Global rate limiting. Counters are in memory per instance by default; with
 * `THROTTLE_STORAGE=redis` the redis module supplies a shared, fail-open storage.
 * Sensitive routes tighten limits with `@Throttle({ default: { limit, ttl } })`.
 * `THROTTLE_ENABLED=false` switches everything off (tests, local debugging).
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [
        ConfigService,
        { token: THROTTLER_STORAGE_OVERRIDE, optional: true },
      ],
      useFactory: (
        config: ConfigService<Env, true>,
        storage?: ThrottlerStorage | null,
      ) => {
        if (
          config.get('THROTTLE_STORAGE', { infer: true }) === 'redis' &&
          !storage
        ) {
          // e.g. src/redis/ was deleted but the flag is still set: fail at boot, not silently per-instance.
          throw new Error(
            'THROTTLE_STORAGE=redis requires the redis module (src/redis) to provide the storage',
          );
        }
        return {
          throttlers: [
            {
              ttl: config.get('THROTTLE_TTL_SECONDS', { infer: true }) * 1000,
              limit: config.get('THROTTLE_LIMIT', { infer: true }),
            },
          ],
          ...(storage ? { storage } : {}),
          skipIf: () => !config.get('THROTTLE_ENABLED', { infer: true }),
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ThrottleModule {}
