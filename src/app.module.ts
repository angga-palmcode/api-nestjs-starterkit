import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { LoggerModule } from './common/logger/logger.module';
import { GracefulShutdownService } from './common/lifecycle/graceful-shutdown.service';
import { CommonModule } from './common/common.module';
import { AuditModule } from './audit/audit.module';
import { ExampleModule } from './example/example.module';
import { AuthModule } from './auth/auth.module';
import { RbacModule } from './rbac/rbac.module';
import { ThrottleModule } from './common/throttle/throttle.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Env comes from the process environment (and .env in development).
      validate: validateEnv,
      cache: true,
    }),
    LoggerModule,
    CommonModule,
    HealthModule,
    PrismaModule,
    AuditModule,
    // Throttler before auth so rate limits apply to unauthenticated requests too.
    ThrottleModule,
    AuthModule,
    // After AuthModule: its guard needs the user the JWT guard puts on the request.
    RbacModule,
    UsersModule,
    // Optional modules: each folder can be deleted (docs/how-to/optional-modules.md).
    MailModule,
    StorageModule,
    RedisModule,
    JobsModule,
    // Reference module: delete it (and the ExampleItem model) when starting a real project.
    ExampleModule,
  ],
  providers: [GracefulShutdownService],
})
export class AppModule {}
