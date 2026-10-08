export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Minimal outbound-email seam. Auth (and anything else that sends mail) depends only
 * on this interface; the optional mail module (Phase 8) provides a nodemailer
 * implementation under `EMAIL_TRANSPORT`. Deleting the mail module must not break the build.
 */
export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');
