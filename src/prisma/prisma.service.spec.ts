import { ConfigService } from '@nestjs/config';
import { HealthService } from '../health/health.service';
import { PrismaService } from './prisma.service';
import { notDeleted, softDeleteData } from './soft-delete';

describe('PrismaService', () => {
  const config = new ConfigService({
    DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  }) as never;

  it('registers a database readiness check on init (connects lazily)', async () => {
    const health = new HealthService();
    const prisma = new PrismaService(config, health);
    const query = jest
      .spyOn(prisma, '$queryRaw')
      .mockResolvedValue([{ '?column?': 1 }] as never);

    prisma.onModuleInit();
    await expect(health.readiness()).resolves.toEqual({
      ready: true,
      checks: { database: 'up' },
    });
    expect(query).toHaveBeenCalled();

    query.mockRejectedValue(new Error('connection refused'));
    await expect(health.readiness()).resolves.toMatchObject({
      ready: false,
      checks: { database: 'down' },
    });
  });

  it('disconnects on destroy', async () => {
    const prisma = new PrismaService(config, new HealthService());
    const disconnect = jest
      .spyOn(prisma, '$disconnect')
      .mockResolvedValue(undefined);
    await prisma.onModuleDestroy();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe('soft delete helpers', () => {
  it('notDeleted filters on deleted_at null', () => {
    expect(notDeleted).toEqual({ deleted_at: null });
  });

  it('softDeleteData stamps deleted_at and the actor', () => {
    const data = softDeleteData('u-1');
    expect(data.deleted_at).toBeInstanceOf(Date);
    expect(data.updated_by).toBe('u-1');
    expect(softDeleteData()).not.toHaveProperty('updated_by');
  });
});
