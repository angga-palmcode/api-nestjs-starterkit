import { randomUUID } from 'node:crypto';

/**
 * A small in-memory stand-in for PrismaService, faithful enough to exercise the auth
 * flows (atomic `updateMany` claims, unique constraints, `increment`, transactions with
 * rollback) without a database. It implements only what the app uses; the real thing is
 * covered by `test/database.e2e-spec.ts` against PostgreSQL.
 */
export type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

interface TableOptions {
  defaults: () => Row;
  unique: string[];
}

const isOperatorObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !(v instanceof Date);

const comparable = (v: unknown): unknown =>
  v instanceof Date ? v.getTime() : v;

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined;
  if (!isOperatorObject(expected))
    return comparable(actual) === comparable(expected);
  return Object.entries(expected).every(([op, operand]) => {
    const a = comparable(actual) as number | string | null | undefined;
    const b = comparable(operand) as number | string;
    switch (op) {
      case 'lt':
        return a !== null && a !== undefined && a < b;
      case 'lte':
        return a !== null && a !== undefined && a <= b;
      case 'gt':
        return a !== null && a !== undefined && a > b;
      case 'gte':
        return a !== null && a !== undefined && a >= b;
      case 'not':
        return !matchesValue(actual, operand);
      case 'in':
        return (operand as unknown[]).some((o) => comparable(o) === a);
      case 'contains':
        return (
          typeof actual === 'string' &&
          actual.toLowerCase().includes(String(operand).toLowerCase())
        );
      case 'mode':
        return true;
      default:
        throw new Error(`memory-prisma: unsupported operator "${op}"`);
    }
  });
}

function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return (expected as Where[]).some((w) => matches(row, w));
    if (key === 'AND')
      return (expected as Where[]).every((w) => matches(row, w));
    if (key === 'NOT') return !matches(row, expected as Where);
    return matchesValue(row[key], expected);
  });
}

export class Table {
  rows: Row[] = [];

  constructor(
    readonly name: string,
    private readonly options: TableOptions,
  ) {}

  private conflict(candidate: Row, ignore?: Row): void {
    for (const field of this.options.unique) {
      const value = candidate[field];
      if (value === null || value === undefined) continue;
      if (this.rows.some((r) => r !== ignore && r[field] === value)) {
        throw Object.assign(new Error(`Unique constraint failed on ${field}`), {
          code: 'P2002',
        });
      }
    }
  }

  private apply(row: Row, data: Row): void {
    for (const [key, value] of Object.entries(data)) {
      // Prisma semantics: `undefined` means "not provided" (keeps the default / current value).
      if (value === undefined) continue;
      if (
        isOperatorObject(value) &&
        'increment' in value &&
        typeof value.increment === 'number'
      ) {
        row[key] = ((row[key] as number | undefined) ?? 0) + value.increment;
      } else {
        row[key] = value;
      }
    }
    if ('updated_at' in row) row.updated_at = new Date();
  }

  create = ({ data }: { data: Row }): Promise<Row> => {
    const row: Row = { ...this.options.defaults() };
    this.apply(row, data);
    row.id ??= randomUUID();
    this.conflict(row);
    this.rows.push(row);
    return Promise.resolve({ ...row });
  };

  createMany = async ({
    data,
  }: {
    data: Row[];
  }): Promise<{ count: number }> => {
    for (const item of data) await this.create({ data: item });
    return { count: data.length };
  };

  findFirst = ({
    where,
    orderBy,
  }: { where?: Where; orderBy?: unknown } = {}): Promise<Row | null> => {
    void orderBy;
    const found = this.rows.find((r) => matches(r, where));
    return Promise.resolve(found ? { ...found } : null);
  };

  findUnique = ({ where }: { where: Where }): Promise<Row | null> =>
    this.findFirst({ where });

  findUniqueOrThrow = async ({ where }: { where: Where }): Promise<Row> => {
    const found = await this.findFirst({ where });
    if (!found)
      throw Object.assign(new Error('Record not found'), { code: 'P2025' });
    return found;
  };

  findMany = ({
    where,
    orderBy,
    skip,
    take,
  }: {
    where?: Where;
    orderBy?: Array<Record<string, 'asc' | 'desc'>>;
    skip?: number;
    take?: number;
  } = {}): Promise<Row[]> => {
    const rows = this.rows
      .filter((r) => matches(r, where))
      .map((r) => ({ ...r }));
    for (const order of [...(orderBy ?? [])].reverse()) {
      const [field, dir] = Object.entries(order)[0];
      rows.sort((a, b) => {
        const x = comparable(a[field]) as number | string;
        const y = comparable(b[field]) as number | string;
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
      });
    }
    const start = skip ?? 0;
    return Promise.resolve(
      take === undefined ? rows.slice(start) : rows.slice(start, start + take),
    );
  };

