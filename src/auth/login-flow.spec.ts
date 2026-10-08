import {
  Harness,
  bootAuth,
  dataOf,
  errorCodeOf,
  totpNow,
} from '../../test/helpers/auth-harness';

/**
 * Integration tests of the login state machine: the real Nest app (guards, pipes, filter,
 * envelope) over an in-memory database, with every delivery channel captured.
 */

interface Login {
  status: string;
  next_step: string | null;
  challenge_token?: string;
  mfa_method?: string;
  access_token?: string;
  refresh_token?: string;
  user?: Record<string, unknown>;
}

type Mfa = 'none' | 'totp' | 'otp';

const enrollTotp = async (h: Harness, email: string) => {
  const tokens = await h.signIn(email);
  const auth = h.bearer(tokens.access_token);
  const setup = dataOf<{ secret: string }>(
    await h.http().post('/auth/mfa/totp/setup').set(auth).expect(200),
  );
  const confirmed = dataOf<{ recovery_codes: string[] }>(
    await h
      .http()
      .post('/auth/mfa/totp/confirm')
      .set(auth)
      .send({ code: totpNow(setup.secret) })
      .expect(201),
  );
  return { secret: setup.secret, recovery_codes: confirmed.recovery_codes };
};

const combos: Array<{ methods: string; mfa: Mfa }> = [
  { methods: 'password', mfa: 'none' },
  { methods: 'password', mfa: 'totp' },
  { methods: 'password', mfa: 'otp' },
  { methods: 'password,otp', mfa: 'none' },
  { methods: 'password,otp', mfa: 'totp' },
  { methods: 'password,otp', mfa: 'otp' },
];

describe.each(combos)(
  'login flow: AUTH_METHODS=$methods AUTH_MFA=$mfa',
  ({ methods, mfa }) => {
    let h: Harness;
    beforeAll(async () => {
      h = await bootAuth({ AUTH_METHODS: methods, AUTH_MFA: mfa });
    });
    afterAll(() => h.close());

    const hasOtp = methods.includes('otp');

    it('password login follows the configured states and always has the same shape', async () => {
      const user = await h.user();
      const totp = mfa === 'totp' ? await enrollTotp(h, user.email) : null;

      const first = dataOf<Login>(await h.login(user.email).expect(200));

      if (mfa === 'none') {
        expect(first).toMatchObject({
          status: 'authenticated',
          next_step: null,
          token_type: 'Bearer',
        });
        expect(first.access_token).toEqual(expect.any(String));
        expect(first.refresh_token).toEqual(expect.any(String));
        expect(first.user).toMatchObject({ email: user.email });
        expect(JSON.stringify(first)).not.toContain('password_hash');
        return;
      }

      expect(first).toMatchObject({
        status: 'mfa_required',
        next_step: 'verify_mfa',
        mfa_method: mfa,
      });
      expect(first.access_token).toBeUndefined();

      const code = mfa === 'totp' ? totpNow(totp!.secret, 1) : h.lastOtp();
      const done = dataOf<Login>(
        await h
          .http()
          .post('/auth/mfa/verify')
          .send({ challenge_token: first.challenge_token, code })
          .expect(200),
      );
      expect(done).toMatchObject({ status: 'authenticated', next_step: null });
    });

    if (hasOtp) {
      it('passwordless login: otp_required, then the emailed code', async () => {
        const user = await h.user();
        const totp = mfa === 'totp' ? await enrollTotp(h, user.email) : null;

        const first = dataOf<Login>(
          await h
            .http()
            .post('/auth/login')
            .send({ email: user.email })
            .expect(200),
        );
        expect(first).toMatchObject({
          status: 'otp_required',
          next_step: 'verify_otp',
        });
        expect(first.access_token).toBeUndefined();

        const second = dataOf<Login>(
          await h
            .http()
            .post('/auth/login/otp')
            .send({ challenge_token: first.challenge_token, code: h.lastOtp() })
            .expect(200),
        );

        if (mfa === 'totp') {
          // The authenticator is still required after an emailed-code login.
          expect(second).toMatchObject({
            status: 'mfa_required',
            mfa_method: 'totp',
          });
          const done = dataOf<Login>(
            await h
              .http()
              .post('/auth/mfa/verify')
              .send({
                challenge_token: second.challenge_token,
                code: totpNow(totp!.secret, 1),
              })
              .expect(200),
          );
          expect(done.status).toBe('authenticated');
        } else {
          // `none`: done. `otp`: skipped, the mailbox was just proven by the first code.
          expect(second).toMatchObject({
            status: 'authenticated',
            next_step: null,
          });
        }
      });
    } else {
      it('passwordless login is rejected with a validation error', async () => {
        const user = await h.user();
        const res = await h
          .http()
          .post('/auth/login')
          .send({ email: user.email })
          .expect(422);
        expect(res.body).toMatchObject({
          error_code: 'VALIDATION_ERROR',
          errors: [{ field: 'password' }],
        });
      });
    }
  },
);

