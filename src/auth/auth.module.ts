import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppLogger } from '../common/logger/app.logger';
import {
  EmailTransportHolder,
  resolveEmailTransport,
} from '../common/email/email-delivery';
import { Env } from '../config/env.schema';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ChallengeService } from './core/challenge.service';
import { JwtAuthGuard } from './core/jwt-auth.guard';
import { SessionService } from './core/session.service';
import { TokenService } from './core/token.service';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { AUTH_NOTIFIER, OTP_SENDER } from './providers/auth-messaging';
import {
  ConsoleAuthNotifier,
  ConsoleOtpSender,
} from './providers/console-adapters';
import { EmailAuthNotifier, EmailOtpSender } from './providers/email-adapters';

const deliveryProviders: Provider[] = [
  EmailTransportHolder,
  {
    provide: OTP_SENDER,
    inject: [ConfigService, EmailTransportHolder, AppLogger],
    useFactory: (
      config: ConfigService<Env, true>,
      holder: EmailTransportHolder,
      logger: AppLogger,
    ) => {
      const transport = resolveEmailTransport(config, holder);
      return transport
        ? new EmailOtpSender(transport)
        : new ConsoleOtpSender(logger, config);
    },
  },
  {
    provide: AUTH_NOTIFIER,
    inject: [ConfigService, EmailTransportHolder, AppLogger],
    useFactory: (
      config: ConfigService<Env, true>,
      holder: EmailTransportHolder,
      logger: AppLogger,
    ) => {
      const transport = resolveEmailTransport(config, holder);
      return transport
        ? new EmailAuthNotifier(transport)
        : new ConsoleAuthNotifier(logger, config);
    },
  },
];

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, AccountController, MfaController],
  providers: [
    ...deliveryProviders,
    TokenService,
    SessionService,
    ChallengeService,
    MfaService,
    AuthService,
    AccountService,
    JwtAuthGuard,
    // `useExisting` lets tests swap the guard by overriding JwtAuthGuard.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
  exports: [TokenService, SessionService],
})
export class AuthModule {}
