import { JwtService } from '@nestjs/jwt';
import {
  Harness,
  Tokens,
  bootAuth,
  dataOf,
  errorCodeOf,
} from '../../test/helpers/auth-harness';
import { baseEnv } from '../../test/helpers/test-env';

const refresh = (h: Harness, refresh_token: string) =>
  h.http().post('/auth/refresh').send({ refresh_token });

const me = (h: Harness, access: string) =>
  h.http().get('/auth/me').set(h.bearer(access));

describe('refresh tokens', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootAuth();
  });
  afterAll(() => h.close());

  it('rotates: each refresh returns a new pair and the old token is spent', async () => {
    const user = await h.user();
    const first = await h.signIn(user.email);
    const res = await refresh(h, first.refresh_token).expect(200);
    const next = dataOf<Tokens & { token_type: string; expires_in: number }>(
      res,
    );
    expect(next.refresh_token).not.toBe(first.refresh_token);
    expect(next).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
    await me(h, next.access_token).expect(200);
    // only a hash of each refresh token is stored
    expect(JSON.stringify(h.prisma.refreshToken.rows)).not.toContain(
      first.refresh_token,
    );
  });

  it('reuse of a spent token revokes the whole family and its session (finding 3.6)', async () => {
    const user = await h.user();
    const first = await h.signIn(user.email);
    const second = dataOf<Tokens>(
      await refresh(h, first.refresh_token).expect(200),
    );

    const reuse = await refresh(h, first.refresh_token).expect(401);
    expect(errorCodeOf(reuse)).toBe('INVALID_TOKEN');

    // the freshly rotated token and the session's access token died with it
    await refresh(h, second.refresh_token).expect(401);
    await me(h, second.access_token).expect(401);
    await me(h, first.access_token).expect(401);
    expect(h.prisma.actions()).toContain('auth.refresh_reuse_detected');
  });

  it('only one of two simultaneous refreshes with the same token wins', async () => {
    const user = await h.user();
    const first = await h.signIn(user.email);
    const results = await Promise.all([
      refresh(h, first.refresh_token),
      refresh(h, first.refresh_token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('rejects unknown, expired and revoked tokens', async () => {
    const user = await h.user();
    const tokens = await h.signIn(user.email);
    await refresh(h, 'definitely-not-a-token').expect(401);
    await h.http().post('/auth/refresh').send({}).expect(422);

    const row = h.prisma.refreshToken.rows.find((r) => r.user_id === user.id)!;
    row.expires_at = new Date(Date.now() - 1000);
    await refresh(h, tokens.refresh_token).expect(401);
  });

  it('refuses to refresh for a disabled user and kills the session', async () => {
    const user = await h.user();
    const tokens = await h.signIn(user.email);
    h.prisma.user.rows.find((r) => r.id === user.id)!.is_active = false;
    await refresh(h, tokens.refresh_token).expect(401);
    h.prisma.user.rows.find((r) => r.id === user.id)!.is_active = true;
    // the family was revoked, so re-enabling the user does not resurrect it
    await refresh(h, tokens.refresh_token).expect(401);
  });
});

describe('sessions, logout and the global guard', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await bootAuth();
  });
  afterAll(() => h.close());

  it('logout revokes only the current session and takes effect immediately', async () => {
    const user = await h.user();
    const a = await h.signIn(user.email);
    const b = await h.signIn(user.email);

    await h
      .http()
      .post('/auth/logout')
      .set(h.bearer(a.access_token))
      .expect(204);
    await me(h, a.access_token).expect(401);
    await refresh(h, a.refresh_token).expect(401);

    await me(h, b.access_token).expect(200);
    expect(h.prisma.actions()).toContain('auth.logout');
  });

  it('logout-all kills every session of the user, and nobody else', async () => {
    const user = await h.user();
    const other = await h.user();
    const a = await h.signIn(user.email);
    const b = await h.signIn(user.email);
    const o = await h.signIn(other.email);

    await h
      .http()
      .post('/auth/logout-all')
      .set(h.bearer(a.access_token))
      .expect(204);
    await me(h, a.access_token).expect(401);
    await me(h, b.access_token).expect(401);
    await refresh(h, b.refresh_token).expect(401);
    await me(h, o.access_token).expect(200);
  });

  it('lists active sessions and revokes one of your own', async () => {
    const user = await h.user();
    const a = await h.signIn(user.email);
    const b = await h.signIn(user.email);

    const list = dataOf<Array<{ id: string; current: boolean }>>(
      await h
        .http()
        .get('/auth/sessions')
        .set(h.bearer(a.access_token))
        .expect(200),
    );
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);

    const other = list.find((s) => !s.current)!;
    await h
      .http()
      .delete(`/auth/sessions/${other.id}`)
      .set(h.bearer(a.access_token))
      .expect(204);
    await me(h, b.access_token).expect(401);
    await h
      .http()
      .delete(`/auth/sessions/${other.id}`)
      .set(h.bearer(a.access_token))
      .expect(404);
    await h
      .http()
      .delete('/auth/sessions/not-a-uuid')
      .set(h.bearer(a.access_token))
      .expect(400);
  });

  it('cannot revoke somebody else’s session', async () => {
    const mine = await h.user();
    const theirs = await h.user();
    const a = await h.signIn(mine.email);
    const t = await h.signIn(theirs.email);
    const theirSession = dataOf<Array<{ id: string }>>(
      await h
        .http()
        .get('/auth/sessions')
        .set(h.bearer(t.access_token))
        .expect(200),
    )[0];
    await h
      .http()
      .delete(`/auth/sessions/${theirSession.id}`)
      .set(h.bearer(a.access_token))
      .expect(404);
    await me(h, t.access_token).expect(200);
  });

  it('me / profile update', async () => {
    const user = await h.user({ name: 'Old Name' });
    const t = await h.signIn(user.email);
    const res = await me(h, t.access_token).expect(200);
    expect(dataOf(res)).toMatchObject({ email: user.email, name: 'Old Name' });
    expect(JSON.stringify(res.body)).not.toContain('password');

    const updated = await h
      .http()
      .patch('/auth/me')
      .set(h.bearer(t.access_token))
      .send({ name: '  New Name ' })
      .expect(200);
    expect(dataOf(updated)).toMatchObject({ name: 'New Name' });
    await h
      .http()
      .patch('/auth/me')
      .set(h.bearer(t.access_token))
      .send({ name: '', role: 'superadmin' })
      .expect(422);
  });

  describe('access token validation', () => {
    const jwt = new JwtService();
    const claims = {
      email: 'x@example.com',
      role: 'superadmin',
      sid: '00000000-0000-4000-8000-000000000001',
      ver: 0,
    };

    it.each([
      ['no header', undefined],
      ['wrong scheme', 'Basic abc'],
      ['empty bearer', 'Bearer '],
      ['garbage', 'Bearer not.a.jwt'],
    ])('401 for %s', async (_label, header) => {
      const req = h.http().get('/auth/me');
      if (header !== undefined) req.set('Authorization', header);
      const res = await req.expect(401);
      expect(errorCodeOf(res)).toBe('UNAUTHENTICATED');
    });

    it('401 for expired, foreign-secret, wrong-audience and alg=none tokens', async () => {
      const user = await h.user();
      const sign = (secret: string, extra: object, audience = 'access') =>
        jwt.sign(
          { ...claims, ...extra },
          {
            secret,
            subject: user.id,
            audience,
            algorithm: 'HS256',
            ...(extra as { expiresIn?: number }),
          },
        );
      const secret = baseEnv.AUTH_ACCESS_SECRET;

      const expired = sign(secret, { expiresIn: -10 });
      const foreign = sign('x'.repeat(40), { expiresIn: 60 });
      // a challenge/verification-audience token must not work as an access token
      const wrongAudience = sign(secret, { expiresIn: 60 }, 'email-verify');
      const none = [
        Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'),
        Buffer.from(
          JSON.stringify({ ...claims, sub: user.id, aud: 'access' }),
        ).toString('base64url'),
        '',
      ].join('.');

      for (const token of [expired, foreign, wrongAudience, none]) {
        await me(h, token).expect(401);
      }
    });

    it('a token signed for a nonexistent session is rejected (per-request verification)', async () => {
      const user = await h.user();
      const token = jwt.sign(claims, {
        secret: baseEnv.AUTH_ACCESS_SECRET,
        subject: user.id,
        audience: 'access',
        expiresIn: 60,
      });
      await me(h, token).expect(401);
    });
  });
});

