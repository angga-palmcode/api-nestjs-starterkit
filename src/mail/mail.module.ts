import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_TRANSPORT } from '../common/email/email-transport';
import { AppLogger } from '../common/logger/app.logger';
import { Env } from '../config/env.schema';
import { requireEnv } from '../config/require-env';
import { ConsoleEmailTransport, SmtpEmailTransport } from './email-transports';

/**
 * Optional module: provides `EMAIL_TRANSPORT` (selected by `MAIL_TRANSPORT`). Auth and
 * invitations use it when `AUTH_DELIVERY=email`. Deleting `src/mail/` is supported
 * (docs/how-to/optional-modules.md); without a transport `AUTH_DELIVERY=email` fails at boot.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_TRANSPORT,
      inject: [ConfigService, AppLogger],
      useFactory: (config: ConfigService<Env, true>, logger: AppLogger) => {
        if (config.get('MAIL_TRANSPORT', { infer: true }) === 'smtp') {
          return new SmtpEmailTransport({
            // Presence is guaranteed by the env validation (MAIL_TRANSPORT=smtp).
            host: requireEnv(config, 'SMTP_HOST'),
            from: requireEnv(config, 'MAIL_FROM'),
            port: config.get('SMTP_PORT', { infer: true }),
            secure: config.get('SMTP_SECURE', { infer: true }),
            user: config.get('SMTP_USER', { infer: true }),
            password: config.get('SMTP_PASSWORD', { infer: true }),
          });
        }
        return new ConsoleEmailTransport(logger, config);
      },
    },
  ],
  exports: [EMAIL_TRANSPORT],
})
export class MailModule {}
