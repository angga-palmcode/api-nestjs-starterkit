# NestJS Starter Kit

A domain-agnostic backend foundation: **NestJS 11 · TypeScript (strict) · Prisma 5 · PostgreSQL · Node 22 · npm**. Start every new API (e-commerce, HRIS, SaaS, internal tools) from the same proven base instead of rebuilding auth, users, permissions and conventions by hand.

## What you get

- **Auth**: email + password, optional passwordless email code, optional second factor (authenticator app or emailed code), invitations, email verification, password reset, sessions with rotating refresh tokens, lockout, rate limits. One login state machine, one response contract, selected by flags.
- **Users & RBAC**: user management with an invite flow, a role hierarchy, a central permission matrix and a fail-closed guard (a route without a declared policy is denied).
- **Query builder**: `?filter[role]=admin&search=ani&sort=-created_at&page=2` parsed, validated and documented from one definition per entity.
- **Consistent API**: `{ data }` / `{ data, meta }` envelopes, one error shape with stable `error_code`s, Swagger with real examples at `/docs`.
- **Audit log**, soft delete, typed and validated configuration (fails at boot), structured logs with request ids, health probes, graceful shutdown.
- **Optional, deletable modules**: mail (SMTP), storage (local / S3), Redis (shared rate limiting, fails open), scheduled jobs.
- **A reference module** (`src/example`) with a copy-me checklist, and **machine-enforced conventions** (lint rules, route documentation and access-policy checks, 450+ tests, CI).

## Quick start (about 5 minutes)

This is the **"I just cloned the project"** path: the equivalent of `composer install` + `.env` + `key:generate` + `migrate` + `db:seed` + `serve`. It is also what a new teammate runs on day one.

Requirements: Node 22, npm, Docker (for PostgreSQL and Redis).

```bash
git clone <repository-url> && cd <project>
npm ci                        # install; also runs `prisma generate` and installs the git hooks
cp .env.example .env          # then set SEED_SUPERADMIN_PASSWORD (12+ characters) in .env
docker compose up -d          # PostgreSQL 16 (+ Redis 7, only needed if you use it)
npm run migrate               # apply prisma/migrations (creates the tables)
npm run seed                  # creates the superadmin from the SEED_* variables
npm run start:dev             # http://localhost:3000, API docs at /docs
```

Notes:

- After `git clone` you already have a repository. Only if the folder is **not** a git repository yet (for example you copied the files) run `git init -b main` **before** `npm ci`: Husky installs its hooks into the repository.
- The three `AUTH_*_SECRET` placeholders in `.env.example` work in development. They are **refused in production**: generate real ones with `openssl rand -base64 48` (three different values). For a shared environment (staging, production) ask the team for the real values; never commit `.env`.
- Redis is optional. If you do not run it, comment out `REDIS_URL` in `.env` (see [docs/how-to/optional-modules.md](docs/how-to/optional-modules.md)).
- Later, after pulling new commits: `npm ci` if `package-lock.json` changed, `npm run migrate` if `prisma/migrations/` changed, then `npm run start:dev`.
- Starting a **new** project from the kit instead? Follow [docs/how-to/use-as-template.md](docs/how-to/use-as-template.md); this section is for an existing repository.

Try it:

```bash
# sign in (the superadmin you seeded)
curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"superadmin@example.com","password":"<your SEED_SUPERADMIN_PASSWORD>"}'
# -> { "data": { "status": "authenticated", "access_token": "...", "refresh_token": "...", ... } }

curl -s localhost:3000/users -H "Authorization: Bearer <access_token>"
curl -s localhost:3000/healthz
```

Interactive API docs: <http://localhost:3000/docs> (on by default outside production; see `SWAGGER_ENABLED`).

## Scripts

| Command | What it does |
| :-- | :-- |
| `npm run start:dev` | Run with reload |
| `npm run build` / `npm run start:prod` | Compile to `dist/` / run the build |
| `npm run lint:check` / `npm run lint` | ESLint without / with `--fix` (CI uses `lint:check`) |
| `npm run format:check` / `npm run format` | Prettier check / write |
| `npm run typecheck` | `tsc --noEmit` over `src`, `test`, `prisma` |
| `npm test` / `npm run test:cov` | Unit and integration tests (in-memory database) / with the 80% coverage gate |
| `npm run test:e2e` | End-to-end tests against the real app setup; with `RUN_DB_TESTS=true` (and `REDIS_URL`) also the real PostgreSQL and Redis suites |
| `npm run migrate` / `npm run migrate:dev` | Apply migrations (`deploy`) / create one during development |
| `npm run seed` | Idempotent seed (superadmin, optional demo accounts) |
| `npm run check:rbac-removable` | Proves every optional module can be deleted (compiles copies without them, ~2 min) |

## Configuration

Every variable is declared and validated in `src/config/env.schema.ts`; the app refuses to start on a wrong or inconsistent value and tells you which. `.env.example` documents all of them. Reading `process.env` anywhere else is a lint error.

