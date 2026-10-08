import { Controller, Get, Module } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { TokenService } from '../src/auth/core/token.service';
import { findRoutesWithoutPolicy } from '../src/rbac/route-policy';
import { createApp } from './helpers/create-app';

const SESSION = 'b0000000-0000-4000-8000-000000000002';

/** A route someone forgot to protect: no @Public, @Authenticated, @Roles or @Permissions. */
@Controller('forgotten')
class ForgottenController {
  @Get()
  secret() {
    return { oops: true };
  }
}
@Module({ controllers: [ForgottenController] })
class ForgottenModule {}

describe('RBAC (e2e)', () => {
  let app: NestExpressApplication;
  afterEach(async () => {
    await app?.close();
  });

  const bearer = (role: 'superadmin' | 'admin' | 'user') => ({
    Authorization: `Bearer ${
      app.get(TokenService).signAccess({
        userId: 'a0000000-0000-4000-8000-000000000001',
        email: `${role}@example.com`,
        role,
        sessionId: SESSION,
        tokenVersion: 0,
      }).token
    }`,
  });

  const boot = async (extraModules: Array<new () => unknown> = []) => {
    ({ app } = await createApp({
      env: { AUTH_VERIFY_USER_PER_REQUEST: 'false' },
      extraModules,
    }));
  };

  it('every route of the real app declares an access policy', async () => {
    await boot();
    expect(findRoutesWithoutPolicy(app)).toEqual([]);
  });

  it('the policy check flags a forgotten route, and the guard denies it at runtime (fail-closed)', async () => {
    await boot([ForgottenModule]);
    expect(findRoutesWithoutPolicy(app)).toEqual([
      'ForgottenController.secret',
    ]);
    for (const role of ['user', 'admin', 'superadmin'] as const) {
      const res = await request(app.getHttpServer())
        .get('/forgotten')
        .set(bearer(role))
        .expect(403);
      expect(res.body).toMatchObject({ error_code: 'FORBIDDEN' });
    }
    // unauthenticated is still a 401 (the JWT guard runs first)
    await request(app.getHttpServer()).get('/forgotten').expect(401);
  });

  it('GET /rbac/permissions reflects the matrix for the caller', async () => {
    await boot();
    const get = (role: 'superadmin' | 'admin' | 'user') =>
      request(app.getHttpServer()).get('/rbac/permissions').set(bearer(role));

    const user = await get('user').expect(200);
    expect(user.body).toEqual({
      data: { role: 'user', permissions: ['example.read'] },
    });

    const admin = (await get('admin').expect(200)).body as {
      data: { role: string; permissions: string[] };
    };
    expect(admin.data.permissions).toContain('users.read');
    expect(admin.data.permissions).not.toContain('users.delete');

    const root = (await get('superadmin').expect(200)).body as {
      data: { permissions: string[] };
    };
    expect(root.data.permissions).toContain('users.delete');

    await request(app.getHttpServer()).get('/rbac/permissions').expect(401);
  });

  it('authenticated-only routes work for every role (no permission needed)', async () => {
    await boot();
    for (const role of ['user', 'admin', 'superadmin'] as const) {
      // /auth/sessions is @Authenticated; with token verification off it only needs a valid token
      await request(app.getHttpServer())
        .get('/auth/sessions')
        .set(bearer(role))
        .then((res) => expect(res.status).not.toBe(403));
    }
  });
});
