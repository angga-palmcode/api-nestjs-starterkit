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
 * Global rate limiting. Counters are in memory per instance by default; when `REDIS_URL` is set
 * the redis module supplies a shared, fail-open storage instead.
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