| Group | Variables (see `.env.example`) |
| :-- | :-- |
| Core | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `LOG_FORMAT`, `TRUST_PROXY`, `CORS_ORIGINS`, `SHUTDOWN_TIMEOUT_MS`, `DATABASE_URL`, `FRONTEND_URL` |
| Swagger | `SWAGGER_ENABLED`, `SWAGGER_USER` / `SWAGGER_PASSWORD`, `APP_NAME`, `APP_VERSION` |
| Auth flow | `AUTH_METHODS`, `AUTH_MFA`, `AUTH_REQUIRE_EMAIL_VERIFICATION`, `AUTH_ALLOW_REGISTRATION`, `AUTH_VERIFY_USER_PER_REQUEST`, `AUTH_DELIVERY` |
| Auth secrets & limits | `AUTH_ACCESS_SECRET`, `AUTH_MFA_CHALLENGE_SECRET`, `AUTH_EMAIL_VERIFY_SECRET`, `AUTH_MFA_ENCRYPTION_KEY`, TTLs, attempt and lockout limits, `AUTH_BCRYPT_ROUNDS` |
| Throttling | `THROTTLE_ENABLED`, `THROTTLE_LIMIT`, `THROTTLE_TTL_SECONDS` |
| Optional modules | `MAIL_*` / `SMTP_*`, `STORAGE_*` / `S3_*`, `REDIS_URL`, `ENABLE_CRON`, `JOBS_RETENTION_DAYS` |

## Project layout

```
src/
  main.ts  app.setup.ts  app.module.ts   bootstrap, HTTP setup (shared with tests), module wiring
  config/        typed, validated environment (zod)
  common/        envelope, errors, filters, pipes, query builder, swagger, logger, throttle, email seam, utils
  prisma/        PrismaService, soft-delete helpers
  auth/          login state machine, tokens, sessions, MFA, accounts; auth/core holds roles and guards
  users/         user management and invitations
  audit/         audit service, @Audited, interceptor
  health/        /healthz, /readyz
  example/       the reference module: copy it to add a feature
  rbac/  mail/  storage/  redis/  jobs/   optional modules (each deletable)
prisma/          schema.prisma, migrations/, seed.ts
test/            e2e suites and helpers (in-memory database, auth harness)
docs/            DECISIONS.md, ARCHITECTURE.md (root), how-to/
```

## Conventions (all machine-checked)

- `snake_case` fields everywhere; domain tables carry `created_at, updated_at, deleted_at, created_by, updated_by`; deletes are soft.
- Every route declares its access policy (`@Public`, `@Authenticated`, `@Permissions`, `@Roles`) and is fully documented in Swagger. Tests fail otherwise.
- Expected failures are `throw new AppException(ErrorCode.X, message)`; 5xx details never reach clients.
- Lists go through a `defineQuery` definition; DTOs are explicit allow-lists with `@ApiProperty({ example })`; rows are mapped to DTOs, never returned raw.
- Migrations are committed and never edited after merge.
- If you change behaviour, update the docs in the same change.

## Deploying

```bash
docker build -t my-api .                              # runtime image (non-root, health check)
docker build --target migrator -t my-api-migrate .    # one-off job image
docker run --env-file prod.env my-api-migrate         # prisma migrate deploy, run before each release
docker run --env-file prod.env -p 3000:3000 my-api
```

- Migrations are never run on boot; run the migrator as a release step.
- Probes: `GET /healthz` (liveness) and `GET /readyz` (readiness, 503 while the database is down or the process is shutting down).
- Behind a proxy or load balancer set `TRUST_PROXY` to the number of proxies (rate limits and audit use the client IP).
- On `SIGTERM` the app stops taking traffic, drains in-flight requests and exits (`SHUTDOWN_TIMEOUT_MS` is the safety net).
- In production: real secrets, `SWAGGER_ENABLED` off (or behind `SWAGGER_USER` / `SWAGGER_PASSWORD`), `AUTH_DELIVERY=email` with a mail transport if you use OTP or email flows, `ENABLE_CRON=true` on exactly one instance if you use jobs.

## Starting a real project from this template

Use the GitHub "Use this template" button (or `gh repo create <name> --template <org>/<kit-repo>`) once the kit is on GitHub. A manual copy works too (the guide shows how, with the repository created first or later). Never `git pull` the kit into an existing repository. The full guide, with the alternatives, the cleanup checklist and what each optional module's removal means, is [docs/how-to/use-as-template.md](docs/how-to/use-as-template.md). In short:

1. Create the copy: GitHub template or `degit` (no kit history), or a manual copy with the repository created first or later (options A to D in the guide).
2. `rm -rf docs/_origin`, rename `name` / `version` in `package.json` and `APP_NAME` in `.env`, reset `CHANGELOG.md`.
3. Delete the optional modules you do not need, then run `npm ci && npm run lint:check && npm run typecheck && npm test`.
4. Build your first feature by copying `src/example` ([add-module.md](docs/how-to/add-module.md)), then delete the example module and the `ExampleItem` model.
5. Replace the seed accounts and the permission matrix (`src/rbac/permissions.ts`).

## Documentation

| | |
| :-- | :-- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How it fits together: request lifecycle, auth design, data model, security decisions, testing strategy |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Every non-obvious decision and dependency pin, with the reason |
| [docs/how-to/](docs/how-to) | **use as template** · add a module · enable OTP · enable MFA · add an error code · optional modules · remove RBAC · multi-tenancy · dynamic roles · upgrade |
| [docs/prompts/first-prompt.md](docs/prompts/first-prompt.md) | The first prompt to give an AI coding assistant in a new project (read `CLAUDE.md`, run the setup steps, ground rules) |
| [CHANGELOG.md](CHANGELOG.md) | Releases and upgrade notes |
| [CLAUDE.md](CLAUDE.md) | Guidance for AI coding assistants (and a dense summary for humans) |
| [src/example/README.md](src/example/README.md) | The checklist for adding a feature |
