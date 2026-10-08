# The `example` module: copy this to add a feature

A complete, tested CRUD that shows every convention of the kit. To add a module `things`:

1. **Model** — add `model Thing { ... }` to `prisma/schema.prisma` (snake_case fields, `created_at / updated_at / deleted_at / created_by / updated_by`, `@@map("things")`), then `npm run migrate:dev -- --name add_things`.
2. **Copy** this folder to `src/things/` and rename `example` / `ExampleItem` / `example-items`.
3. **DTOs** (`dto/`) — output DTO with `@ApiProperty({ example })` on every field and an explicit `toThingDto` mapper; input DTOs as allow-lists (the global pipe rejects unknown fields with 422).
4. **Query** (`*.query.ts`) — one `defineQuery`: whitelisted filters, sorts, search columns. Use `softDelete: false` only for tables without `deleted_at`.
5. **Service** — read through `query.parse(raw, { scope })` + `$transaction([findMany(q.args), count({ where: q.where })])`; write with `created_by / updated_by`; delete with `softDeleteData(actor.id)`; throw `AppException(ErrorCode.X, ...)`; map to DTOs.
6. **Permissions** — add rows to `src/rbac/permissions.ts` (`'things.read'`, ...) and one `@Permissions('things.read')` line per route.
7. **Controller** — per route: `@Permissions`, `@ApiOperation`, an envelope decorator (`@ApiOkEnvelope` / `@ApiCreatedEnvelope` / `@ApiPaginatedEnvelope` / `@ApiNoContentResponse`), `@ApiErrorResponses(...)`, `@ApiQueryFrom(query)` on lists, `@Audited('things.create', 'thing')` on mutations.
8. **Register** the module in `src/app.module.ts`.
9. **Tests** — copy `example.flow.spec.ts` (HTTP over the in-memory DB: auth, permissions, scope, validation, filters, pagination, soft delete, audit) and `example.service.spec.ts` (exact Prisma calls). Add a case to `test/database.e2e-spec.ts` for anything that depends on real PostgreSQL behaviour.

`npm run test:e2e` fails if a route lacks Swagger docs (`@ApiOperation` + a response decorator) or an access policy, so the checklist above is enforced.

## What the reference shows

| Concern | Where |
| :-- | :-- |
| Row-level visibility (plain users only see published items), applied to lists **and** to single lookups | `ExampleService.visibleTo` + `findOrFail` |
| A hidden row looks exactly like a missing one (404) | `ExampleService.findOrFail` |
| Server-controlled fields cannot be written by clients | `dto/example-item-input.dto.ts` |
| `null` clears an optional field in a PATCH | `UpdateExampleItemDto.description` |
| Soft delete + hidden by default | `softDeleteData`, query builder default |
| One query definition drives parsing, validation and Swagger | `example.query.ts` |

Delete this module (and the `ExampleItem` model) when you start a real project.
