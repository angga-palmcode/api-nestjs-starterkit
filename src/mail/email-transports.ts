import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type {
  EmailMessage,
  EmailTransport,
} from '../common/email/email-transport';
import { AppLogger } from '../common/logger/app.logger';
import { Env } from '../config/env.schema';

/**
 * Development transport: logs who the mail is for and its subject. The body (which carries
 * codes and links) is printed only when NODE_ENV=development.
 */
@Injectable()
export class ConsoleEmailTransport implements EmailTransport {
  constructor(
    private readonly logger: AppLogger,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  send(message: EmailMessage): Promise<void> {
    const dev = this.config.get('NODE_ENV', { infer: true }) === 'development';
    this.logger.log(
      {
        message: 'email_not_sent_console_transport',
        to: message.to,
        subject: message.subject,
        ...(dev ? { text: message.text } : {}),
      },
      'Mail',
    );
    return Promise.resolve();
  }
}

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  password?: string;
}

type CreateTransport = (options: object) => Pick<Transporter, 'sendMail'>;

/** nodemailer over SMTP. Failures reject; callers decide (auth/invitations log and carry on). */
export class SmtpEmailTransport implements EmailTransport {
  private readonly transporter: Pick<Transporter, 'sendMail'>;

  constructor(
    private readonly options: SmtpOptions,
    create: CreateTransport = createTransport as CreateTransport,
  ) {
    this.transporter = create({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user
        ? { auth: { user: options.user, pass: options.password } }
        : {}),
      // Fail fast instead of hanging a request-adjacent task on a dead SMTP server.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }
}
