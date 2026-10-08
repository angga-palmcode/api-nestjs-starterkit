import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CleanupJob } from './cleanup.job';

/**
 * Optional module: cron scaffold (`@nestjs/schedule`). Jobs are gated by `ENABLE_CRON`
 * (enable on exactly one instance). Deleting `src/jobs/` is supported
 * (docs/how-to/optional-modules.md); nothing else depends on it.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [CleanupJob],
})
export class JobsModule {}
