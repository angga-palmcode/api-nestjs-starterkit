import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';
import { AppLogger } from '../common/logger/app.logger';
import { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';

export interface CleanupResult {
  refresh_tokens: number;
  password_reset_tokens: number;
  otp_tokens: number;
  invitations: number;
  sessions: number;
}

/**
 * The reference scheduled job: housekeeping for the auth tables, which otherwise only grow.
 * Deletes tokens/invitations that expired, and sessions that were revoked, more than
 * `JOBS_RETENTION_DAYS` ago. Safe to run repeatedly (idempotent).
 *
 * Scheduling gate: the job only runs on an instance started with `ENABLE_CRON=true`. Enable it
 * on exactly one instance, otherwise every replica repeats the work (see docs/how-to/optional-modules.md).
 * To add a job: copy this class, change the `@Cron` expression, register it in `JobsModule`.
 */
@Injectable()
export class CleanupJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'cleanup' })
  async scheduled(): Promise<void> {
    if (!this.config.get('ENABLE_CRON', { infer: true })) return;
    try {
      await this.run();
    } catch (error) {
      // A failing job must never crash the process; the next run retries.
      this.logger.error(
        {
          message: 'cleanup_job_failed',
          error: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error.stack : undefined,
        'Jobs',
      );
    }
  }

  /** The work itself, callable from tests or a CLI regardless of the schedule gate. */
  async run(now: Date = new Date()): Promise<CleanupResult> {
    const days = this.config.get('JOBS_RETENTION_DAYS', { infer: true });
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const expired = { expires_at: { lt: cutoff } };

    // Tokens first, then sessions (a session delete would cascade to its tokens anyway).
    const [refresh, reset, otp, invitations, sessions] =
      await this.prisma.$transaction([
        this.prisma.refreshToken.deleteMany({ where: expired }),
        this.prisma.passwordResetToken.deleteMany({ where: expired }),
        this.prisma.otpToken.deleteMany({ where: expired }),
        this.prisma.userInvitation.deleteMany({
          where: { ...expired, accepted_at: null },
        }),
        this.prisma.userSession.deleteMany({
          where: { revoked_at: { lt: cutoff } },
        }),
      ]);

    const result: CleanupResult = {
      refresh_tokens: refresh.count,
      password_reset_tokens: reset.count,
      otp_tokens: otp.count,
      invitations: invitations.count,
      sessions: sessions.count,
    };
    this.logger.log({ message: 'cleanup_job_done', ...result }, 'Jobs');
    this.audit.record({
      actor_id: null,
      action: 'system.cleanup',
      metadata: { ...result, retention_days: days },
    });
    return result;
  }
}