describe('login: credential handling', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootAuth({
      AUTH_MAX_FAILED_LOGINS: '3',
      AUTH_LOCKOUT_MINUTES: '10',
    });
  });
  afterAll(() => h.close());

  it('gives the same answer for a wrong password and an unknown address', async () => {
    const user = await h.user();
    const wrong = await h.login(user.email, 'not-the-password').expect(401);
    const unknown = await h
      .login('nobody@example.com', 'whatever-123')
      .expect(401);
    expect(errorCodeOf(wrong)).toBe('INVALID_CREDENTIALS');
    expect(errorCodeOf(unknown)).toBe('INVALID_CREDENTIALS');
    expect((wrong.body as { message: string }).message).toBe(
      (unknown.body as { message: string }).message,
    );
  });

  it('is case/whitespace-insensitive on the email', async () => {
    const user = await h.user({ email: 'mixed.case@example.com' });
    await h.login('  Mixed.Case@Example.COM ').expect(200);
    expect(user.email).toBe('mixed.case@example.com');
  });

  it('validates the body (422) and rejects unknown fields', async () => {
    await h.http().post('/auth/login').send({ email: 'nope' }).expect(422);
    await h
      .http()
      .post('/auth/login')
      .send({ email: 'a@example.com', password: 'x', role: 'superadmin' })
      .expect(422);
  });

  it('locks after N failures with back-off, tells the owner once, hides the lock, and resets on success', async () => {
    const user = await h.user();
    const row = () =>
      h.prisma.user.rows.find((r) => r.id === user.id) as Record<
        string,
        unknown
      >;

    for (let i = 0; i < 3; i++) {
      await h.login(user.email, 'wrong-password').expect(401);
    }
    expect(row().failed_login_attempts).toBe(3);
    expect(row().locked_until).toBeInstanceOf(Date);
    expect(h.mail.locked).toHaveLength(1);
    expect(h.mail.locked[0].email).toBe(user.email);

    // While locked even the right password answers like a wrong one, and the lock is not extended.
    const lockedUntil = row().locked_until as Date;
    const res = await h.login(user.email).expect(401);
    expect(errorCodeOf(res)).toBe('INVALID_CREDENTIALS');
    expect(row().locked_until).toEqual(lockedUntil);
    expect(row().failed_login_attempts).toBe(3);

    // Lock expires -> another failure doubles the duration but does not notify again.
    row().locked_until = new Date(Date.now() - 1000);
    await h.login(user.email, 'wrong-again').expect(401);
    expect(row().failed_login_attempts).toBe(4);
    const minutes =
      ((row().locked_until as Date).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(19);
    expect(minutes).toBeLessThanOrEqual(20);
    expect(h.mail.locked).toHaveLength(1);

    // A correct login after the lock resets everything.
    row().locked_until = new Date(Date.now() - 1000);
    await h.login(user.email).expect(200);
    expect(row().failed_login_attempts).toBe(0);
    expect(row().locked_until).toBeNull();
  });

  it('refuses disabled accounts (after the password is proven) and unverified emails', async () => {
    const disabled = await h.user({ is_active: false });
    const res = await h.login(disabled.email).expect(403);
    expect(errorCodeOf(res)).toBe('ACCOUNT_DISABLED');

    const unverified = await h.user({ email_verified_at: null });
    const res2 = await h.login(unverified.email).expect(403);
    expect(errorCodeOf(res2)).toBe('EMAIL_NOT_VERIFIED');
  });

  it('does not log in soft-deleted users or accounts without a password', async () => {
    const deleted = await h.user({ deleted_at: new Date() });
    await h.login(deleted.email).expect(401);
    const invited = await h.user({ password_hash: null });
    await h.login(invited.email, 'anything-at-all').expect(401);
  });
});

