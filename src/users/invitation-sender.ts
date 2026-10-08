import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import type { EmailTransport } from '../common/email/email-transport';
import { AppLogger } from '../common/logger/app.logger';
import { Env } from '../config/env.schema';

export interface InvitationMessage {
  email: string;
  name?: string | null;
  role: Role;
  /** Full accept-invitation URL containing the one-time token. */
  link: string;
  expires_at: Date;
}

/**
 * How an invitation reaches the invitee. The mail module (Phase 8) provides an
 * email implementation under `INVITATION_SENDER`; projects can swap in anything else.
 */
export interface InvitationSender {
  send(message: InvitationMessage): Promise<void>;
}

export const INVITATION_SENDER = Symbol('INVITATION_SENDER');

/** Sends the invitation through whatever `EmailTransport` the project provides (the mail module). */
export class EmailInvitationSender implements InvitationSender {
  constructor(private readonly transport: EmailTransport) {}

  send(message: InvitationMessage): Promise<void> {
    const hours = Math.max(
      1,
      Math.round((message.expires_at.getTime() - Date.now()) / 3_600_000),
    );
    return this.transport.send({
      to: message.email,
      subject: "You've been invited",
      text: `Hello${message.name ? ` ${message.name}` : ''},\n\nYou have been invited with the role "${message.role}". Accept the invitation and choose a password: ${message.link}\n\nThe link expires in about ${hours} hours.`,
    });
  }
}

/**
 * Development default: prints the link. Outside development nothing secret is
 * logged; configure a real sender before relying on invitations in production.
 */
@Injectable()
export class ConsoleInvitationSender implements InvitationSender {
  constructor(
    private readonly logger: AppLogger,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  send(message: InvitationMessage): Promise<void> {
    const dev = this.config.get('NODE_ENV', { infer: true }) === 'development';
    this.logger.log(
      dev
        ? {
            message: 'invitation_created',
            email: message.email,
            link: message.link,
          }
        : {
            message: 'invitation_created_without_sender',
            email: message.email,
            hint: 'Provide an INVITATION_SENDER; the link is not logged outside development',
          },
      'Invitations',
    );
    return Promise.resolve();
  }
}