  count = async ({ where }: { where?: Where } = {}): Promise<number> =>
    (await this.findMany({ where })).length;

  update = ({ where, data }: { where: Where; data: Row }): Promise<Row> => {
    const row = this.rows.find((r) => matches(r, where));
    if (!row) {
      return Promise.reject(
        Object.assign(new Error('Record to update not found'), {
          code: 'P2025',
        }),
      );
    }
    const next = { ...row };
    this.apply(next, data);
    this.conflict(next, row);
    Object.assign(row, next);
    return Promise.resolve({ ...row });
  };

  updateMany = ({
    where,
    data,
  }: {
    where?: Where;
    data: Row;
  }): Promise<{ count: number }> => {
    const targets = this.rows.filter((r) => matches(r, where));
    for (const row of targets) this.apply(row, data);
    return Promise.resolve({ count: targets.length });
  };

  upsert = async ({
    where,
    create,
    update,
  }: {
    where: Where;
    create: Row;
    update: Row;
  }): Promise<Row> =>
    (await this.findFirst({ where }))
      ? this.update({ where, data: update })
      : this.create({ data: create });

  deleteMany = ({ where }: { where?: Where } = {}): Promise<{
    count: number;
  }> => {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, where));
    return Promise.resolve({ count: before - this.rows.length });
  };
}

const t = (name: string, unique: string[], defaults: () => Row = () => ({})) =>
  new Table(name, { unique, defaults });

export function createMemoryPrisma() {
  const now = () => new Date();
  const db = {
    user: t('user', ['email', 'id'], () => ({
      password_hash: null,
      role: 'user',
      is_active: true,
      email_verified_at: null,
      mfa_enabled: false,
      failed_login_attempts: 0,
      locked_until: null,
      token_version: 0,
      last_login_at: null,
      created_at: now(),
      updated_at: now(),
      deleted_at: null,
      created_by: null,
      updated_by: null,
    })),
    userSession: t('userSession', ['id'], () => ({
      user_agent: null,
      ip: null,
      last_seen_at: now(),
      created_at: now(),
      revoked_at: null,
    })),
    refreshToken: t('refreshToken', ['token_hash'], () => ({
      used_at: null,
      revoked_at: null,
      created_at: now(),
    })),
    passwordResetToken: t('passwordResetToken', ['token_hash'], () => ({
      used_at: null,
      created_at: now(),
    })),
    otpToken: t('otpToken', [], () => ({
      attempts: 0,
      consumed_at: null,
      created_at: now(),
    })),
    mfaSecret: t('mfaSecret', ['user_id'], () => ({
      secret: null,
      pending_secret: null,
      last_used_step: null,
      confirmed_at: null,
      created_at: now(),
      updated_at: now(),
    })),
    mfaRecoveryCode: t('mfaRecoveryCode', [], () => ({
      used_at: null,
      created_at: now(),
    })),
    userInvitation: t('userInvitation', ['token_hash'], () => ({
      name: null,
      role: 'user',
      invited_by_id: null,
      accepted_at: null,
      revoked_at: null,
      created_at: now(),
    })),
    exampleItem: t('exampleItem', ['id'], () => ({
      description: null,
      is_published: false,
      created_at: now(),
      updated_at: now(),
      deleted_at: null,
      created_by: null,
      updated_by: null,
    })),
    auditLog: t('auditLog', [], () => ({
      actor_id: null,
      entity_type: null,
      entity_id: null,
      metadata: null,
      created_at: now(),
    })),
  };
  const tables = Object.values(db);

  const prisma = {
    ...db,
    $queryRaw: () => Promise.resolve([{ '?column?': 1 }]),
    onModuleInit: () => undefined,
    onModuleDestroy: () => undefined,
    /** Array form resolves in order; function form rolls every table back if it throws. */
    $transaction: async (
      arg: Array<Promise<unknown>> | ((tx: unknown) => Promise<unknown>),
    ): Promise<unknown> => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const snapshot = tables.map((table) => table.rows.map((r) => ({ ...r })));
      try {
        return await arg(prisma);
      } catch (error) {
        tables.forEach((table, i) => (table.rows = snapshot[i]));
        throw error;
      }
    },
    /** Test helper: insert a user and return it. */
    seedUser: (data: Row = {}) =>
      db.user.create({
        data: {
          email: `user-${randomUUID().slice(0, 8)}@example.com`,
          name: 'Test User',
          email_verified_at: new Date(),
          ...data,
        },
      }),
    actions: () => db.auditLog.rows.map((r) => r.action as string),
  };
  return prisma;
}

export type MemoryPrisma = ReturnType<typeof createMemoryPrisma>;
