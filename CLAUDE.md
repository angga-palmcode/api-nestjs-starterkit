# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A domain-agnostic NestJS backend base (NestJS 11, TypeScript strict, Prisma 5, PostgreSQL, Node 22, npm). Start with `README.md` (setup), `ARCHITECTURE.md` (how it fits together) and `docs/DECISIONS.md` (why). `docs/_origin/` is the kit's provenance for its maintainers: ignore it, and delete it in projects created from the template.

## Commands

```bash
npm run start:dev          # nest start --watch (copy .env.example to .env first)
npm run build              # nest build -> dist/main.js
npm run lint:check         # eslint, no fixes (CI); `npm run lint` fixes
npm run format:check       # prettier --check (CI); `npm run format` writes
npm run typecheck          # tsc --noEmit over src, test, prisma (ts-jest does not type-check)
npm test                   # unit + integration tests (src/**/*.spec.ts), in-memory database
npm run test:cov           # same with the 80% coverage gate
npm run test:e2e           # test/*.e2e-spec.ts against the real configureApp()
npx jest src/health        # one file/dir; add -t "name" for one test
npx jest --config ./test/jest-e2e.json -t "healthz"   # one e2e test
npm run check:rbac-removable   # compiles copies of src/ without each optional module and without all (~2 min)
docker compose up -d       # PostgreSQL 16 + Redis 7 for local development
npm run migrate            # prisma migrate deploy; `npm run migrate:dev -- --name x` creates a migration
npm run seed               # idempotent; needs SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD
RUN_DB_TESTS=true REDIS_URL=redis://localhost:6379 npm run test:e2e   # also the real PostgreSQL / Redis suites
```

Pre-commit (Husky): `lint-staged` + `typecheck`. CI (`.github/workflows/ci.yml`): lint, format, typecheck, build, removability check, unit tests with coverage, migrate, e2e with real PostgreSQL and Redis, idempotent seed, Docker builds.

## Architecture in brief

- Request path: request-id middleware → helmet → CORS → global guards `ThrottlerGuard` → `JwtAuthGuard` → `PermissionsGuard` → `EnvelopeInterceptor` → validation pipe → handler → `AllExceptionsFilter`. All HTTP setup is in `src/app.setup.ts` (`configureApp`), shared by `main.ts` and every e2e test.
- Layout: `config/` (zod env), `common/` (envelope, errors, filter, pipes, query builder, swagger, logger, throttle, email seam, utils), `prisma/`, `auth/` (login state machine; `auth/core` has tokens, sessions, guards, roles), `users/`, `audit/`, `health/`, `example/` (reference module), optional `rbac/ mail/ storage/ redis/ jobs/`.
- Single-tenant, `snake_case`, soft delete, no `tenant_id` (multi-tenancy is a documented extension: `docs/how-to/enable-multitenancy.md`).

## Rules that bite

- **Never read `process.env` outside `src/config/`** (ESLint error). Declare the variable in `src/config/env.schema.ts` (zod) and inject `ConfigService<Env, true>`. Invalid or contradictory env aborts boot. `ConfigModule.forRoot({ validate })` runs when `app.module.ts` is imported, so tests never mutate `process.env`: they inject config (`createApp({ env })`; injected values win over `process.env`).
- `strict: true` including `strictPropertyInitialization` (DTO fields use `!`); `no-explicit-any` and `no-floating-promises` are errors.
- Handlers return plain values; the envelope interceptor wraps them as `{ data }`. Return `paginated(...)` / `q.paginate(...)` for `{ data, meta }`. Probes (`/healthz`, `/readyz`) are `@SkipEnvelope()` plain bodies.
- Expected failures: `throw new AppException(ErrorCode.X, message, { errors? })`; add codes to `src/common/errors/error-code.ts` (enum + `ERROR_STATUS`). 5xx messages never reach clients. Never reveal whether an account exists.
- Every controller route needs `@ApiOperation`, a response decorator (`@ApiOkEnvelope`, `@ApiCreatedEnvelope`, `@ApiPaginatedEnvelope`, `@ApiNoContentResponse`) and `@ApiErrorResponses(...)`; DTO fields need `@ApiProperty({ example })`. `test/swagger.e2e-spec.ts` fails otherwise.
- Every route declares its access policy or is denied: `@Public()`, `@Authenticated()`, `@Permissions('x.y')` or `@Roles(...)`. `test/rbac.e2e-spec.ts` lists routes without one. **Keep `@Permissions` / `@Roles` on one line** (the removability script strips them line by line).
- The approved list of public routes is asserted in `test/swagger.e2e-spec.ts`: adding a public route means updating it on purpose.
- Never return Prisma rows: map through a DTO mapper (`toUserDto`, `toExampleItemDto`). Input DTOs are allow-lists (unknown fields are a 422).
- Tokens (invitations, resets, refresh) are stored only as `hashToken()` SHA-256; passwords with `hashPassword()` (bcryptjs, cost `AUTH_BCRYPT_ROUNDS`). Escape user input used in `contains` with `escapeLike()`.
- Migrations are committed and never edited after merge; the seed is idempotent.
- If you change behaviour, update the docs in the same change; record non-obvious decisions and dependency pins in `docs/DECISIONS.md`.
- Never read or print `.env` files; ship `.env.example` only. Do not commit unless asked.

## Adding a feature: copy `src/example/`

`src/example/README.md` is the checklist (model + migration, DTOs, query definition, service, permissions, controller, registration, tests); `docs/how-to/add-module.md` adds the commands. `example.flow.spec.ts` is the test template (HTTP over the in-memory database), `example.service.spec.ts` asserts the exact Prisma calls. Row-level visibility is a query-builder `scope` applied to lists **and** single lookups (a hidden row answers 404).

