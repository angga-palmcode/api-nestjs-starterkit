import request from 'supertest';
import { EMAIL_TRANSPORT } from '../common/email/email-transport';
import type { EmailMessage } from '../common/email/email-transport';
import { hashPassword } from '../common/utils/password.util';
import { createApp } from '../../test/helpers/create-app';
import { createMemoryPrisma } from '../../test/helpers/memory-prisma';
import { PASSWORD, tokenFromLink } from '../../test/helpers/auth-harness';

/**
 * AUTH_DELIVERY=email with the real adapters (no capture fakes on the auth seams):
 * only the final EMAIL_TRANSPORT is replaced, so these prove the whole chain.
 */
describe('auth and invitation emails through EMAIL_TRANSPORT', () => {
  const sent: EmailMessage[] = [];
  const prisma = createMemoryPrisma();
  let http: () => ReturnType<typeof request>;
  let close: () => Promise<void>;

  const lastMail = () => sent[sent.length - 1];
  const linkIn = (mail: EmailMessage) =>
    /https?:\/\/\S+/.exec(mail.text)?.[0] as string;

  beforeAll(async () => {
    const { app } = await createApp({
      env: { AUTH_DELIVERY: 'email', AUTH_METHODS: 'password,otp' },
      prismaOverride: prisma,
      overrides: [
        {
          provide: EMAIL_TRANSPORT,
          useValue: {
            send: (m: EmailMessage) => (sent.push(m), Promise.resolve()),
          },
        },
      ],
    });
    http = () => request(app.getHttpServer());
    close = () => app.close();
  });
  afterAll(() => close());
  beforeEach(() => {
    sent.length = 0;
  });

  const user = async (overrides = {}) =>
    (await prisma.seedUser({
      password_hash: await hashPassword(PASSWORD, 4),
      ...overrides,
    })) as { id: string; email: string };

  it('password reset arrives by email and works', async () => {
    const u = await user();
    await http()
      .post('/auth/forgot-password')
      .send({ email: u.email })
      .expect(202);
    expect(sent).toHaveLength(1);
    expect(lastMail()).toMatchObject({
      to: u.email,
      subject: 'Reset your password',
    });

    await http()
      .post('/auth/reset-password')
      .send({
        token: tokenFromLink(linkIn(lastMail())),
        password: 'a-brand-new-passphrase',
      })
      .expect(204);
    await http()
      .post('/auth/login')
      .send({ email: u.email, password: 'a-brand-new-passphrase' })
      .expect(200);
  });

  it('passwordless login sends the code by email', async () => {
    const u = await user();
    const start = await http()
      .post('/auth/login')
      .send({ email: u.email })
      .expect(200);
    expect(lastMail()).toMatchObject({ to: u.email });
    const code = /\b(\d{6})\b/.exec(lastMail().text)?.[1] as string;
    expect(lastMail().subject).toContain(code);

    const res = await http()
      .post('/auth/login/otp')
      .send({
        challenge_token: (start.body as { data: { challenge_token: string } })
          .data.challenge_token,
        code,
      })
      .expect(200);
    expect((res.body as { data: { status: string } }).data.status).toBe(
      'authenticated',
    );
  });

  it('an invitation arrives by email and can be accepted', async () => {
    const admin = await user({ role: 'admin' });
    const login = await http()
      .post('/auth/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    const access = (login.body as { data: { access_token: string } }).data
      .access_token;
    sent.length = 0;

    await http()
      .post('/users/invitations')
      .set({ Authorization: `Bearer ${access}` })
      .send({ email: 'newbie@example.com', role: 'user' })
      .expect(201);
    expect(lastMail()).toMatchObject({
      to: 'newbie@example.com',
      subject: "You've been invited",
    });
    expect(lastMail().text).toContain('"user"');

    await http()
      .post('/auth/accept-invite')
      .send({
        token: tokenFromLink(linkIn(lastMail())),
        password: 'my-own-long-passphrase',
      })
      .expect(201);
  });

  it('a failing transport never fails the request (logged, not surfaced)', async () => {
    const failing = await createApp({
      env: { AUTH_DELIVERY: 'email' },
      prismaOverride: createMemoryPrisma(),
      overrides: [
        {
          provide: EMAIL_TRANSPORT,
          useValue: { send: () => Promise.reject(new Error('smtp down')) },
        },
      ],
    });
    await request(failing.app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'ghost@example.com' })
      .expect(202);
    await failing.app.close();
  });
});
