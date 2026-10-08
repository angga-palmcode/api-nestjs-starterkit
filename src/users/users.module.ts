import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailTransportHolder,
  resolveEmailTransport,
} from '../common/email/email-delivery';
import { AppLogger } from '../common/logger/app.logger';
import { Env } from '../config/env.schema';
import {
  ConsoleInvitationSender,
  EmailInvitationSender,
  INVITATION_SENDER,
} from './invitation-sender';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    EmailTransportHolder,
    {
      // Same switch as auth: AUTH_DELIVERY=email uses the EMAIL_TRANSPORT (mail module) and
      // refuses to boot without one; otherwise the console sender.
      provide: INVITATION_SENDER,
      inject: [ConfigService, EmailTransportHolder, AppLogger],
      useFactory: (
        config: ConfigService<Env, true>,
        holder: EmailTransportHolder,
        logger: AppLogger,
      ) => {
        const transport = resolveEmailTransport(config, holder);
        return transport
          ? new EmailInvitationSender(transport)
          : new ConsoleInvitationSender(logger, config);
      },
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}
