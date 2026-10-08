import {
  Harness,
  PASSWORD,
  bootAuth,
  dataOf,
  errorCodeOf,
  tokenFromLink,
  totpNow,
} from '../../test/helpers/auth-harness';

const rowOf = (h: Harness, id: string) =>
  h.prisma.user.rows.find((r) => r.id === id) as Record<string, unknown>;

describe('registration (AUTH_ALLOW_REGISTRATION)', () => {
  it('is invite-only by default: 404', async () => {
    const h = await bootAuth();
    await h
      .http()
      .post('/auth/register')
      .send({ email: 'new@example.com', password: PASSWORD, name: 'New' })
      .expect(404);
    expect(h.prisma.user.rows).toHaveLength(0);
    await h.close();
  });

  describe('when open', () => {
    let h: Harness;
    beforeAll(async () => {
      h = await bootAuth({ AUTH_ALLOW_REGISTRATION: 'true' });
    });
    afterAll(() => h.close());

    const register = (email: string) =>
      h
        .http()
        .post('/auth/register')
        .send({ email, password: PASSWORD, name: 'New Person' });

    it('creates an unverified user, sends a verification link, and answers 202 for new and existing addresses alike', async () => {
      const fresh = await register('New@Example.com').expect(202);
      const again = await register('new@example.com').expect(202);
      expect(fresh.body).toEqual(again.body);
      expect(h.prisma.user.rows).toHaveLength(1);
      expect(h.prisma.user.rows[0]).toMatchObject({
        email: 'new@example.com',
        role: 'user',
        email_verified_at: null,
      });
      expect(h.prisma.user.rows[0].password_hash).toMatch(/^\$2[aby]\$/);
      expect(h.mail.verifications).toHaveLength(1);

      // cannot sign in until verified
      const blocked = await h.login('new@example.com').expect(403);
      expect(errorCodeOf(blocked)).toBe('EMAIL_NOT_VERIFIED');

      await h
        .http()
        .post('/auth/verify-email')
        .send({ token: tokenFromLink(h.mail.verifications[0].link) })
        .expect(204);
      await h.login('new@example.com').expect(200);
    });

    it('validates input', async () => {
      await h
        .http()
        .post('/auth/register')
        .send({ email: 'x@example.com', password: 'short', name: 'X' })
        .expect(422);
      await h
        .http()
        .post('/auth/register')
        .send({
          email: 'x@example.com',
          password: PASSWORD,
          name: 'X',
          role: 'superadmin',
        })
        .expect(422);
    });
  });
});

describe('email verification', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootAuth();
  });
  afterAll(() => h.close());

  it('resend only sends to existing unverified users, with a uniform answer', async () => {
    const unverified = await h.user({ email_verified_at: null });
    const verified = await h.user();
    const send = (email: string) =>
      h.http().post('/auth/verify-email/resend').send({ email });

    const a = await send(unverified.email).expect(202);
    const b = await send(verified.email).expect(202);
    const c = await send('ghost@example.com').expect(202);
    expect(a.body).toEqual(b.body);
    expect(a.body).toEqual(c.body);
    expect(h.mail.verifications.map((m) => m.email)).toEqual([
      unverified.email,
    ]);

    const token = tokenFromLink(h.mail.verifications[0].link);
    await h.http().post('/auth/verify-email').send({ token }).expect(204);
    // idempotent
    await h.http().post('/auth/verify-email').send({ token }).expect(204);
    expect(rowOf(h, unverified.id).email_verified_at).toBeInstanceOf(Date);
  });

  it('rejects garbage and tokens of other kinds (400 INVALID_TOKEN)', async () => {
    const res = await h
      .http()
      .post('/auth/verify-email')
      .send({ token: 'garbage' })
      .expect(400);
    expect(errorCodeOf(res)).toBe('INVALID_TOKEN');

    // an access token must not verify an email (different secret/audience)
    const user = await h.user();
    const tokens = await h.signIn(user.email);
    await h
      .http()
      .post('/auth/verify-email')
      .send({ token: tokens.access_token })
      .expect(400);
  });

  it('rejects a link whose address has since changed', async () => {
    const user = await h.user({ email_verified_at: null });
    await h
      .http()
      .post('/auth/verify-email/resend')
      .send({ email: user.email })
      .expect(202);
    const token = tokenFromLink(h.mail.verifications.at(-1)!.link);
    rowOf(h, user.id).email = 'changed@example.com';
    await h.http().post('/auth/verify-email').send({ token }).expect(400);
  });
});

