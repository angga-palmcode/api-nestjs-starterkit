import { AppException } from '../errors/app.exception';
import {
  boolean,
  callback,
  dateRange,
  defineQuery,
  exact,
  oneOf,
  partial,
} from './index';

/** Plain objects stand in for Prisma where-inputs. */
type Where = Record<string, unknown>;

const thing = defineQuery<Where>({
  filters: {
    id: exact({ cast: 'uuid' }),
    name: partial(),
    status: oneOf({ values: ['draft', 'live', 'archived'] }),
    kind: exact({ values: ['a', 'b'] }),
    qty: exact({ cast: 'number' }),
    active: boolean({ field: 'is_active' }),
    created_between: dateRange('created_at'),
    has_owner: callback(
      (value) => ({ owner_id: value === 'true' ? { not: null } : null }),
      { description: 'Whether the item has an owner', example: 'true' },
    ),
  },
  sorts: ['name', 'created_at', 'owner.name'],
  defaultSort: '-created_at',
  includes: ['owner', 'owner.team', 'tags'],
  search: ['name', 'description'],
});

const fail = (fn: () => unknown): AppException => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppException);
    return e as AppException;
  }
  throw new Error('expected the query to be rejected');
};

describe('whitelist (unknown input is a 400, never silently ignored)', () => {
  it('rejects unknown filters with UNKNOWN_FILTER and names the field', () => {
    const e = fail(() => thing.parse({ filter: { password: 'x' } }));
    expect(e.getStatus()).toBe(400);
    expect(e.code).toBe('UNKNOWN_FILTER');
    expect(e.errors?.[0]).toMatchObject({ field: 'filter[password]' });
    expect(e.errors?.[0].message).toContain('name');
  });

  it('rejects unknown sort fields with UNKNOWN_SORT', () => {
    const e = fail(() => thing.parse({ sort: 'secret' }));
    expect(e.getStatus()).toBe(400);
    expect(e.code).toBe('UNKNOWN_SORT');
    expect(e.errors?.[0]).toMatchObject({ field: 'sort' });
  });

  it('rejects unknown includes with UNKNOWN_INCLUDE', () => {
    const e = fail(() => thing.parse({ include: 'owner,secrets' }));
    expect(e.getStatus()).toBe(400);
    expect(e.code).toBe('UNKNOWN_INCLUDE');
  });

  it('does not let prototype names slip through the whitelist', () => {
    for (const key of [
      'constructor',
      'toString',
      '__proto__',
      'hasOwnProperty',
    ]) {
      expect(fail(() => thing.parse({ filter: { [key]: 'x' } })).code).toBe(
        'UNKNOWN_FILTER',
      );
    }
    expect(fail(() => thing.parse({ sort: 'constructor' })).code).toBe(
      'UNKNOWN_SORT',
    );
    expect(fail(() => thing.parse({ include: 'constructor' })).code).toBe(
      'UNKNOWN_INCLUDE',
    );
  });

  it('ignores unrelated top-level parameters', () => {
    expect(() => thing.parse({ _: '1700000000', utm: 'x' })).not.toThrow();
  });
});

