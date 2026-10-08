import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../../common/logger/app.logger';
import { Env } from '../../config/env.schema';
import {
  AuthNotifier,
  LinkMessage,
  OtpMessage,
  OtpSender,
} from './auth-messaging';

/**
 * Development adapters: print what would have been sent. Secrets (codes, links)
 * are logged only when NODE_ENV=development; elsewhere only a notice is logged.
 */
abstract class ConsoleAdapter {
  constructor(
    protected readonly logger: AppLogger,
    protected readonly config: ConfigService<Env, true>,
  ) {}

  protected emit(event: string, safe: object, secret: object): void {
    const dev = this.config.get('NODE_ENV', { infer: true }) === 'development';
    this.logger.log(
      dev
        ? { message: event, ...safe, ...secret }
        : {
            message: `${event}_not_delivered`,
            ...safe,
            hint: 'Set AUTH_DELIVERY=email and provide an EMAIL_TRANSPORT',
          },
      'AuthDelivery',
    );
  }
}

@Injectable()
export class ConsoleOtpSender extends ConsoleAdapter implements OtpSender {
  constructor(
    logger: AppLogger,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    super(logger, config);
  }

  send(message: OtpMessage): Promise<void> {
    this.emit(
      'otp_code',
      { email: message.email, purpose: message.purpose },
      { code: message.code },
    );
    return Promise.resolve();
  }
}

@Injectable()
export class ConsoleAuthNotifier
  extends ConsoleAdapter
  implements AuthNotifier
{
  constructor(
    logger: AppLogger,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    super(logger, config);
  }

  sendEmailVerification(message: LinkMessage): Promise<void> {
    this.emit(
      'email_verification',
      { email: message.email },
      { link: message.link },
    );
    return Promise.resolve();
  }

  sendPasswordReset(message: LinkMessage): Promise<void> {
    this.emit(
      'password_reset',
      { email: message.email },
      { link: message.link },
    );
    return Promise.resolve();
  }

  sendAccountLocked(message: {
    email: string;
    locked_until: Date;
  }): Promise<void> {
    this.emit(
      'account_locked',
      { email: message.email, locked_until: message.locked_until },
      {},
    );
    return Promise.resolve();
  }
}
