import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { HealthService } from '../../src/health/health.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PrismaMock, createPrismaMock } from './prisma-mock';
import { testEnv } from './test-env';

export interface CreateAppOptions<P = PrismaMock> {
  env?: Record<string, string>;
  extraModules?: Array<new () => unknown>;
  /** Extra provider overrides, e.g. `[{ provide: OTP_SENDER, useValue: fakeSender }]`. */
  overrides?: Array<{ provide: unknown; useValue: unknown }>;
  /** Use the real PrismaService (needs a migrated database). Default: an in-memory mock. */
  realDatabase?: boolean;
  /** Replaces PrismaService with this object (e.g. `createMemoryPrisma()`); returned as `prisma`. */
  prismaOverride?: P;
  /** Runs after `configureApp` and before `init()`, e.g. to register a test auth middleware. */
  beforeInit?: (app: NestExpressApplication) => void;
}

/**
 * Builds the real app (same `configureApp` as main.ts). Config is injected via
 * `ConfigService` so tests never mutate `process.env` (the real ConfigModule
 * validates env at import time). `ConfigService.get` prefers injected values over
 * `process.env`, so `options.env` always wins. */
export async function createApp<P = PrismaMock>(
  options: CreateAppOptions<P> = {},
) {
  const config = new ConfigService(
    testEnv({
      ...(process.env.DATABASE_URL
        ? { DATABASE_URL: process.env.DATABASE_URL }
        : {}),
      ...options.env,
    }),
  );
  const prisma = (options.prismaOverride ?? createPrismaMock()) as P;

  let builder = Test.createTestingModule({
    imports: [AppModule, ...(options.extraModules ?? [])],
  })
    .overrideProvider(ConfigService)
    .useValue(config);
  if (!options.realDatabase) {
    builder = builder.overrideProvider(PrismaService).useValue(prisma);
  }
  for (const o of options.overrides ?? []) {
    builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  options.beforeInit?.(app);
  await app.init();
  return { app, health: app.get(HealthService), prisma };
}