## Listing endpoints: the query builder

Never hand-roll pagination, filtering or sorting. One definition per entity parses, validates and documents:

```ts
export const userQuery = defineQuery<Prisma.UserWhereInput, Prisma.UserOrderByWithRelationInput, Prisma.UserInclude>({
  filters: { role: oneOf({ values: Object.values(Role) }), is_active: boolean(), created_between: dateRange('created_at') },
  sorts: ['name', 'created_at'], defaultSort: '-created_at', search: ['name', 'email'],
});
// controller: @ApiQueryFrom(userQuery) list(@Query() query: RawQuery)
// service:    const q = userQuery.parse(query, { scope });
//             const [rows, total] = await this.prisma.$transaction([prisma.user.findMany(q.args), prisma.user.count({ where: q.where })]);
//             return q.paginate(rows.map(toUserDto), total);
```

URL: `?filter[role]=admin,user&filter[created_between]=2026-01-01,2026-01-31&search=ani&sort=-created_at,name&page=2&page_size=25`. Unknown filter/sort/include → 400 `UNKNOWN_*`, bad value → 400 `INVALID_QUERY`, `page_size` capped at 100, soft-deleted rows hidden unless `withTrashed`, stable `id` tiebreaker, LIKE wildcards escaped. Filter kinds: `exact`, `oneOf`, `partial`, `boolean`, `dateRange`, `callback`. Express runs with the `extended` query parser so `filter[x]` arrives as an object.

## Auth

- Global `JwtAuthGuard`; controllers get the caller with `@CurrentUser()` (`AuthenticatedUser`: id, email, role, session_id) and client IP/UA with `@Meta()`. With `AUTH_VERIFY_USER_PER_REQUEST` (default) the guard re-reads session and user each request, so revocation is immediate and the role comes from the database.
- Login state machine (`src/auth/auth.service.ts`): `POST /auth/login` → `authenticated | otp_required | mfa_required` (one `LoginResponseDto`); `POST /auth/login/otp` and `POST /auth/mfa/verify` finish it. Flags: `AUTH_METHODS` (`password` | `password,otp`), `AUTH_MFA` (`none|totp|otp`), `AUTH_REQUIRE_EMAIL_VERIFICATION`, `AUTH_ALLOW_REGISTRATION`, `AUTH_VERIFY_USER_PER_REQUEST`, `AUTH_DELIVERY`. Illegal combinations fail at boot (`env.schema.ts`, `auth.module.ts`).
- Challenges (`core/challenge.service.ts`) are single-use, attempt-limited rows; refresh tokens rotate in families with reuse detection (`core/session.service.ts`); TOTP is RFC 6238 on `node:crypto` (`totp/totp.util.ts`) with encrypted secrets and replay protection (`mfa.service.ts`).
- Codes and links go through `OtpSender` / `AuthNotifier` (console adapters print secrets only when `NODE_ENV=development`; email adapters use `EMAIL_TRANSPORT`). Sensitive routes carry `@Throttle`.
- Auth flow tests are `src/auth/*-flow.spec.ts`: `bootAuth(env)` from `test/helpers/auth-harness.ts` (real app, in-memory database, captured mail, `totpNow`). The in-memory database is a simulation: extend `test/database.e2e-spec.ts` for anything that depends on real transactions or constraints.
- Guides: `docs/how-to/enable-otp.md`, `docs/how-to/enable-mfa.md`.

## Authorization

- Matrix: `PERMISSION_ROLES` in `src/rbac/permissions.ts`; add a row, then `@Permissions('x.y')` on the route. Roles are the Prisma enum `Role` (`superadmin > admin > user`); levels and the hierarchy (act only on strictly lower roles, never on yourself, assign only lower roles) are in `src/auth/core/roles.ts`, not in `rbac/`.
- `UsersService` keeps its own admin-level gate and hierarchy rules on top of the controller permissions (user management stays restricted if RBAC is removed). `GET /rbac/permissions` returns the caller's permissions.

## Optional modules

`src/mail` (`EMAIL_TRANSPORT`), `src/storage` (`STORAGE`), `src/redis` (`REDIS_CLIENT`, shared fail-open throttle storage), `src/jobs` (`@nestjs/schedule`, `ENABLE_CRON`, enable on ONE instance) and `src/rbac` are deletable: nothing outside imports them except one line in `AppModule`. Do not add imports of these folders from other code; use the token/interface in `src/common/...`. `npm run check:rbac-removable` enforces it. `@nestjs/schedule` must stay on ^6 (v12 is ESM-only and breaks Jest). Guides: `docs/how-to/optional-modules.md`, `docs/how-to/remove-rbac.md`.

## Database

`npm install` runs `prisma generate`. Schema is `snake_case` with audit fields and soft delete via `src/prisma/soft-delete.ts` (`notDeleted`, `softDeleteData`). `DATABASE_URL` is required but Prisma connects lazily: the app boots with the database down and `/readyz` returns 503 (`database: down`). Unit/integration tests use `test/helpers/memory-prisma.ts` (or `prisma-mock.ts`) unless `createApp({ realDatabase: true })`.

## Docs

| | |
| :-- | :-- |
| `README.md`, `ARCHITECTURE.md` | Setup and how it fits together |
| `docs/DECISIONS.md` | Why: decisions, pins, deviations |
| `docs/how-to/` | add-module, enable-otp, enable-mfa, add-error-code, optional-modules, remove-rbac, enable-multitenancy, dynamic-roles, upgrade |
| `CHANGELOG.md` | Releases and upgrade notes |