describe('filters', () => {
  const where = (filter: object, options = {}) =>
    thing.parse({ filter }, options).where;
  const conditions = (filter: object) =>
    (where(filter, { withTrashed: true }) as { AND?: Where[] }).AND ?? [];

  it('exact: one value; validates against `values`, number and uuid casts', () => {
    expect(conditions({ kind: 'a' })).toEqual([{ kind: 'a' }]);
    expect(fail(() => where({ kind: 'z' })).code).toBe('INVALID_QUERY');
    expect(conditions({ qty: '42' })).toEqual([{ qty: 42 }]);
    expect(fail(() => where({ qty: 'abc' })).code).toBe('INVALID_QUERY');
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(conditions({ id })).toEqual([{ id }]);
    expect(fail(() => where({ id: 'not-a-uuid' })).code).toBe('INVALID_QUERY');
  });

  it('partial: case-insensitive contains with LIKE wildcards escaped', () => {
    expect(conditions({ name: 'ani' })).toEqual([
      { name: { contains: 'ani', mode: 'insensitive' } },
    ]);
    expect(conditions({ name: '100%_off\\' })).toEqual([
      { name: { contains: '100\\%\\_off\\\\', mode: 'insensitive' } },
    ]);
    expect(fail(() => where({ name: 'x'.repeat(101) })).code).toBe(
      'INVALID_QUERY',
    );
  });

  it('oneOf: comma list or repeated parameter, each value validated', () => {
    expect(conditions({ status: 'draft,live' })).toEqual([
      { status: { in: ['draft', 'live'] } },
    ]);
    expect(conditions({ status: ['live', 'archived'] })).toEqual([
      { status: { in: ['live', 'archived'] } },
    ]);
    expect(conditions({ status: ' live , ' })).toEqual([
      { status: { in: ['live'] } },
    ]);
    expect(fail(() => where({ status: 'draft,bogus' })).code).toBe(
      'INVALID_QUERY',
    );
    expect(fail(() => where({ status: ',' })).code).toBe('INVALID_QUERY');
  });

  it('boolean: true/false/1/0 mapped onto the field', () => {
    expect(conditions({ active: 'true' })).toEqual([{ is_active: true }]);
    expect(conditions({ active: '0' })).toEqual([{ is_active: false }]);
    expect(fail(() => where({ active: 'maybe' })).code).toBe('INVALID_QUERY');
  });

  it('dateRange: inclusive UTC bounds, open ends allowed', () => {
    expect(conditions({ created_between: '2026-01-01,2026-01-31' })).toEqual([
      {
        created_at: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-31T23:59:59.999Z'),
        },
      },
    ]);
    expect(conditions({ created_between: '2026-01-01,' })).toEqual([
      { created_at: { gte: new Date('2026-01-01T00:00:00.000Z') } },
    ]);
    expect(conditions({ created_between: ',2026-01-31' })).toEqual([
      { created_at: { lte: new Date('2026-01-31T23:59:59.999Z') } },
    ]);
    expect(
      conditions({
        created_between: '2026-01-01T10:00:00Z,2026-01-01T11:00:00Z',
      }),
    ).toEqual([
      {
        created_at: {
          gte: new Date('2026-01-01T10:00:00Z'),
          lte: new Date('2026-01-01T11:00:00Z'),
        },
      },
    ]);
  });

  it.each([
    '',
    ',',
    '2026-01-31,2026-01-01',
    'yesterday,today',
    '2026-02-30,',
    '2026-01-01',
    '2026-01-01,2026-01-02,2026-01-03',
  ])('dateRange rejects %j', (value) => {
    expect(fail(() => where({ created_between: value })).code).toBe(
      'INVALID_QUERY',
    );
  });

  it('callback: delegates to the function', () => {
    expect(conditions({ has_owner: 'true' })).toEqual([
      { owner_id: { not: null } },
    ]);
    expect(conditions({ has_owner: 'false' })).toEqual([{ owner_id: null }]);
  });

  it('values that must be single reject arrays and nested objects', () => {
    expect(fail(() => where({ kind: ['a', 'b'] })).code).toBe('INVALID_QUERY');
    expect(fail(() => where({ kind: { nested: 'a' } })).code).toBe(
      'INVALID_QUERY',
    );
    expect(fail(() => thing.parse({ filter: 'kind=a' })).code).toBe(
      'INVALID_QUERY',
    );
    expect(fail(() => where({ kind: '' })).code).toBe('INVALID_QUERY');
  });

  it('injection-looking input is just a plain value', () => {
    const attack = `' OR 1=1; DROP TABLE users; --`;
    expect(conditions({ name: attack })).toEqual([
      { name: { contains: attack, mode: 'insensitive' } },
    ]);
    // ...and for a constrained filter it is simply an invalid value
    expect(fail(() => where({ kind: attack })).code).toBe('INVALID_QUERY');
    // operator-style objects (`filter[name][$ne]=`) are rejected, not interpreted
    expect(fail(() => where({ name: { $ne: 'x' } })).code).toBe(
      'INVALID_QUERY',
    );
  });
});

