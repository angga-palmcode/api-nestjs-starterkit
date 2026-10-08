import {
  Harness,
  bootAuth,
  dataOf,
  errorCodeOf,
} from '../../test/helpers/auth-harness';

/**
 * End-to-end tests of the reference module: the real app (auth, permissions, pipes, query
 * builder, envelope, audit) over the in-memory database. Copy this file with the module.
 */

interface Item {
  id: string;
  name: string;
  description: string | null;
  is_published: boolean;
  created_by: string | null;
}

describe('example module', () => {
  let h: Harness;
  let admin: { auth: { Authorization: string }; id: string };
  let plain: { auth: { Authorization: string }; id: string };

  const items = () => h.http();
  const seed = async (name: string, extra: Record<string, unknown> = {}) =>
    (await h.prisma.exampleItem.create({
      data: { name, ...extra },
    })) as { id: string };
  const row = (id: string) =>
    h.prisma.exampleItem.rows.find((r) => r.id === id) as Record<
      string,
      unknown
    >;

  const login = async (role: 'admin' | 'user') => {
    const user = await h.user({ role });
    const tokens = await h.signIn(user.email);
    return { auth: h.bearer(tokens.access_token), id: user.id };
  };

  beforeAll(async () => {
    h = await bootAuth();
    admin = await login('admin');
    plain = await login('user');
  });
  afterAll(() => h.close());

  beforeEach(() => {
    h.prisma.exampleItem.rows = [];
    h.prisma.auditLog.rows = [];
  });

  describe('authentication and permissions', () => {
    it('401 without a token on every route', async () => {
      await items().get('/example-items').expect(401);
      await items().post('/example-items').send({ name: 'x' }).expect(401);
    });

    it('plain users may read but not write (403 FORBIDDEN)', async () => {
      const item = await seed('Visible', { is_published: true });
      await items().get('/example-items').set(plain.auth).expect(200);
      await items()
        .get(`/example-items/${item.id}`)
        .set(plain.auth)
        .expect(200);

      const writes = [
        () => items().post('/example-items').send({ name: 'x' }),
        () => items().patch(`/example-items/${item.id}`).send({ name: 'y' }),
        () => items().delete(`/example-items/${item.id}`),
      ];
      for (const write of writes) {
        const res = await write().set(plain.auth).expect(403);
        expect(errorCodeOf(res)).toBe('FORBIDDEN');
      }
      expect(h.prisma.exampleItem.rows).toHaveLength(1);
      expect(h.prisma.exampleItem.rows[0].deleted_at).toBeNull();
    });
  });

  describe('row-level scope (plain users see published items only)', () => {
    it('applies to lists, counts and totals', async () => {
      await seed('Public A', { is_published: true });
      await seed('Public B', { is_published: true });
      await seed('Secret draft', { is_published: false });

      const asUser = await items()
        .get('/example-items')
        .set(plain.auth)
        .expect(200);
      expect((asUser.body as { meta: { total: number } }).meta.total).toBe(2);
      expect(dataOf<Item[]>(asUser).every((i) => i.is_published)).toBe(true);

      const asAdmin = await items()
        .get('/example-items')
        .set(admin.auth)
        .expect(200);
      expect((asAdmin.body as { meta: { total: number } }).meta.total).toBe(3);
    });

    it('cannot be bypassed by filter or by guessing an id: hidden looks like missing', async () => {
      const draft = await seed('Secret draft', { is_published: false });
      const res = await items()
        .get('/example-items?filter[is_published]=false')
        .set(plain.auth)
        .expect(200);
      expect(dataOf<Item[]>(res)).toEqual([]);

      const byId = await items()
        .get(`/example-items/${draft.id}`)
        .set(plain.auth)
        .expect(404);
      expect(errorCodeOf(byId)).toBe('NOT_FOUND');
      await items()
        .get(`/example-items/${draft.id}`)
        .set(admin.auth)
        .expect(200);
    });
  });

  describe('create', () => {
    it('201 { data }, trims the name, stamps created_by/updated_by, and audits', async () => {
      const res = await items()
        .post('/example-items')
        .set(admin.auth)
        .send({ name: '  Quarterly report  ', description: 'Q3' })
        .expect(201);
      const item = dataOf<Item>(res);
      expect(item).toMatchObject({
        name: 'Quarterly report',
        description: 'Q3',
        is_published: false,
        created_by: admin.id,
      });
      expect(row(item.id)).toMatchObject({
        created_by: admin.id,
        updated_by: admin.id,
      });
      expect(JSON.stringify(res.body)).not.toContain('deleted_at');
      expect(JSON.stringify(res.body)).not.toContain('updated_by');

      expect(h.prisma.auditLog.rows).toEqual([
        expect.objectContaining({
          action: 'example.create',
          entity_type: 'example_item',
          entity_id: item.id,
          actor_id: admin.id,
        }),
      ]);
    });

    it.each([
      [{}, 'name'],
      [{ name: '   ' }, 'name'],
      [{ name: 'x'.repeat(121) }, 'name'],
      [{ name: 'ok', is_published: 'yes' }, 'is_published'],
      [{ name: 'ok', description: 42 }, 'description'],
      // the client cannot set server-controlled fields
      [{ name: 'ok', id: '0f8fad5b-d9cb-469f-a165-70867728950e' }, 'id'],
      [{ name: 'ok', created_by: 'someone-else' }, 'created_by'],
      [{ name: 'ok', deleted_at: '2020-01-01' }, 'deleted_at'],
    ])('422 for %j (field %s)', async (body, field) => {
      const res = await items()
        .post('/example-items')
        .set(admin.auth)
        .send(body)
        .expect(422);
      expect(res.body).toMatchObject({ error_code: 'VALIDATION_ERROR' });
      expect(
        (res.body as { errors: Array<{ field: string }> }).errors.map(
          (e) => e.field,
        ),
      ).toContain(field);
      expect(h.prisma.exampleItem.rows).toHaveLength(0);
      expect(h.prisma.auditLog.rows).toHaveLength(0);
    });
  });

  describe('list: filters, search, sort, pagination', () => {
    beforeEach(async () => {
      await seed('Alpha report', {
        is_published: true,
        created_at: new Date('2026-01-01T10:00:00Z'),
      });
      await seed('Beta report', {
        is_published: false,
        created_at: new Date('2026-02-01T10:00:00Z'),
      });
      await seed('Gamma notes', {
        is_published: true,
        description: 'about Q3',
        created_at: new Date('2026-03-01T10:00:00Z'),
      });
    });

    const names = (res: { body: unknown }) =>
      dataOf<Item[]>(res as never).map((i) => i.name);

    it('defaults to newest first', async () => {
      const res = await items()
        .get('/example-items')
        .set(admin.auth)
        .expect(200);
      expect(names(res)).toEqual([
        'Gamma notes',
        'Beta report',
        'Alpha report',
      ]);
    });

    it('filter[...] and search combine', async () => {
      expect(
        names(
          await items()
            .get('/example-items?filter[name]=report')
            .set(admin.auth)
            .expect(200),
        ),
      ).toEqual(['Beta report', 'Alpha report']);
      expect(
        names(
          await items()
            .get('/example-items?filter[name]=report&filter[is_published]=true')
            .set(admin.auth)
            .expect(200),
        ),
      ).toEqual(['Alpha report']);
      expect(
        names(
          await items()
            .get('/example-items?search=q3')
            .set(admin.auth)
            .expect(200),
        ),
      ).toEqual(['Gamma notes']);
      expect(
        names(
          await items()
            .get('/example-items?filter[created_between]=2026-02-01,2026-02-28')
            .set(admin.auth)
            .expect(200),
        ),
      ).toEqual(['Beta report']);
    });

    it('sorts, multi-key and descending', async () => {
      expect(
        names(
          await items()
            .get('/example-items?sort=name')
            .set(admin.auth)
            .expect(200),
        ),
      ).toEqual(['Alpha report', 'Beta report', 'Gamma notes']);
      expect(
        names(
          await items()
            .get('/example-items?sort=-name')
            .set(admin.auth)
            .expect(200),
        ),
      ).toEqual(['Gamma notes', 'Beta report', 'Alpha report']);
    });

    it('paginates with { data, meta }', async () => {
      const page1 = await items()
        .get('/example-items?page_size=2&sort=name')
        .set(admin.auth)
        .expect(200);
      expect(names(page1)).toEqual(['Alpha report', 'Beta report']);
      expect((page1.body as { meta: unknown }).meta).toEqual({
        current_page: 1,
        page_size: 2,
        total: 3,
        last_page: 2,
      });
      const page2 = await items()
        .get('/example-items?page=2&page_size=2&sort=name')
        .set(admin.auth)
        .expect(200);
      expect(names(page2)).toEqual(['Gamma notes']);
      const beyond = await items()
        .get('/example-items?page=9&page_size=2')
        .set(admin.auth)
        .expect(200);
      expect(dataOf<Item[]>(beyond)).toEqual([]);
      expect((beyond.body as { meta: { total: number } }).meta.total).toBe(3);
    });

    it.each([
      ['/example-items?filter[created_by]=x', 'UNKNOWN_FILTER'],
      ['/example-items?sort=deleted_at', 'UNKNOWN_SORT'],
      ['/example-items?include=owner', 'UNKNOWN_INCLUDE'],
      ['/example-items?filter[is_published]=maybe', 'INVALID_QUERY'],
      ['/example-items?page_size=0', 'INVALID_QUERY'],
    ])('400 for %s', async (url, code) => {
      const res = await items().get(url).set(admin.auth).expect(400);
      expect(errorCodeOf(res)).toBe(code);
    });
  });

  describe('get', () => {
    it('200, 404 for unknown, 400 for a malformed id', async () => {
      const item = await seed('One');
      const ok = await items()
        .get(`/example-items/${item.id}`)
        .set(admin.auth)
        .expect(200);
      expect(dataOf<Item>(ok)).toMatchObject({ id: item.id, name: 'One' });
      await items()
        .get('/example-items/0f8fad5b-d9cb-469f-a165-70867728950e')
        .set(admin.auth)
        .expect(404);
      await items()
        .get('/example-items/not-a-uuid')
        .set(admin.auth)
        .expect(400);
    });
  });

  describe('update', () => {
    it('partial update, stamps updated_by, audits; null clears the description', async () => {
      const item = await seed('Before', {
        description: 'old',
        created_by: null,
      });
      const res = await items()
        .patch(`/example-items/${item.id}`)
        .set(admin.auth)
        .send({ name: ' After ', is_published: true })
        .expect(200);
      expect(dataOf<Item>(res)).toMatchObject({
        name: 'After',
        description: 'old',
        is_published: true,
      });
      expect(row(item.id)).toMatchObject({ updated_by: admin.id });

      const cleared = await items()
        .patch(`/example-items/${item.id}`)
        .set(admin.auth)
        .send({ description: null })
        .expect(200);
      expect(dataOf<Item>(cleared).description).toBeNull();
      expect(h.prisma.auditLog.rows.map((r) => r.action)).toEqual([
        'example.update',
        'example.update',
      ]);
    });

    it('404 for a missing or deleted item (and no audit), 422 for server-controlled fields', async () => {
      const gone = await seed('Gone', { deleted_at: new Date() });
      await items()
        .patch(`/example-items/${gone.id}`)
        .set(admin.auth)
        .send({ name: 'x' })
        .expect(404);
      expect(h.prisma.auditLog.rows).toHaveLength(0);

      const item = await seed('Live');
      await items()
        .patch(`/example-items/${item.id}`)
        .set(admin.auth)
        .send({ created_by: 'x' })
        .expect(422);
      await items()
        .patch(`/example-items/${item.id}`)
        .set(admin.auth)
        .send({ name: '' })
        .expect(422);
      expect(row(item.id).name).toBe('Live');
    });
  });

  describe('delete (soft)', () => {
    it('204, keeps the row with deleted_at, hides it everywhere, audits', async () => {
      const item = await seed('Doomed', { is_published: true });
      await items()
        .delete(`/example-items/${item.id}`)
        .set(admin.auth)
        .expect(204);

      expect(row(item.id)).toMatchObject({
        deleted_at: expect.any(Date) as Date,
        updated_by: admin.id,
      });
      await items()
        .get(`/example-items/${item.id}`)
        .set(admin.auth)
        .expect(404);
      const list = await items()
        .get('/example-items')
        .set(admin.auth)
        .expect(200);
      expect(dataOf<Item[]>(list)).toEqual([]);
      expect(h.prisma.auditLog.rows).toEqual([
        expect.objectContaining({
          action: 'example.delete',
          entity_id: item.id,
        }),
      ]);
    });

    it('deleting twice is a 404, and nothing is audited the second time', async () => {
      const item = await seed('Once');
      await items()
        .delete(`/example-items/${item.id}`)
        .set(admin.auth)
        .expect(204);
      await items()
        .delete(`/example-items/${item.id}`)
        .set(admin.auth)
        .expect(404);
      expect(h.prisma.auditLog.rows).toHaveLength(1);
    });
  });
});
