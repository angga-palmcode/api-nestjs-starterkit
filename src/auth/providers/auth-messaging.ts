export type OtpPurposeName = 'login' | 'mfa';

export interface OtpMessage {
  email: string;
  code: string;
  purpose: OtpPurposeName;
  expires_at: Date;
}

/** Delivers one-time codes (email today; an SMS adapter would implement the same interface). */
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}
export const OTP_SENDER = Symbol('OTP_SENDER');

export interface LinkMessage {
  email: string;
  name?: string | null;
  /** Full URL (frontend route + one-time token). */
  link: string;
  expires_at: Date;
}

/** Delivers the links and notices of the account lifecycle. */
export interface AuthNotifier {
  sendEmailVerification(message: LinkMessage): Promise<void>;
  sendPasswordReset(message: LinkMessage): Promise<void>;
  sendAccountLocked(message: {
    email: string;
    locked_until: Date;
  }): Promise<void>;
}
export const AUTH_NOTIFIER = Symbol('AUTH_NOTIFIER');
