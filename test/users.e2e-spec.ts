import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { TokenService } from '../src/auth/core/token.service';
import { createApp } from './helpers/create-app';
import { PrismaMock } from './helpers/prisma-mock';

const ADMIN = 'a0000000-0000-4000-8000-000000000001';
const TARGET = '0f8fad5b-d9cb-469f-a165-70867728950e';

const row = (overrides: object = {}) => ({
  id: TARGET,
  email: 'target@example.com',
  password_hash: 'secret-hash',
  name: 'Target',
  role: 'user',
  is_active: true,
  email_verified_at: new Date(),
  mfa_enabled: false,
  failed_login_attempts: 0,
  locked_until: null,
  token_version: 0,
  last_login_at: null,
  created_at: new Date('2026-09-01T00:00:00Z'),
  updated_at: new Date('2026-09-02T00:00:00Z'),
  deleted_at: null,
  created_by: null,
  updated_by: null,
  ...overrides,
});

describe('Users (e2e, mocked Prisma)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaMock;
  const http = () => request(app.getHttpServer());
  const as = (role: 'superadmin' | 'admin' | 'user') => ({
    Authorization: `Bearer ${
      app.get(TokenService).signAccess({
        userId: ADMIN,
        email: `${role}@example.com`,
        role,
        sessionId: 'b0000000-0000-4000-8000-000000000002',
        tokenVersion: 0,
      }).token
    }`,
  });

  beforeEach(async () => {
    // Trust the token claims here; per-request DB verification is covered in auth.e2e-spec.ts.
    ({ app, prisma } = await createApp({
      env: { AUTH_VERIFY_USER_PER_REQUEST: 'false' },
    }));
  });
  afterEach(async () => {
    await app.close();
  });

  it('is guarded globally: 401 UNAUTHENTICATED without a token', async () => {
    const res = await http().get('/users').expect(401);
    expect(res.body).toMatchObject({ error_code: 'UNAUTHENTICATED' });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('403 for a plain user (no users.* permission)', async () => {
    const res = await http().get('/users').set(as('user')).expect(403);
    expect(res.body).toMatchObject({ error_code: 'FORBIDDEN' });
  });

  describe('GET /users', () => {
    it('returns { data, meta } with mapped users and no secrets', async () => {
      prisma.user.findMany.mockResolvedValue([row()]);
      prisma.user.count.mockResolvedValue(1);
      const res = await http()
        .get('/users')
        .query({
          page: 1,
          page_size: 10,
          filter: { role: 'user', is_active: 'true' },
          search: 'tar',
        })
        .set(as('admin'))
        .expect(200);
      expect(res.body).toMatchObject({
        data: [
          { id: TARGET, email: 'target@example.com', email_verified: true },
        ],
        meta: { current_page: 1, page_size: 10, total: 1, last_page: 1 },
      });
      expect(JSON.stringify(res.body)).not.toContain('secret-hash');
    });

    it('parses bracketed filters from the raw URL (filter[x]=y)', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);
      await http()
        .get(
          '/users?filter[role]=admin,user&filter[created_between]=2026-01-01,2026-01-31&sort=-name,email&page_size=500',
        )
        .set(as('admin'))
        .expect(200);
      const args = prisma.user.findMany.mock.calls[0][0] as {
        where: { AND: object[] };
        orderBy: object[];
        take: number;
      };
      expect(args.where.AND).toEqual(
        expect.arrayContaining([{ role: { in: ['admin', 'user'] } }]),
      );
      expect(args.orderBy).toEqual([
        { name: 'desc' },
        { email: 'asc' },
        { id: 'desc' },
      ]);
      expect(args.take).toBe(100); // capped
    });

    it.each([
      ['/users?filter[password_hash]=x', 'UNKNOWN_FILTER'],
      ['/users?sort=password_hash', 'UNKNOWN_SORT'],
      ['/users?include=sessions', 'UNKNOWN_INCLUDE'],
      ['/users?filter[role]=owner', 'INVALID_QUERY'],
      ['/users?page=0', 'INVALID_QUERY'],
      ['/users?filter[created_between]=yesterday,today', 'INVALID_QUERY'],
    ])('400 for %s', async (url, code) => {
      const res = await http().get(url).set(as('admin')).expect(400);
      expect(res.body).toMatchObject({ error_code: code });
      expect((res.body as { errors: unknown[] }).errors.length).toBeGreaterThan(
        0,
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /users/:id', () => {
    it('400 for a non-UUID id', async () => {
      await http().get('/users/not-a-uuid').set(as('admin')).expect(400);
    });
    it('404 when missing', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const res = await http()
        .get(`/users/${TARGET}`)
        .set(as('admin'))
        .expect(404);
      expect(res.body).toMatchObject({ error_code: 'NOT_FOUND' });
    });
    it('200 { data }', async () => {
      prisma.user.findFirst.mockResolvedValue(row());
      const res = await http()
        .get(`/users/${TARGET}`)
        .set(as('admin'))
        .expect(200);
      expect(res.body).toMatchObject({ data: { id: TARGET, role: 'user' } });
    });
  });

  describe('POST /users/invitations', () => {
    const create = (
      body: object,
      role: 'superadmin' | 'admin' | 'user' = 'admin',
    ) => http().post('/users/invitations').set(as(role)).send(body);

    it('201, normalises email, never returns the token, and audits', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.userInvitation.create.mockImplementation((args) =>
        Promise.resolve({
          id: 'inv-1',
          created_at: new Date(),
          ...(args as { data: object }).data,
        }),
      );
      const res = await create({
        email: ' New@Example.com ',
        role: 'user',
      }).expect(201);
      expect(res.body).toMatchObject({
        data: { id: 'inv-1', email: 'new@example.com', role: 'user' },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/token/);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actor_id: ADMIN,
          action: 'user.invite',
          entity_type: 'user_invitation',
          entity_id: 'inv-1',
        }) as object,
      });
    });

    it('403 when assigning a role at or above your own, 422 on bad input, 409 on duplicates', async () => {
      await create({ email: 'a@example.com', role: 'admin' }).expect(403);
      await create({ email: 'nope', role: 'user' }).expect(422);
      await create({ email: 'a@example.com', role: 'user', extra: 1 }).expect(
        422,
      );
      prisma.user.findUnique.mockResolvedValue(row());
      const res = await create({
        email: 'target@example.com',
        role: 'user',
      }).expect(409);
      expect(res.body).toMatchObject({ error_code: 'CONFLICT' });
    });
  });

  describe('mutations', () => {
    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue(row());
      prisma.user.update.mockResolvedValue(
        row({ is_active: false, name: 'Renamed' }),
      );
    });

    it('PATCH updates and audits', async () => {
      const res = await http()
        .patch(`/users/${TARGET}`)
        .set(as('admin'))
        .send({ name: 'Renamed' })
        .expect(200);
      expect(res.body).toMatchObject({ data: { name: 'Renamed' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'user.update',
          entity_id: TARGET,
        }) as object,
      });
    });

    it('PATCH rejects unknown fields and invalid roles (422)', async () => {
      await http()
        .patch(`/users/${TARGET}`)
        .set(as('admin'))
        .send({ is_active: true })
        .expect(422);
      await http()
        .patch(`/users/${TARGET}`)
        .set(as('admin'))
        .send({ role: 'owner' })
        .expect(422);
    });

    it('POST /deactivate returns 200 { data } and revokes access', async () => {
      const res = await http()
        .post(`/users/${TARGET}/deactivate`)
        .set(as('admin'))
        .expect(200);
      expect(res.body).toMatchObject({ data: { is_active: false } });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(prisma.userSession.updateMany).toHaveBeenCalled();
    });

    it('POST /force-logout and DELETE return 204 with an empty body', async () => {
      const a = await http()
        .post(`/users/${TARGET}/force-logout`)
        .set(as('admin'))
        .expect(204);
      expect(a.text).toBe('');
      // users.delete is superadmin-only in the permission matrix
      const denied = await http()
        .delete(`/users/${TARGET}`)
        .set(as('admin'))
        .expect(403);
      expect(denied.body).toMatchObject({ error_code: 'FORBIDDEN' });
      await http().delete(`/users/${TARGET}`).set(as('superadmin')).expect(204);
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'user.delete' }) as object,
      });
    });

    it('403 on a peer or higher role and does not audit failures', async () => {
      prisma.user.findFirst.mockResolvedValue(row({ role: 'admin' }));
      await http()
        .post(`/users/${TARGET}/deactivate`)
        .set(as('admin'))
        .expect(403);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