describe('per-request user verification (AUTH_VERIFY_USER_PER_REQUEST)', () => {
  describe('on (default): changes take effect immediately (finding 3.7)', () => {
    let h: Harness;
    beforeAll(async () => {
      h = await bootAuth();
    });
    afterAll(() => h.close());

    it('deactivation, deletion and token_version bumps invalidate live access tokens', async () => {
      const row = (id: string) => h.prisma.user.rows.find((r) => r.id === id)!;

      const a = await h.user();
      const ta = await h.signIn(a.email);
      row(a.id).is_active = false;
      await me(h, ta.access_token).expect(401);

      const b = await h.user();
      const tb = await h.signIn(b.email);
      row(b.id).deleted_at = new Date();
      await me(h, tb.access_token).expect(401);

      const c = await h.user();
      const tc = await h.signIn(c.email);
      (row(c.id).token_version as number) += 1;
      await me(h, tc.access_token).expect(401);
    });

    it('uses the role stored in the database, not the one in the token', async () => {
      const user = await h.user({ role: 'user' });
      const t = await h.signIn(user.email);
      await h.http().get('/users').set(h.bearer(t.access_token)).expect(403);
      h.prisma.user.rows.find((r) => r.id === user.id)!.role = 'admin';
      await h.http().get('/users').set(h.bearer(t.access_token)).expect(200);
    });

    it('an admin deactivating a user ends that user’s sessions at once', async () => {
      const admin = await h.user({ role: 'admin' });
      const target = await h.user({ role: 'user' });
      const adminTokens = await h.signIn(admin.email);
      const targetTokens = await h.signIn(target.email);
      await me(h, targetTokens.access_token).expect(200);

      await h
        .http()
        .post(`/users/${target.id}/deactivate`)
        .set(h.bearer(adminTokens.access_token))
        .expect(200);

      await me(h, targetTokens.access_token).expect(401);
      await refresh(h, targetTokens.refresh_token).expect(401);
      const login = await h.login(target.email).expect(403);
      expect(errorCodeOf(login)).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('off: the token is trusted until it expires', () => {
    let h: Harness;
    beforeAll(async () => {
      h = await bootAuth({ AUTH_VERIFY_USER_PER_REQUEST: 'false' });
    });
    afterAll(() => h.close());

    it('logout does not kill the already-issued access token (documented trade-off)', async () => {
      const user = await h.user();
      const t = await h.signIn(user.email);
      await h
        .http()
        .post('/auth/logout')
        .set(h.bearer(t.access_token))
        .expect(204);
      await me(h, t.access_token).expect(200);
      // ...but the refresh token is dead, so it cannot be renewed
      await refresh(h, t.refresh_token).expect(401);
    });
  });
});