describe('password reset', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootAuth();
  });
  afterAll(() => h.close());

  const forgot = (email: string) =>
    h.http().post('/auth/forgot-password').send({ email });
  const reset = (token: string, password = 'a-brand-new-passphrase') =>
    h.http().post('/auth/reset-password').send({ token, password });

  it('answers 202 whether or not the account exists, and only emails real active users', async () => {
    const user = await h.user();
    const inactive = await h.user({ is_active: false });
    const a = await forgot(user.email).expect(202);
    const b = await forgot('ghost@example.com').expect(202);
    await forgot(inactive.email).expect(202);
    expect(a.body).toEqual(b.body);
    expect(h.mail.resets.map((m) => m.email)).toEqual([user.email]);
  });

  it('resets the password, signs out everywhere, clears lockout, and the link works once', async () => {
    const user = await h.user({
      failed_login_attempts: 9,
      locked_until: new Date(Date.now() + 60_000),
    });
    const session = await h.signIn(user.email).catch(() => null);
    expect(session).toBeNull(); // locked: even the right password is refused

    await forgot(user.email).expect(202);
    const token = tokenFromLink(h.mail.resets.at(-1)!.link);
    // only the hash is stored
    expect(JSON.stringify(h.prisma.passwordResetToken.rows)).not.toContain(
      token,
    );

    rowOf(h, user.id).locked_until = null;
    const live = await h.signIn(user.email);

    await reset(token).expect(204);
    expect(rowOf(h, user.id)).toMatchObject({
      failed_login_attempts: 0,
      locked_until: null,
    });
    await h.http().get('/auth/me').set(h.bearer(live.access_token)).expect(401);
    await h.login(user.email, PASSWORD).expect(401);
    await h.login(user.email, 'a-brand-new-passphrase').expect(200);

    // single use
    const again = await reset(token).expect(400);
    expect(errorCodeOf(again)).toBe('INVALID_TOKEN');
  });

  it('a newer link supersedes the older one (latest wins)', async () => {
    const user = await h.user();
    await forgot(user.email).expect(202);
    const older = tokenFromLink(h.mail.resets.at(-1)!.link);
    await forgot(user.email).expect(202);
    const newer = tokenFromLink(h.mail.resets.at(-1)!.link);
    await reset(older).expect(400);
    await reset(newer).expect(204);
  });

  it('rejects expired, unknown and weak-password requests', async () => {
    const user = await h.user();
    await forgot(user.email).expect(202);
    const token = tokenFromLink(h.mail.resets.at(-1)!.link);
    await reset('unknown-token').expect(400);
    await reset(token, 'short').expect(422);
    h.prisma.passwordResetToken.rows.at(-1)!.expires_at = new Date(
      Date.now() - 1,
    );
    await reset(token).expect(400);
  });

  it('a reset also proves the mailbox', async () => {
    const user = await h.user({ email_verified_at: null });
    await forgot(user.email).expect(202);
    await reset(tokenFromLink(h.mail.resets.at(-1)!.link)).expect(204);
    expect(rowOf(h, user.id).email_verified_at).toBeInstanceOf(Date);
  });
});

