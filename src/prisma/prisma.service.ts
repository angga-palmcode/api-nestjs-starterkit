import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { Env } from '../config/env.schema';
import { HealthService } from '../health/health.service';

/**
 * Prisma client as a Nest provider. It connects lazily on the first query, so the
 * app boots (and `/healthz` answers) even if the database is down; `/readyz`
 * reports the database through a registered readiness check.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    config: ConfigService<Env, true>,
    private readonly health: HealthService,
  ) {
    super({ datasourceUrl: config.get('DATABASE_URL', { infer: true }) });
  }

  onModuleInit(): void {
    this.health.registerCheck('database', async () => {
      await this.$queryRaw`SELECT 1`;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
