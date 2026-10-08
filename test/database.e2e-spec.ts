import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { hashPassword } from '../src/common/utils/password.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApp } from './helpers/create-app';

/**
 * Real-database checks. They run only when RUN_DB_TESTS=true and DATABASE_URL points at a
 * database where `npm run migrate` has been applied (CI does exactly that). Locally:
 *   docker compose up -d && npm run migrate && RUN_DB_TESTS=true npm run test:e2e
 * Rows are created under a unique email prefix and cleaned up afterwards.
 */
const enabled = process.env.RUN_DB_TESTS === 'true';
const suite = enabled ? describe : describe.skip;

const run = `e2e-${Date.now()}`;
const email = (name: string) => `${run}-${name}@example.com`;

suite('Users against a real database (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let actorId: string;
  let as: { Authorization: string };
  let refreshToken: string;
  const PASSWORD = 'a-long-e2e-passphrase';

  beforeAll(async () => {
    ({ app } = await createApp({ realDatabase: true }));
    prisma = app.get(PrismaService);
    const actor = await prisma.user.create({
      data: {
        email: email('actor'),
        name: 'Actor',
        role: 'superadmin',
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      },
    });
    actorId = actor.id;

    // Sign in through the real auth flow (also exercises sessions + refresh tokens on a real DB).
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: email('actor'), password: PASSWORD })
      .expect(200);
    const data = (
      login.body as {
        data: { status: string; access_token: string; refresh_token: string };
      }
    ).data;
    expect(data.status).toBe('authenticated');
    as = { Authorization: `Bearer ${data.access_token}` };
    refreshToken = data.refresh_token;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actor_id: actorId } });
    await prisma.userInvitation.deleteMany({
      where: { email: { startsWith: run } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: run } } });
    await app.close();
  });

  it('/readyz reports the database as up', async () => {
    const res = await request(app.getHttpServer()).get('/readyz').expect(200);
    expect(res.body).toMatchObject({ checks: { database: 'up' } });
  });

  it('invite -> list -> deactivate -> soft delete lifecycle', async () => {
    const http = () => request(app.getHttpServer());

    const invited = await http()
      .post('/users/invitations')
      .set(as)
      .send({ email: email('invitee'), role: 'user' })
      .expect(201);
    expect((invited.body as { data: { email: string } }).data.email).toBe(
      email('invitee'),
    );
    // duplicate invitations supersede the pending one
    await http()
      .post('/users/invitations')
      .set(as)
      .send({ email: email('invitee'), role: 'user' })
      .expect(201);
    expect(
      await prisma.userInvitation.count({
        where: { email: email('invitee'), revoked_at: null },
      }),
    ).toBe(1);

    const member = await prisma.user.create({
      data: { email: email('member'), name: 'Member Lifecycle' },
    });
    const list = await http()
      .get(`/users?search=${run}-member`)
      .set(as)
      .expect(200);
    expect(list.body).toMatchObject({
      data: [{ id: member.id }],
      meta: { total: 1, last_page: 1 },
    });

    await http().post(`/users/${member.id}/deactivate`).set(as).expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: member.id } }))
        .token_version,
    ).toBe(1);

    await http().delete(`/users/${member.id}`).set(as).expect(204);
    await http().get(`/users/${member.id}`).set(as).expect(404);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: member.id },
    });
    expect(row.deleted_at).not.toBeNull();

    const audit = await prisma.auditLog.findMany({
      where: { actor_id: actorId },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['user.invite', 'user.deactivate', 'user.delete']),
    );
  });

  it('a "%" search is treated literally (wildcard escaping check)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/users?search=${encodeURIComponent('%')}`)
      .set(as)
      .expect(200);
    const emails = (res.body as { data: Array<{ email: string }> }).data.map(
      (u) => u.email,
    );
    // If "%" were a wildcard it would match every user, including our actor.
    expect(emails).not.toContain(email('actor'));
  });

  it('example module on real PostgreSQL: filters, search, sort, pagination, wildcard escaping, soft delete', async () => {
    const http = () => request(app.getHttpServer());
    const tag = `${run}-ex`;
    const create = (name: string, extra: object = {}) =>
      http()
        .post('/example-items')
        .set(as)
        .send({ name: `${tag} ${name}`, ...extra })
        .expect(201);
    const made = await Promise.all([
      create('alpha', { is_published: true }),
      create('beta 100% done', { description: 'about Q3' }),
      create('gamma_under'),
    ]);
    const idOf = (res: request.Response) =>
      (res.body as { data: { id: string } }).data.id;
    const list = async (query: string) =>
      (await http().get(`/example-items?${query}`).set(as).expect(200))
        .body as {
        data: Array<{ name: string }>;
        meta: { total: number; last_page: number };
      };

    // filter + sort + stable pagination (no overlap, no gap)
    const page1 = await list(`filter[name]=${tag}&sort=name&page_size=2`);
    const page2 = await list(
      `filter[name]=${tag}&sort=name&page=2&page_size=2`,
    );
    expect(page1.meta).toMatchObject({ total: 3, last_page: 2 });
    expect([...page1.data, ...page2.data].map((i) => i.name)).toEqual([
      `${tag} alpha`,
      `${tag} beta 100% done`,
      `${tag} gamma_under`,
    ]);

    // LIKE wildcards are literal: "%" and "_" must not match everything
    expect(
      (await list(`filter[name]=${encodeURIComponent(`${tag} beta 100%`)}`))
        .meta.total,
    ).toBe(1);
    expect(
      (await list(`filter[name]=${encodeURIComponent('%')}`)).data.filter((i) =>
        i.name.startsWith(tag),
      ),
    ).toHaveLength(0);
    expect(
      (await list(`filter[name]=${encodeURIComponent(`${tag} gamma_`)}`)).meta
        .total,
    ).toBe(1);
    expect(
      (await list(`filter[name]=${encodeURIComponent(`${tag} gamm_under`)}`))
        .meta.total,
    ).toBe(0);
    expect((await list(`search=q3&filter[name]=${tag}`)).meta.total).toBe(1);
    expect(
      (await list(`filter[is_published]=true&filter[name]=${tag}`)).meta.total,
    ).toBe(1);

    // soft delete: row stays, disappears from reads
    const victim = idOf(made[0]);
    await http().delete(`/example-items/${victim}`).set(as).expect(204);
    await http().get(`/example-items/${victim}`).set(as).expect(404);
    expect((await list(`filter[name]=${tag}`)).meta.total).toBe(2);
    expect(
      (await prisma.exampleItem.findUniqueOrThrow({ where: { id: victim } }))
        .deleted_at,
    ).not.toBeNull();

    await prisma.exampleItem.deleteMany({
      where: { name: { startsWith: tag } },
    });
  });

  it('refresh rotates the token and reuse revokes the whole session', async () => {
    const http = () => request(app.getHttpServer());
    const first = await http()
      .post('/auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(200);
    const rotated = (
      first.body as { data: { refresh_token: string; access_token: string } }
    ).data;
    expect(rotated.refresh_token).not.toBe(refreshToken);

    // the old token is now "used": presenting it again is reuse
    await http()
      .post('/auth/refresh')
      .send({ refresh_token: refreshToken })
      .expect(401);
    // ... which killed the family, so the freshly rotated token is dead too
    await http()
      .post('/auth/refresh')
      .send({ refresh_token: rotated.refresh_token })
      .expect(401);
    // ... and the session behind the access token (per-request verification is on)
    await http()
      .get('/auth/me')
      .set({ Authorization: `Bearer ${rotated.access_token}` })
      .expect(401);
    await http().get('/auth/me').set(as).expect(401);
  });
});
