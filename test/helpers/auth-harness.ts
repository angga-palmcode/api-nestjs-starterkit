import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  AUTH_NOTIFIER,
  OTP_SENDER,
} from '../../src/auth/providers/auth-messaging';
import type {
  LinkMessage,
  OtpMessage,
} from '../../src/auth/providers/auth-messaging';
import { hotp, totpStep } from '../../src/auth/totp/totp.util';
import { hashPassword } from '../../src/common/utils/password.util';
import {
  INVITATION_SENDER,
  type InvitationMessage,
} from '../../src/users/invitation-sender';
import { createApp } from './create-app';
import { MemoryPrisma, Row, createMemoryPrisma } from './memory-prisma';

export const PASSWORD = 'correct-horse-battery';

/** Everything the app tried to send, captured instead of delivered. */
export interface Mail {
  otps: OtpMessage[];
  verifications: LinkMessage[];
  resets: LinkMessage[];
  locked: Array<{ email: string; locked_until: Date }>;
  invitations: InvitationMessage[];
}

export const tokenFromLink = (link: string): string =>
  new URL(link).searchParams.get('token') as string;

export interface Harness {
  app: NestExpressApplication;
  prisma: MemoryPrisma;
  mail: Mail;
  http: () => ReturnType<typeof request>;
  /** Inserts a verified user with a known password. */
  user: (overrides?: Row) => Promise<Row & { id: string; email: string }>;
  /** POST /auth/login; returns the supertest response. */
  login: (email: string, password?: string) => request.Test;
  /** Logs in and returns the tokens (asserts the flow ended `authenticated`). */
  signIn: (email: string, password?: string) => Promise<Tokens>;
  bearer: (accessToken: string) => { Authorization: string };
  lastOtp: () => string;
  close: () => Promise<void>;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
}

export async function bootAuth(
  env: Record<string, string> = {},
): Promise<Harness> {
  const prisma = createMemoryPrisma();
  const mail: Mail = {
    otps: [],
    verifications: [],
    resets: [],
    locked: [],
    invitations: [],
  };
  const { app } = await createApp({
    env,
    prismaOverride: prisma,
    overrides: [
      {
        provide: OTP_SENDER,
        useValue: {
          send: (m: OtpMessage) => (mail.otps.push(m), Promise.resolve()),
        },
      },
      {
        provide: AUTH_NOTIFIER,
        useValue: {
          sendEmailVerification: (m: LinkMessage) => (
            mail.verifications.push(m),
            Promise.resolve()
          ),
          sendPasswordReset: (m: LinkMessage) => (
            mail.resets.push(m),
            Promise.resolve()
          ),
          sendAccountLocked: (m: { email: string; locked_until: Date }) => (
            mail.locked.push(m),
            Promise.resolve()
          ),
        },
      },
      {
        provide: INVITATION_SENDER,
        useValue: {
          send: (m: InvitationMessage) => (
            mail.invitations.push(m),
            Promise.resolve()
          ),
        },
      },
    ],
  });

  const http = () => request(app.getHttpServer());
  const login = (email: string, password: string | undefined = PASSWORD) =>
    http().post('/auth/login').send({ email, password });

  return {
    app,
    prisma,
    mail,
    http,
    user: async (overrides = {}) =>
      (await prisma.seedUser({
        password_hash: await hashPassword(PASSWORD, 4),
        ...overrides,
      })) as Row & { id: string; email: string },
    login,
    signIn: async (email, password = PASSWORD) => {
      const res = await login(email, password).expect(200);
      const data = (res.body as { data: { status: string } & Tokens }).data;
      expect(data.status).toBe('authenticated');
      return data;
    },
    bearer: (accessToken) => ({ Authorization: `Bearer ${accessToken}` }),
    lastOtp: () => mail.otps[mail.otps.length - 1].code,
    close: () => app.close(),
  };
}

export const dataOf = <T = Record<string, unknown>>(res: request.Response): T =>
  (res.body as { data: T }).data;

export const errorCodeOf = (res: request.Response): string =>
  (res.body as { error_code: string }).error_code;

/** The TOTP code an authenticator would show for `secret` right now (or `offsetSteps` away). */
export const totpNow = (secret: string, offsetSteps = 0): string =>
  hotp(secret, totpStep() + offsetSteps);