describe('change password', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootAuth();
  });
  afterAll(() => h.close());

  const change = (access: string, body: object) =>
    h.http().post('/auth/change-password').set(h.bearer(access)).send(body);

  it('needs the current password, differs from it, and signs out every device', async () => {
    const user = await h.user();
    const a = await h.signIn(user.email);
    const b = await h.signIn(user.email);

    const wrong = await change(a.access_token, {
      current_password: 'not-my-password',
      new_password: 'another-long-passphrase',
    }).expect(401);
    expect(errorCodeOf(wrong)).toBe('INVALID_CREDENTIALS');

    await change(a.access_token, {
      current_password: PASSWORD,
      new_password: PASSWORD,
    }).expect(422);
    await change(a.access_token, {
      current_password: PASSWORD,
      new_password: 'short',
    }).expect(422);

    await change(a.access_token, {
      current_password: PASSWORD,
      new_password: 'another-long-passphrase',
    }).expect(204);
    await h.http().get('/auth/me').set(h.bearer(a.access_token)).expect(401);
    await h.http().get('/auth/me').set(h.bearer(b.access_token)).expect(401);
    await h.login(user.email).expect(401);
    await h.login(user.email, 'another-long-passphrase').expect(200);
  });

  it('requires authentication', async () => {
    await h
      .http()
      .post('/auth/change-password')
      .send({ current_password: 'x', new_password: 'another-long-passphrase' })
      .expect(401);
  });
});