describe('where composition', () => {
  it('is empty when nothing applies and soft delete is off', () => {
    const plain = defineQuery<Where>({
      filters: {},
      sorts: ['id'],
      softDelete: false,
    });
    expect(plain.parse({}).where).toEqual({});
  });

  it('hides soft-deleted rows by default; withTrashed opts out', () => {
    expect(thing.parse({}).where).toEqual({ AND: [{ deleted_at: null }] });
    expect(thing.parse({}, { withTrashed: true }).where).toEqual({});
  });

  it('combines everything with AND so no condition can clobber another', () => {
    const q = thing.parse(
      { filter: { kind: 'a', status: 'live' }, search: 'ani' },
      { scope: { owner_id: 'u-1' } },
    );
    expect(q.where).toEqual({
      AND: [
        { owner_id: 'u-1' },
        { deleted_at: null },
        { kind: 'a' },
        { status: { in: ['live'] } },
        {
          OR: [
            { name: { contains: 'ani', mode: 'insensitive' } },
            { description: { contains: 'ani', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });

  it('merges the scope hook (row-level scoping / future tenant)', () => {
    const q = thing.parse(
      {},
      { scope: { tenant_id: 't-1' }, withTrashed: true },
    );
    expect(q.where).toEqual({ AND: [{ tenant_id: 't-1' }] });
  });

  it('a callback filter containing OR does not clobber the search OR', () => {
    const withOr = defineQuery<Where>({
      filters: {
        either: callback(() => ({ OR: [{ a: 1 }, { b: 2 }] }), {
          description: 'x',
          example: 'y',
        }),
      },
      sorts: ['id'],
      search: ['name'],
      softDelete: false,
    });
    const q = withOr.parse({ filter: { either: 'y' }, search: 'z' });
    expect((q.where as { AND: Where[] }).AND).toHaveLength(2);
  });

  it('search: trims, ignores blanks, escapes wildcards, caps length', () => {
    expect(thing.parse({ search: '   ' }, { withTrashed: true }).where).toEqual(
      {},
    );
    expect(
      thing.parse({ search: ' 50% ' }, { withTrashed: true }).where,
    ).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: '50\\%', mode: 'insensitive' } },
            { description: { contains: '50\\%', mode: 'insensitive' } },
          ],
        },
      ],
    });
    expect(fail(() => thing.parse({ search: 'x'.repeat(101) })).code).toBe(
      'INVALID_QUERY',
    );
    expect(fail(() => thing.parse({ search: ['a', 'b'] })).code).toBe(
      'INVALID_QUERY',
    );
  });

  it('ignores search when the definition has no search fields', () => {
    const q = defineQuery<Where>({
      filters: {},
      sorts: ['id'],
      softDelete: false,
    });
    expect(q.parse({ search: 'anything' }).where).toEqual({});
  });
});

