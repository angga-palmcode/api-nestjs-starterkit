# Add a module (feature)

`src/example` is a complete, tested CRUD that shows every convention. Add your feature by copying it. The short checklist is in [`src/example/README.md`](../../src/example/README.md); this page adds the commands and what enforces each step.

## Steps

**1. Model.** Add it to `prisma/schema.prisma` with the standard columns, then create the migration:

```prisma
model Thing {
  id           String    @id @default(uuid()) @db.Uuid
  name         String
  created_at   DateTime  @default(now())
  updated_at   DateTime  @updatedAt
  deleted_at   DateTime?
  created_by   String?   @db.Uuid
  updated_by   String?   @db.Uuid
  @@index([deleted_at])
  @@map("things")
}
```

```bash
npm run migrate:dev -- --name add_things     # creates prisma/migrations/<timestamp>_add_things and applies it locally
```

Commit the migration. Never edit a migration that is already merged: add a new one.

**2. Copy the folder.** `cp -r src/example src/things` and rename `example` / `ExampleItem` / `example-items` / `exampleQuery` inside it.

**3. DTOs.** Output DTO with `@ApiProperty({ example })` on every property and a `toThingDto()` mapper (never return a Prisma row). Input DTOs are allow-lists: the global pipe rejects unknown fields with a 422, so clients cannot set `id`, `created_by` or `deleted_at`.

**4. Query definition.** One `defineQuery` per entity (filters, sorts, search columns). Tables without `deleted_at` need `softDelete: false`.

**5. Service.** Read through `query.parse(raw, { scope })` and `$transaction([findMany(q.args), count({ where: q.where })])`; stamp `created_by` / `updated_by`; delete with `softDeleteData(actor.id)`; throw `AppException(ErrorCode.NOT_FOUND, ...)`. Put row-level rules in `scope` and apply them to single-row lookups too.

**6. Permissions.** Add rows to `PERMISSION_ROLES` in `src/rbac/permissions.ts` (`'things.read'`, `'things.create'`, ...) and one `@Permissions('things.read')` line per route (one line, always).

**7. Controller.** Per route: `@Permissions`, `@ApiOperation`, an envelope decorator, `@ApiErrorResponses(...)`, `@ApiQueryFrom(thingQuery)` on lists, `@Audited('things.create', 'thing')` on mutations.

**8. Register** `ThingsModule` in `src/app.module.ts`.

**9. Tests.** Copy `example.flow.spec.ts` (HTTP over the in-memory database: auth, permissions, scope, validation, filters, pagination, soft delete, audit) and `example.service.spec.ts` (exact Prisma calls). The in-memory database needs a table for your model in `test/helpers/memory-prisma.ts` (copy the `exampleItem` entry). Add a case to `test/database.e2e-spec.ts` for anything that depends on real PostgreSQL behaviour.

## What fails if you forget something

| Mistake | Caught by |
| :-- | :-- |
| Route without `@ApiOperation` or a response decorator | `test/swagger.e2e-spec.ts` |
| Route without `@Public` / `@Authenticated` / `@Permissions` / `@Roles` | Denied at runtime (403) and `test/rbac.e2e-spec.ts` |
| A new public route | `test/swagger.e2e-spec.ts` (approved list must be updated on purpose) |
| `process.env` outside `src/config` | ESLint |
| Unknown query parameter | 400 `UNKNOWN_*` / `INVALID_QUERY` at runtime |
| Missing migration after a schema change | Your tests against a migrated database; CI applies `migrate deploy` before the real-service suites |