describe('invitations end to end', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootAuth();
  });
  afterAll(() => h.close());

  const invite = (adminAccess: string, email: string, role = 'user') =>
    h
      .http()
      .post('/users/invitations')
      .set(h.bearer(adminAccess))
      .send({ email, role });
  const accept = (token: string, body: object = {}) =>
    h
      .http()
      .post('/auth/accept-invite')
      .send({ token, password: 'my-own-long-passphrase', ...body });

  it('invite -> accept -> sign in; the token works once and the invitee is verified', async () => {
    const admin = await h.user({ role: 'admin' });
    const t = await h.signIn(admin.email);
    await invite(t.access_token, 'Invitee@Example.com').expect(201);
    expect(h.mail.invitations).toHaveLength(1);
    const token = tokenFromLink(h.mail.invitations[0].link);
    expect(JSON.stringify(h.prisma.userInvitation.rows)).not.toContain(token);

    const accepted = await accept(token, { name: 'Invitee Person' }).expect(
      201,
    );
    expect(dataOf(accepted)).toMatchObject({
      email: 'invitee@example.com',
      name: 'Invitee Person',
      role: 'user',
      email_verified: true,
    });
    expect(JSON.stringify(accepted.body)).not.toContain('password');
    expect(
      h.prisma.user.rows.find((r) => r.email === 'invitee@example.com')
        ?.created_by,
    ).toBe(admin.id);

    await h.login('invitee@example.com', 'my-own-long-passphrase').expect(200);
    const again = await accept(token).expect(400);
    expect(errorCodeOf(again)).toBe('INVALID_TOKEN');
  });

  it('simultaneous acceptances: exactly one wins (finding 3.10)', async () => {
    const admin = await h.user({ role: 'admin' });
    const t = await h.signIn(admin.email);
    await invite(t.access_token, 'race@example.com').expect(201);
    const token = tokenFromLink(h.mail.invitations.at(-1)!.link);
    const results = await Promise.all([accept(token), accept(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(
      h.prisma.user.rows.filter((r) => r.email === 'race@example.com'),
    ).toHaveLength(1);
  });

  it('rejects expired, revoked (superseded) and unknown tokens', async () => {
    const admin = await h.user({ role: 'admin' });
    const t = await h.signIn(admin.email);

    await invite(t.access_token, 'expired@example.com').expect(201);
    const expired = tokenFromLink(h.mail.invitations.at(-1)!.link);
    h.prisma.userInvitation.rows.at(-1)!.expires_at = new Date(Date.now() - 1);
    await accept(expired).expect(400);

    await invite(t.access_token, 'twice@example.com').expect(201);
    const first = tokenFromLink(h.mail.invitations.at(-1)!.link);
    await invite(t.access_token, 'twice@example.com').expect(201);
    const second = tokenFromLink(h.mail.invitations.at(-1)!.link);
    await accept(first).expect(400);
    await accept(second).expect(201);

    await accept('unknown').expect(400);
    await accept(second, { password: 'short' }).expect(422);
  });

  it('409 if the email became a user meanwhile, and the invitation is not burnt', async () => {
    const admin = await h.user({ role: 'admin' });
    const t = await h.signIn(admin.email);
    await invite(t.access_token, 'taken@example.com').expect(201);
    const token = tokenFromLink(h.mail.invitations.at(-1)!.link);
    await h.user({ email: 'taken@example.com' });
    const res = await accept(token).expect(409);
    expect(errorCodeOf(res)).toBe('CONFLICT');
    // rolled back: the claim was undone with the transaction
    expect(h.prisma.userInvitation.rows.at(-1)!.accepted_at).toBeNull();
  });
});

describe('TOTP management', () => {
  describe('AUTH_MFA=totp', () => {
    let h: Harness;
    beforeAll(async () => {
      h = await bootAuth({ AUTH_MFA: 'totp' });
    });
    afterAll(() => h.close());

    it('setup -> confirm -> recovery codes; repeating setup cannot clobber an active secret', async () => {
      const user = await h.user();
      const t = await h.signIn(user.email);
      const auth = h.bearer(t.access_token);

      const setup1 = dataOf<{ secret: string; otpauth_uri: string }>(
        await h.http().post('/auth/mfa/totp/setup').set(auth).expect(200),
      );
      expect(setup1.otpauth_uri).toContain('otpauth://totp/');
      expect(setup1.otpauth_uri).toContain(encodeURIComponent(user.email));
      // a second setup before confirming only replaces the pending secret
      const setup2 = dataOf<{ secret: string }>(
        await h.http().post('/auth/mfa/totp/setup').set(auth).expect(200),
      );
      expect(setup2.secret).not.toBe(setup1.secret);

      // a code from the superseded secret is refused; nothing is enabled yet
      await h
        .http()
        .post('/auth/mfa/totp/confirm')
        .set(auth)
        .send({ code: totpNow(setup1.secret) })
        .expect(401);
      expect(rowOf(h, user.id).mfa_enabled).toBe(false);

      const confirmed = await h
        .http()
        .post('/auth/mfa/totp/confirm')
        .set(auth)
        .send({ code: totpNow(setup2.secret) })
        .expect(201);
      expect(
        dataOf<{ recovery_codes: string[] }>(confirmed).recovery_codes,
      ).toHaveLength(10);
      expect(rowOf(h, user.id).mfa_enabled).toBe(true);

      // active now: setup/confirm again are conflicts (finding 3.5)
      await h.http().post('/auth/mfa/totp/setup').set(auth).expect(409);
      await h
        .http()
        .post('/auth/mfa/totp/confirm')
        .set(auth)
        .send({ code: totpNow(setup2.secret, 1) })
        .expect(409);
    });

    it('confirm without setup is a 400', async () => {
      const user = await h.user();
      const t = await h.signIn(user.email);
      await h
        .http()
        .post('/auth/mfa/totp/confirm')
        .set(h.bearer(t.access_token))
        .send({ code: '123456' })
        .expect(400);
    });

    it('regenerating recovery codes invalidates the old ones and needs a valid code', async () => {
      const user = await h.user();
      const t = await h.signIn(user.email);
      const auth = h.bearer(t.access_token);
      const { secret } = dataOf<{ secret: string }>(
        await h.http().post('/auth/mfa/totp/setup').set(auth).expect(200),
      );
      const first = dataOf<{ recovery_codes: string[] }>(
        await h
          .http()
          .post('/auth/mfa/totp/confirm')
          .set(auth)
          .send({ code: totpNow(secret) })
          .expect(201),
      ).recovery_codes;

      await h
        .http()
        .post('/auth/mfa/totp/recovery-codes')
        .set(auth)
        .send({ code: '000000' })
        .expect(401);
      const second = dataOf<{ recovery_codes: string[] }>(
        await h
          .http()
          .post('/auth/mfa/totp/recovery-codes')
          .set(auth)
          .send({ code: totpNow(secret, 1) })
          .expect(201),
      ).recovery_codes;
      expect(second).not.toEqual(first);

      // old code no longer signs in; a new one does
      const challenge = dataOf<{ challenge_token: string }>(
        await h.login(user.email).expect(200),
      ).challenge_token;
      await h
        .http()
        .post('/auth/mfa/verify')
        .send({ challenge_token: challenge, code: first[0] })
        .expect(401);
      const challenge2 = dataOf<{ challenge_token: string }>(
        await h.login(user.email).expect(200),
      ).challenge_token;
      await h
        .http()
        .post('/auth/mfa/verify')
        .send({ challenge_token: challenge2, code: second[0] })
        .expect(200);
    });

    it('disable needs the password and a valid code, then login skips MFA', async () => {
      const user = await h.user();
      const t = await h.signIn(user.email);
      const auth = h.bearer(t.access_token);
      const { secret } = dataOf<{ secret: string }>(
        await h.http().post('/auth/mfa/totp/setup').set(auth).expect(200),
      );
      await h
        .http()
        .post('/auth/mfa/totp/confirm')
        .set(auth)
        .send({ code: totpNow(secret) })
        .expect(201);

      const disable = (password: string, code: string) =>
        h
          .http()
          .post('/auth/mfa/totp/disable')
          .set(auth)
          .send({ password, code });
      await disable('wrong-password', totpNow(secret, 1)).expect(401);
      await disable(PASSWORD, '000000').expect(401);
      expect(rowOf(h, user.id).mfa_enabled).toBe(true);

      await disable(PASSWORD, totpNow(secret, 1)).expect(204);
      expect(rowOf(h, user.id).mfa_enabled).toBe(false);
      expect(
        h.prisma.mfaSecret.rows.find((r) => r.user_id === user.id),
      ).toBeUndefined();
      expect(
        h.prisma.mfaRecoveryCode.rows.filter((r) => r.user_id === user.id),
      ).toHaveLength(0);
      await h.signIn(user.email); // straight to authenticated
      await disable(PASSWORD, '123456').expect(400);
    });
  });

  it.each(['none', 'otp'])(
    'every TOTP route is a 404 when AUTH_MFA=%s',
    async (mfa) => {
      const h = await bootAuth({ AUTH_MFA: mfa });
      const user = await h.user();
      const t = await h.signIn(user.email).catch(async () => {
        // AUTH_MFA=otp stops at mfa_required; sign in with the emailed code
        const first = dataOf<{ challenge_token: string }>(
          await h.login(user.email).expect(200),
        );
        return dataOf<{ access_token: string; refresh_token: string }>(
          await h
            .http()
            .post('/auth/mfa/verify')
            .send({ challenge_token: first.challenge_token, code: h.lastOtp() })
            .expect(200),
        );
      });
      const auth = h.bearer(t.access_token);
      await h.http().post('/auth/mfa/totp/setup').set(auth).expect(404);
      await h
        .http()
        .post('/auth/mfa/totp/confirm')
        .set(auth)
        .send({ code: '123456' })
        .expect(404);
      await h
        .http()
        .post('/auth/mfa/totp/disable')
        .set(auth)
        .send({ password: PASSWORD, code: '123456' })
        .expect(404);
      await h
        .http()
        .post('/auth/mfa/totp/recovery-codes')
        .set(auth)
        .send({ code: '123456' })
        .expect(404);
      await h.close();
    },
  );
});

describe('throttling', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootAuth({ THROTTLE_ENABLED: 'true' });
  });
  afterAll(() => h.close());

  it('limits sensitive endpoints per client with 429 RATE_LIMITED, and never throttles probes', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await h
            .http()
            .post('/auth/forgot-password')
            .send({ email: 'a@example.com' })
        ).status,
      );
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);

    const limited = await h
      .http()
      .post('/auth/forgot-password')
      .send({ email: 'a@example.com' });
    expect(errorCodeOf(limited)).toBe('RATE_LIMITED');
    expect((limited.body as { message: string }).message).toBe(
      'Too many requests',
    );
    expect(limited.headers['retry-after']).toBeDefined();

    for (let i = 0; i < 150; i++) {
      expect((await h.http().get('/healthz')).status).toBe(200);
    }
  });

  it('login has its own limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (
          await h
            .http()
            .post('/auth/login')
            .send({ email: 'z@example.com', password: 'x' })
        ).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