describe('sorting', () => {
  it('uses the default sort and a stable id tiebreaker', () => {
    expect(thing.parse({}).orderBy).toEqual([
      { created_at: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('multi-key sort, - means descending, tiebreaker follows the first key', () => {
    expect(thing.parse({ sort: 'name,-created_at' }).orderBy).toEqual([
      { name: 'asc' },
      { created_at: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('supports nested fields and skips duplicates and an explicit id', () => {
    expect(
      thing.parse({ sort: '-owner.name,name,owner.name' }).orderBy,
    ).toEqual([{ owner: { name: 'desc' } }, { name: 'asc' }, { id: 'desc' }]);
    const withId = defineQuery<Where>({
      filters: {},
      sorts: ['id', 'name'],
      softDelete: false,
    });
    expect(withId.parse({ sort: 'name,id' }).orderBy).toEqual([
      { name: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('caps the number of sort keys and rejects empty tokens', () => {
    const many = defineQuery<Where>({
      filters: {},
      sorts: ['a', 'b', 'c', 'd'],
      softDelete: false,
    });
    expect(fail(() => many.parse({ sort: 'a,b,c,d' })).code).toBe(
      'INVALID_QUERY',
    );
    expect(fail(() => thing.parse({ sort: 'name,,' })).code).toBe(
      'INVALID_QUERY',
    );
    expect(fail(() => thing.parse({ sort: ['name', '-name'] })).code).toBe(
      'INVALID_QUERY',
    );
  });

  it('blank sort falls back to the default', () => {
    expect(thing.parse({ sort: '' }).orderBy[0]).toEqual({
      created_at: 'desc',
    });
  });
});

describe('includes', () => {
  it('has none unless requested', () => {
    expect(thing.parse({}).include).toBeUndefined();
    expect('include' in thing.parse({}).args).toBe(false);
  });

  it('builds (nested) include trees', () => {
    expect(thing.parse({ include: 'tags' }).include).toEqual({ tags: true });
    expect(thing.parse({ include: 'owner,tags' }).include).toEqual({
      owner: true,
      tags: true,
    });
    expect(thing.parse({ include: 'owner.team' }).include).toEqual({
      owner: { include: { team: true } },
    });
    // asking for both the parent and the child keeps the child
    expect(thing.parse({ include: 'owner,owner.team' }).include).toEqual({
      owner: { include: { team: true } },
    });
  });

  it('caps the include depth when the definition is created', () => {
    expect(() =>
      defineQuery<Where>({
        filters: {},
        sorts: ['id'],
        includes: ['a.b.c'],
      }),
    ).toThrow(/depth/);
    expect(() =>
      defineQuery<Where>({
        filters: {},
        sorts: ['id'],
        includes: ['a.b.c'],
        maxIncludeDepth: 3,
      }),
    ).not.toThrow();
  });
});

describe('pagination', () => {
  it('defaults to page 1 of 25', () => {
    const q = thing.parse({});
    expect(q).toMatchObject({ page: 1, page_size: 25, skip: 0, take: 25 });
  });

  it('computes skip/take', () => {
    expect(thing.parse({ page: '3', page_size: '10' })).toMatchObject({
      page: 3,
      page_size: 10,
      skip: 20,
      take: 10,
    });
  });

  it('caps page_size at 100', () => {
    expect(thing.parse({ page_size: '5000' })).toMatchObject({
      page_size: 100,
      take: 100,
    });
  });

  it('honours a custom default and cap', () => {
    const custom = defineQuery<Where>({
      filters: {},
      sorts: ['id'],
      softDelete: false,
      defaultPageSize: 10,
      maxPageSize: 20,
    });
    expect(custom.parse({}).page_size).toBe(10);
    expect(custom.parse({ page_size: '50' }).page_size).toBe(20);
  });

  it.each(['0', '-1', '1.5', 'abc', '', '1e3', '99999999999'])(
    'rejects page=%j',
    (page) => {
      expect(fail(() => thing.parse({ page })).code).toBe('INVALID_QUERY');
    },
  );

  it.each(['0', '-5', 'x'])('rejects page_size=%j', (page_size) => {
    expect(fail(() => thing.parse({ page_size })).code).toBe('INVALID_QUERY');
  });

  it('rejects a page so large that skip overflows', () => {
    expect(
      fail(() => thing.parse({ page: '2147483647', page_size: '100' })).code,
    ).toBe('INVALID_QUERY');
  });

  it('exposes Prisma args and builds the paginated envelope', () => {
    const q = thing.parse({ page: '2', page_size: '2', include: 'tags' });
    expect(q.args).toEqual({
      where: q.where,
      orderBy: q.orderBy,
      include: { tags: true },
      skip: 2,
      take: 2,
    });
    const result = q.paginate(['c', 'd'], 5);
    expect(result.data).toEqual(['c', 'd']);
    expect(result.meta).toEqual({
      current_page: 2,
      page_size: 2,
      total: 5,
      last_page: 3,
    });
  });
});

describe('describe() (feeds Swagger)', () => {
  it('lists every accepted parameter with realistic examples', () => {
    const d = thing.describe();
    expect(d.filters.map((f) => f.key)).toEqual([
      'id',
      'name',
      'status',
      'kind',
      'qty',
      'active',
      'created_between',
      'has_owner',
    ]);
    const status = d.filters.find((f) => f.key === 'status');
    expect(status).toMatchObject({ example: 'draft,live' });
    expect(status?.enum).toBeUndefined();
    expect(status?.description).toContain('draft, live, archived');
    expect(d.filters.find((f) => f.key === 'kind')?.enum).toEqual(['a', 'b']);
    expect(d.filters.find((f) => f.key === 'created_between')?.example).toBe(
      '2026-01-01,2026-01-31',
    );
    expect(d).toMatchObject({
      sorts: ['name', 'created_at', 'owner.name'],
      defaultSort: '-created_at',
      includes: ['owner', 'owner.team', 'tags'],
      search: ['name', 'description'],
      defaultPageSize: 25,
      maxPageSize: 100,
    });
  });
});

describe('definition validation', () => {
  it('rejects a default sort that is not whitelisted', () => {
    expect(() =>
      defineQuery<Where>({
        filters: {},
        sorts: ['name'],
        defaultSort: '-secret',
      }),
    ).toThrow(/defaultSort/);
  });

  it('sorts by `id` ascending when no default sort is given', () => {
    const q = defineQuery<Where>({
      filters: {},
      sorts: ['id'],
      softDelete: false,
    });
    expect(q.parse({}).orderBy).toEqual([{ id: 'asc' }]);
  });
});