describe('login: email verification flag', () => {
  it('can be switched off', async () => {
    const h = await bootAuth({ AUTH_REQUIRE_EMAIL_VERIFICATION: 'false' });
    const user = await h.user({ email_verified_at: null });
    await h.login(user.email).expect(200);
    await h.close();
  });
});

describe('passwordless OTP login: security', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootAuth({
      AUTH_METHODS: 'password,otp',
      AUTH_OTP_MAX_ATTEMPTS: '3',
    });
  });
  afterAll(() => h.close());

  const start = async (email: string) =>
    dataOf<Login>(
      await h.http().post('/auth/login').send({ email }).expect(200),
    );
  const submit = (challenge_token: string | undefined, code: string) =>
    h.http().post('/auth/login/otp').send({ challenge_token, code });

  it('does not reveal whether the account exists (decoy challenge)', async () => {
    const real = await h.user();
    const a = await start(real.email);
    const b = await start('ghost@example.com');
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a.status).toBe(b.status);
    expect(h.mail.otps.map((m) => m.email)).toEqual([real.email]);

    // A wrong code and a decoy challenge fail identically.
    const wrongReal = await submit(a.challenge_token, '000000').expect(401);
    const decoy = await submit(b.challenge_token, '000000').expect(401);
    expect(errorCodeOf(wrongReal)).toBe(errorCodeOf(decoy));
  });

  it('a challenge is single use', async () => {
    const user = await h.user();
    const c = await start(user.email);
    const code = h.lastOtp();
    await submit(c.challenge_token, code).expect(200);
    const again = await submit(c.challenge_token, code).expect(401);
    expect(errorCodeOf(again)).toBe('INVALID_TOKEN');
  });

  it('limits attempts: after N wrong codes even the right one is refused (finding 3.1)', async () => {
    const user = await h.user();
    const c = await start(user.email);
    const code = h.lastOtp();
    for (let i = 0; i < 3; i++) {
      const res = await submit(c.challenge_token, '999999').expect(401);
      expect(errorCodeOf(res)).toBe('INVALID_CODE');
    }
    const res = await submit(c.challenge_token, code).expect(401);
    expect(errorCodeOf(res)).toBe('INVALID_TOKEN');
  });

  it('an unverified mailbox is verified by the code; disabled and locked accounts get no code', async () => {
    const fresh = await h.user({ email_verified_at: null });
    const c = await start(fresh.email);
    await submit(c.challenge_token, h.lastOtp()).expect(200);
    expect(
      h.prisma.user.rows.find((r) => r.id === fresh.id)?.email_verified_at,
    ).toBeInstanceOf(Date);

    const before = h.mail.otps.length;
    const disabled = await h.user({ is_active: false });
    const locked = await h.user({
      locked_until: new Date(Date.now() + 60_000),
    });
    await start(disabled.email);
    await start(locked.email);
    expect(h.mail.otps).toHaveLength(before);
  });

  it('rejects garbage and wrong-stage tokens', async () => {
    await submit('not-a-jwt', '123456').expect(401);
    await h
      .http()
      .post('/auth/mfa/verify')
      .send({ challenge_token: 'not-a-jwt', code: '123456' })
      .expect(401);
    // An otp-stage challenge cannot be used at the MFA endpoint
    const user = await h.user();
    const c = await start(user.email);
    const res = await h
      .http()
      .post('/auth/mfa/verify')
      .send({ challenge_token: c.challenge_token, code: h.lastOtp() })
      .expect(401);
    expect(errorCodeOf(res)).toBe('INVALID_TOKEN');
  });

  it('checks lockout and account state at the second step too (finding 3.2)', async () => {
    const user = await h.user();
    const c = await start(user.email);
    const code = h.lastOtp();
    h.prisma.user.rows.find((r) => r.id === user.id)!.locked_until = new Date(
      Date.now() + 60_000,
    );
    const res = await submit(c.challenge_token, code).expect(401);
    expect(errorCodeOf(res)).toBe('INVALID_CODE');
  });
});

