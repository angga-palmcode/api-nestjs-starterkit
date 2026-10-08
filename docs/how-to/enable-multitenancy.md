# Enable multi-tenancy

> **Status: a design guide, not a feature.** The kit is single-tenant: there is no `tenant_id` anywhere in the base schema, and nothing below is implemented or tested here. The kit only provides the seams (the query builder's `scope`, a typed `AuthenticatedUser`, the Prisma service) and this plan. Budget it as a project, and test isolation hard: a tenancy bug is a data leak.

Model assumed: one database, shared tables, a `tenant_id` column on every tenant-owned row (the common and simplest model). Schema-per-tenant or database-per-tenant need a different approach (a Prisma client per tenant) and are not covered.

## 1. Schema

```prisma
model Tenant {
  id         String   @id @default(uuid()) @db.Uuid
  name       String
  slug       String   @unique
  created_at DateTime @default(now())
  users      User[]
  @@map("tenants")
}

model User {
  // ...existing fields...
  tenant_id String @db.Uuid
  tenant    Tenant @relation(fields: [tenant_id], references: [id])
  @@unique([tenant_id, email])        // replaces `email @unique`: the same address may exist in two tenants
  @@index([tenant_id])
}
```

Add `tenant_id` (+ index, + FK) to **every** tenant-owned table: `user_invitations`, `audit_logs`, your domain tables. Decide explicitly for the rest: sessions, refresh tokens, OTP tokens, reset tokens and recovery codes belong to a user, so they inherit isolation through the user; they need no column. Backfill existing rows in the migration (create a default tenant, set it everywhere, then make the column `NOT NULL`).

Email uniqueness is the sharpest edge: login by email now needs the tenant (a subdomain, a header, or a tenant slug in the body), otherwise `findFirst({ email })` can hit the wrong tenant. Change `AuthService.findByEmail`, `UsersService.invite` (conflict check), `AccountService.register / forgotPassword / acceptInvite`, and the seed.

## 2. Carry the tenant with the caller

1. Put the tenant in the access token: add `tid` to `AccessClaims` in `src/auth/core/token.service.ts` and `signAccess`, and `tenant_id` to `AuthenticatedUser` (`src/auth/core/authenticated-user.ts`).
2. `JwtAuthGuard` already loads the user per request; take `tenant_id` from the **database row**, not from the token (same reason the role comes from the database), and set it on `request.user`.
3. For pre-login endpoints (login, forgot-password, accept-invite) resolve the tenant from the request (host, header or slug) and pass it into the services explicitly.

## 3. Scope every query

The query builder already has the seam: `parse(rawQuery, { scope })` AND-merges a where into every list, and the example module shows the same scope applied to single-row lookups.

```ts
const q = thingQuery.parse(raw, { scope: { tenant_id: actor.tenant_id } });
const item = await this.prisma.thing.findFirst({ where: { id, tenant_id: actor.tenant_id, ...notDeleted } });
```

Relying on every developer to remember it is how leaks happen. Enforce it centrally with a Prisma client extension that injects the tenant into all reads and writes of tenant-owned models, using an `AsyncLocalStorage` filled by the guard (the kit already has one for the request id: `src/common/request-context`). Sketch, untested:

```ts
const TENANT_MODELS = new Set(['User', 'UserInvitation', 'AuditLog', 'Thing']);

export function tenantExtension(getTenantId: () => string | undefined) {
  return Prisma.defineExtension({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const tenant_id = getTenantId();
          if (!tenant_id) throw new Error(`No tenant in context for ${model}.${operation}`); // fail closed
          const a = args as Record<string, any>;
          if (['findMany', 'findFirst', 'count', 'updateMany', 'deleteMany', 'aggregate'].includes(operation)) {
            a.where = { AND: [a.where ?? {}, { tenant_id }] };
          } else if (['create'].includes(operation)) {
            a.data = { ...a.data, tenant_id };
          } // findUnique / update / delete by id: re-check ownership with findFirst first, or use extendedWhereUnique
          return query(a);
        },
      },
    },
  });
}
```

Background jobs (`src/jobs`) and the seed run without a request: give them an explicit "system" path that iterates tenants or deliberately bypasses the extension, and never let that bypass be reachable from a request.

## 4. Roles and administration

Decide what `superadmin` means: a platform operator across tenants (then it needs an explicit, audited way to act inside a tenant) or a per-tenant top role (then add a separate platform role outside the enum). Keep the hierarchy rule (`canActOn`) inside a tenant.

Add `tenant_id` to audit entries (and to `AuditService.log`), and to invitations (`UsersService.invite` must create them in the actor's tenant).

## 5. Tests to write first

- Two tenants, same email: each can log in and neither sees the other.
- A token from tenant A cannot read, update or delete tenant B's rows by id (expect 404, not 403).
- List endpoints, counts, search and `include` never cross tenants.
- Jobs and the seed behave per tenant.
- The extension fails closed when there is no tenant in context.

Run these against real PostgreSQL (`test/database.e2e-spec.ts` pattern); the in-memory test database does not model Prisma extensions.
