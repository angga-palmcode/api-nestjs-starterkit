import { EmailTransport } from '../../common/email/email-transport';
import {
  AuthNotifier,
  LinkMessage,
  OtpMessage,
  OtpSender,
} from './auth-messaging';

const minutesUntil = (date: Date): number =>
  Math.max(1, Math.round((date.getTime() - Date.now()) / 60_000));

/** Sends OTP codes through whatever `EmailTransport` the project provides. */
export class EmailOtpSender implements OtpSender {
  constructor(private readonly transport: EmailTransport) {}

  send(message: OtpMessage): Promise<void> {
    const reason =
      message.purpose === 'login' ? 'sign in' : 'confirm your sign-in';
    return this.transport.send({
      to: message.email,
      subject: `Your verification code: ${message.code}`,
      text: `Use this code to ${reason}: ${message.code}\n\nIt expires in ${minutesUntil(message.expires_at)} minutes. If you did not request it, ignore this email.`,
    });
  }
}

export class EmailAuthNotifier implements AuthNotifier {
  constructor(private readonly transport: EmailTransport) {}

  sendEmailVerification(message: LinkMessage): Promise<void> {
    return this.transport.send({
      to: message.email,
      subject: 'Verify your email address',
      text: `Hello${message.name ? ` ${message.name}` : ''},\n\nConfirm your email address: ${message.link}\n\nThe link expires in ${minutesUntil(message.expires_at)} minutes.`,
    });
  }

  sendPasswordReset(message: LinkMessage): Promise<void> {
    return this.transport.send({
      to: message.email,
      subject: 'Reset your password',
      text: `Reset your password: ${message.link}\n\nThe link expires in ${minutesUntil(message.expires_at)} minutes. If you did not ask for this, ignore this email.`,
    });
  }

  sendAccountLocked(message: {
    email: string;
    locked_until: Date;
  }): Promise<void> {
    return this.transport.send({
      to: message.email,
      subject: 'Your account was temporarily locked',
      text: `Too many failed sign-in attempts. Your account is locked until ${message.locked_until.toISOString()}. If this was not you, reset your password.`,
    });
  }
}