describe('TOTP second factor: security', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootAuth({ AUTH_MFA: 'totp', AUTH_OTP_MAX_ATTEMPTS: '3' });
  });
  afterAll(() => h.close());

  const challenge = async (email: string) =>
    dataOf<Login>(await h.login(email).expect(200)).challenge_token;
  const verify = (challenge_token: string | undefined, code: string) =>
    h.http().post('/auth/mfa/verify').send({ challenge_token, code });

  it('rejects a replayed code within its window (finding 3.4)', async () => {
    const user = await h.user();
    const { secret } = await enrollTotp(h, user.email);
    // enrolment consumed the current step; the next step is fine, replaying it is not
    const code = totpNow(secret, 1);
    await verify(await challenge(user.email), code).expect(200);
    const replay = await verify(await challenge(user.email), code).expect(401);
    expect(errorCodeOf(replay)).toBe('INVALID_CODE');
  });

  it('recovery codes work once each (finding 3.3)', async () => {
    const user = await h.user();
    const { recovery_codes } = await enrollTotp(h, user.email);
    expect(recovery_codes).toHaveLength(10);
    expect(recovery_codes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

    await verify(await challenge(user.email), recovery_codes[0]).expect(200);
    // lower-case / without dash is accepted, but the code is already spent
    const spent = await verify(
      await challenge(user.email),
      recovery_codes[0].toLowerCase().replace('-', ''),
    ).expect(401);
    expect(errorCodeOf(spent)).toBe('INVALID_CODE');
    // another one still works
    await verify(await challenge(user.email), recovery_codes[1]).expect(200);
    // only hashes are stored
    expect(JSON.stringify(h.prisma.mfaRecoveryCode.rows)).not.toContain(
      recovery_codes[2],
    );
  });

  it('limits attempts per challenge', async () => {
    const user = await h.user();
    const { secret } = await enrollTotp(h, user.email);
    const token = await challenge(user.email);
    for (let i = 0; i < 3; i++) await verify(token, '000000').expect(401);
    const res = await verify(token, totpNow(secret, 1)).expect(401);
    expect(errorCodeOf(res)).toBe('INVALID_TOKEN');
  });

  it('wrong codes count towards the account lockout', async () => {
    const user = await h.user();
    await enrollTotp(h, user.email);
    const token = await challenge(user.email);
    await verify(token, '000000').expect(401);
    expect(
      h.prisma.user.rows.find((r) => r.id === user.id)?.failed_login_attempts,
    ).toBe(1);
  });

  it('stores the secret encrypted and never returns it again', async () => {
    const user = await h.user();
    const { secret } = await enrollTotp(h, user.email);
    const stored = h.prisma.mfaSecret.rows.find((r) => r.user_id === user.id)!;
    expect(String(stored.secret)).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(stored.pending_secret).toBeNull();
  });
});
