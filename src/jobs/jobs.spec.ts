import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../common/logger/app.logger';
import { PrismaService } from '../prisma/prisma.service';
import { createApp } from '../../test/helpers/create-app';
import {
  MemoryPrisma,
  createMemoryPrisma,
} from '../../test/helpers/memory-prisma';
import { testEnv } from '../../test/helpers/test-env';
import { CleanupJob } from './cleanup.job';

const DAY = 86_400_000;
const NOW = new Date('2026-10-08T03:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

describe('CleanupJob', () => {
  let prisma: MemoryPrisma;
  let logger: { log: jest.Mock; error: jest.Mock };
  let userId: string;

  const make = (env: Record<string, string> = {}) =>
    new CleanupJob(
      prisma as unknown as PrismaService,
      new AuditService(
        prisma as unknown as PrismaService,
        logger as unknown as AppLogger,
      ),
      logger as unknown as AppLogger,
      new ConfigService(testEnv(env)) as never,
    );

  beforeEach(async () => {
    prisma = createMemoryPrisma();
    logger = { log: jest.fn(), error: jest.fn() };
    userId = ((await prisma.seedUser()) as { id: string }).id;
  });

  const seed = async () => {
    const session = (await prisma.userSession.create({
      data: { user_id: userId, revoked_at: ago(40) },
    })) as { id: string };
    const liveSession = (await prisma.userSession.create({
      data: { user_id: userId, revoked_at: ago(5) },
    })) as { id: string };
    const family = 'f0000000-0000-4000-8000-000000000001';
    const token = (hash: string, expires_at: Date) =>
      prisma.refreshToken.create({
        data: {
          user_id: userId,
          session_id: liveSession.id,
          family_id: family,
          token_hash: hash,
          expires_at,
        },
      });
    await token('old', ago(45)); // expired long ago -> delete
    await token('recent', ago(2)); // expired recently -> keep (inside retention)
    await token('valid', ahead(3)); // still valid -> keep
    await prisma.passwordResetToken.create({
      data: { user_id: userId, token_hash: 'r-old', expires_at: ago(31) },
    });
    await prisma.passwordResetToken.create({
      data: { user_id: userId, token_hash: 'r-new', expires_at: ahead(1) },
    });
    await prisma.otpToken.create({
      data: {
        user_id: userId,
        purpose: 'login',
        code_hash: 'x',
        expires_at: ago(60),
      },
    });
    await prisma.otpToken.create({
      data: {
        user_id: userId,
        purpose: 'login',
        code_hash: 'y',
        expires_at: ahead(1),
      },
    });
    await prisma.userInvitation.create({
      data: {
        email: 'old@example.com',
        token_hash: 'i-old',
        expires_at: ago(50),
      },
    });
    await prisma.userInvitation.create({
      data: {
        email: 'done@example.com',
        token_hash: 'i-done',
        expires_at: ago(50),
        accepted_at: ago(55),
      },
    });
    return { staleSession: session.id, recentSession: liveSession.id };
  };

  it('deletes what expired beyond the retention window and keeps the rest', async () => {
    const { staleSession, recentSession } = await seed();
    const result = await make().run(NOW);

    expect(result).toEqual({
      refresh_tokens: 1,
      password_reset_tokens: 1,
      otp_tokens: 1,
      invitations: 1, // the accepted invitation is kept as history
      sessions: 1,
    });
    expect(prisma.refreshToken.rows.map((r) => r.token_hash).sort()).toEqual([
      'recent',
      'valid',
    ]);
    expect(prisma.passwordResetToken.rows.map((r) => r.token_hash)).toEqual([
      'r-new',
    ]);
    expect(prisma.otpToken.rows.map((r) => r.code_hash)).toEqual(['y']);
    expect(prisma.userInvitation.rows.map((r) => r.token_hash)).toEqual([
      'i-done',
    ]);
    const sessions = prisma.userSession.rows.map((r) => r.id);
    expect(sessions).not.toContain(staleSession);
    expect(sessions).toContain(recentSession);
  });

  it('honours JOBS_RETENTION_DAYS', async () => {
    await seed();
    const result = await make({ JOBS_RETENTION_DAYS: '1' }).run(NOW);
    expect(result.refresh_tokens).toBe(2); // 'old' and 'recent' (expired 2 days ago)
  });

  it('is idempotent and records an audit entry per run', async () => {
    await seed();
    const job = make();
    await job.run(NOW);
    const second = await job.run(NOW);
    expect(second).toEqual({
      refresh_tokens: 0,
      password_reset_tokens: 0,
      otp_tokens: 0,
      invitations: 0,
      sessions: 0,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(prisma.actions().filter((a) => a === 'system.cleanup')).toHaveLength(
      2,
    );
    expect(prisma.auditLog.rows[0]).toMatchObject({
      actor_id: null,
      metadata: expect.objectContaining({ retention_days: 30 }) as object,
    });
  });

  describe('scheduled() gate', () => {
    it('does nothing unless ENABLE_CRON=true', async () => {
      await seed();
      await make({ ENABLE_CRON: 'false' }).scheduled();
      expect(prisma.refreshToken.rows).toHaveLength(3);
    });

    it('runs when enabled', async () => {
      await seed();
      await make({ ENABLE_CRON: 'true' }).scheduled();
      // `old` expired 45 days before the real "now" as well
      expect(prisma.refreshToken.rows.map((r) => r.token_hash)).not.toContain(
        'old',
      );
    });

    it('never throws: a failing run is logged and retried next time', async () => {
      const job = make({ ENABLE_CRON: 'true' });
      jest.spyOn(job, 'run').mockRejectedValue(new Error('db down'));
      await expect(job.scheduled()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'cleanup_job_failed',
          error: 'db down',
        }),
        expect.any(String),
        'Jobs',
      );
    });
  });
});

describe('JobsModule', () => {
  it('registers the daily cleanup cron with the scheduler, and stops it on shutdown', async () => {
    const { app } = await createApp();
    const registry = app.get(SchedulerRegistry);
    expect([...registry.getCronJobs().keys()]).toEqual(['cleanup']);
    const job = registry.getCronJob('cleanup');
    expect(job.cronTime.source).toBe('0 03 * * *');
    await app.close();
  });
});
