# NestJS Starter Kit — Architecture Blueprint & Execution Prompt

> Status: **Plan (non-living)** — point-in-time spec, written 2026-10-08.
> Part A updated 2026-10-08 with the review answers (EXTRACTION-MAP §6): A5, A6, A7, A9, A13 changed; deviations from the original text are logged in `docs/DECISIONS.md`.
> Source of truth for the extraction is `astos-be/` (NestJS 11, Prisma 5, PostgreSQL).
> This file has two parts: **Part A** (architecture decisions) and **Part B** (a self-contained prompt that
> an AI agent or engineer can execute to build the kit). Paste Part B into a fresh Claude Code session
> opened in an **empty repo** that has `astos-be/` available read-only (e.g. as a sibling folder).

---

# Part A — Architecture Blueprint

## A1. Goal

A **domain-agnostic NestJS starter kit** so that every new backend (e-commerce, HRIS, SaaS,
information system, ...) starts from the same proven foundation and the same conventions as
`astos-be`, instead of being rebuilt by hand.

Workflow:

```
starter-kit repo (tagged releases)
   │  GitHub "Use this template"  /  degit palm-code/nest-starter-kit
   ▼
new-project repo (clean git history)  →  push, then build domain modules on top
```

Non-goals: no business/domain modules, no vendor integrations (ElevenLabs, Telnyx, AdminJS, ...),
no frontend, no multi-tenancy by default.

## A2. Locked decisions

| Area | Decision |
| :-- | :-- |
| Distribution | Separate template repo, semver tags, `CHANGELOG.md`. No npm packages until a second project proves a part is stable. |
| Scope | Backend only: NestJS 11, TypeScript, Prisma 5, PostgreSQL, Node 22, **npm**. |
| Tenancy | **Single-tenant by default.** Multi-tenancy is optional via a documented extension point (A6), never baked into the base schema. |
| RBAC | Included as a **removable module**. Core auth depends only on a tiny interface (`user.roles`), never on `rbac/` internals. |
| Auth | Strategy-per-method, selected by env flags: password, email OTP, TOTP MFA. One state-machine login flow. |
| Swagger | First-class: envelope decorators, realistic examples, enforced by lint/test. |
| Query builder | Own small Prisma-only module, Spatie-style URL format. No new dependency. |
| Maintainers | Currently one BE engineer; future engineers must be productive without the author → example module, task-oriented docs, machine-enforced conventions. |

## A3. What goes in / what stays out

**Core (always present)**
- Bootstrap: `main.ts`, typed config + env validation (fail fast at boot), structured logger, graceful shutdown, health check
- Prisma module/service, base conventions (audit fields, soft delete), seed pattern
- Auth core: JWT access token + opaque refresh token, sessions, logout, force-logout, password reset, change password, lockout on repeated failures
- Users module (CRUD, invite, activate/deactivate)
- RBAC module (roles, permission matrix, guards, decorators, role hierarchy)
- Response envelope, global exception filter, error codes, validation pipe
- Query builder (filter / sort / include / search / pagination)
- Audit log (who did what, interceptor + service)
- Swagger (see A8)
- Security: helmet, CORS config, throttler (Redis storage optional, fail-open), request-id
- Tooling: ESLint, Prettier, Husky, Jest (unit + e2e), coverage threshold, GitHub Actions CI, Dockerfile, `docker-compose.yml` (Postgres + Redis), `.env.example`
- Docs: `CLAUDE.md`, `ARCHITECTURE.md`, `docs/` how-tos, `CHANGELOG.md`
- `example/` module: a complete reference CRUD (controller, service, DTOs, query definition, permissions, Swagger, tests)

**Optional (feature-flagged or deletable folder)** (implemented in Phase 8, see `docs/how-to/optional-modules.md` and D-801 to D-809)
- OTP login, TOTP MFA (flag-driven, see A5)
- Mail (nodemailer adapter + console adapter)
- Storage (S3 adapter + local adapter)
- Redis (throttler storage, cache) — flag-driven, fail-open
- i18n (nestjs-i18n) — optional, off by default unless chosen
- Background jobs / cron scaffold (`@nestjs/schedule`)

**Excluded (stay in their projects)**
Agents, campaigns, calls, telephony, AI provider, AdminJS, Rollbar-specific wiring (kit offers an
`ErrorReporter` interface instead), invoices, credits, webhooks-to-vendors, and every other Astos domain module.

## A4. Target folder structure

```
src/
  main.ts
  app.module.ts
  config/                  # typed config + env validation (zod), one file per concern
  common/
    constants/ decorators/ dto/ filters/ interceptors/ pipes/ utils/
    envelope/              # response envelope types + interceptor
    errors/                # error codes enum, AppException
    query/                 # query builder (A7)
    swagger/               # Swagger decorators + setup (A8)
  prisma/                  # PrismaModule, PrismaService, soft-delete helper
  auth/
    core/                  # tokens, sessions, refresh, logout, guards, @Public, @CurrentUser
    strategies/
      password/
      otp/
    mfa/
      totp/
    providers/             # OtpSender interface + console/email adapters
  rbac/                    # roles, permissions.ts, RolesGuard, @Roles/@Permissions, hierarchy
  users/
  audit/
  health/
  mail/                    # optional
  storage/                 # optional
  example/                 # reference module — copy this to add a module
prisma/
  schema.prisma  migrations/  seed.ts
test/                      # e2e
docs/
  how-to/                  # add-module, enable-otp, enable-mfa, remove-rbac, add-error-code, enable-multitenancy
```

## A5. Auth design (flag-driven)

```
AUTH_METHODS=password                    # password | password,otp
AUTH_MFA=none                            # none | totp | otp
AUTH_REQUIRE_EMAIL_VERIFICATION=true     # default true; login blocked until email is verified
AUTH_ALLOW_REGISTRATION=false            # default false = invite-only; true enables open self-registration
AUTH_VERIFY_USER_PER_REQUEST=true        # default true; per-request is_active / role check against the DB
AUTH_DELIVERY=console                    # console | email; email needs an EMAIL_TRANSPORT provider
```

`password,otp` means passwordless email-code login is offered **in addition to** the password (omit `password` in `POST /auth/login`); `AUTH_MFA` is the second factor. Full flag list and the rest of the Phase 4 decisions: `docs/DECISIONS.md` (D-401 to D-420).

- **Flags change the flow, not the schema.** `MfaSecret`, `OtpToken`, etc. tables always exist (a few empty tables cost less than conditional migrations).
- **Login is a state machine**, identical response contract for every flag combination so the FE never branches on config:
  `credentials → [otp_required] → [mfa_required] → authenticated (tokens)`.
  Each non-final state returns a short-lived `challenge_token` + `next_step`.
- `OtpSender` is an interface (`console` for dev, `email`, `sms` adapter stubs). The project picks the adapter.
- **Boot-time validation:** an invalid combination (e.g. `AUTH_MFA=otp` with no sender configured) must refuse to start, not fail at first login.
- Security defaults: OTP/recovery codes stored hashed, short TTL, attempt limit, per-endpoint rate limit, recovery codes single-use, account lockout with `locked_until`, timing-safe comparisons, refresh-token rotation + revoke-all.
- Out of v1 (extension point only): OAuth/social/SSO, passkeys.

## A6. RBAC & multi-tenancy

**RBAC**
- `rbac/permissions.ts`: single central matrix `PERMISSION → roles[]` (same idea as Astos `auth/permissions.ts`).
- Default roles: `superadmin`, `admin`, `user` (lower-case, consistent with `snake_case`); hierarchy rule (a user cannot edit/deactivate/promote someone at or above their level) is implemented once, in a helper, and reused by the users module.
- Role set lives in one place (enum + permissions file). A project needing fully dynamic DB-managed roles follows `docs/how-to/dynamic-roles.md` (documented, not built).
- The role model and hierarchy live in `auth/core/roles.ts`; `rbac/` holds the matrix, guard and decorators (D-501).
- Removing RBAC = delete `rbac/` + remove decorators (`docs/how-to/remove-rbac.md`, verified by `npm run check:rbac-removable`); auth core must still compile (enforce with a CI check that builds with the folder removed).

**Multi-tenancy (optional)**
- Base schema has **no** `tenant_id`.
- Provide the seam only: a `TenantContext` interface + a base `where` injection hook in the query builder and `PrismaService`. `docs/how-to/enable-multitenancy.md` documents the migration (add `Tenant`, `tenant_id` on tables, guard, scoped queries).

## A7. Query builder (`common/query`)

Concept: Spatie `QueryBuilder` as used in `tp-mainsite-api` (one definition class per entity with
whitelists), reimplemented for Prisma in roughly 300 lines, no new dependency.

URL format: `?filter[status]=active&filter[created_between]=2026-01-01,2026-01-31&sort=-created_at&include=roles&search=ani&page=2&page_size=25`

Wire format follows Astos (`page`, `page_size`, `meta.current_page/last_page`) so a later frontend migration stays cheap; `filter[x]` is the Spatie-style addition (explicit, no param-name clashes).

Per-entity definition (one file, e.g. `users.query.ts`):

```ts
export const userQuery = defineQuery<Prisma.UserWhereInput>({
  filters: {
    id: exact(),
    email: partial(),
    role: exact(),
    is_active: boolean(),
    created_between: dateRange('created_at'),
  },
  sorts: ['name', 'email', 'created_at'],
  defaultSort: '-created_at',
  includes: ['roles'],
  search: ['name', 'email'],
});
// service: const { where, orderBy, include, skip, take } = userQuery.parse(params, { scope });
```

Rules:
- **Whitelist is mandatory**: unknown filter/sort/include → `400` with a clear error code.
- `page_size` capped (default 25, max 100); include depth capped; no `fields` selection in v1.
- Prisma pitfalls handled by the builder: default soft-delete filter (opt-out `withTrashed`), search/filters combined via `AND` (never clobbering `OR`), `count` + `findMany` in one `$transaction`, `%`/`_` escaped in `contains`, stable `id` tiebreaker appended to every sort, multi-key sort.
- v1 filters: `exact`, `partial` (Prisma `contains`, parameterised, wildcards escaped), `boolean`, `dateRange`, `oneOf` (the `in` filter; renamed because `in` is a keyword), custom `callback`. Implemented in `src/common/query` (D-601 to D-610).
- `scope` param = extra `where` merged by the service (row-level scoping, future tenant hook).
- Returns the standard paginated envelope (`data`, `meta: { current_page, page_size, total, last_page }`, `last_page >= 1`).
- Swagger query parameters (`filter[...]`, `sort`, `include`, `search`, `page`, `page_size`) are **generated from the same definition** via a `@ApiQueryFrom(userQuery)` decorator.
- Cursor pagination: deferred.

## A8. Swagger standard

- Setup in `common/swagger/`: title/version/description from config, `addBearerAuth`, tags per module, enabled by `SWAGGER_ENABLED` (default **off** in production; optional basic-auth guard when on).
- Composite decorators (one line per endpoint):
  `@ApiOkEnvelope(Dto)`, `@ApiCreatedEnvelope(Dto)`, `@ApiPaginatedEnvelope(Dto)`, `@ApiErrorResponses(400, 401, 403, 404, 409, 422, 429)`.
- Envelope schemas (success, paginated, error) defined once; every example comes from them → docs cannot drift from the real response.
- Every DTO property: `@ApiProperty({ example })` with realistic values, never bare `string`.
- Standard error examples (validation failed, unauthenticated, forbidden, not found, conflict, rate limited) using the kit's real error codes.
- Auth endpoints show an example for **every state** of the login state machine.
- Stable `operationId` (`<module>_<action>`) and schema names (friendly for FE type generation).
- **Enforcement:** a test/ESLint rule that fails when a controller route lacks `@ApiOperation` and a response decorator. Optional: export `openapi.json` at build time (not committed).

## A9. Standard response format

**Success:** every success response is wrapped as `{ "data": ... }`; lists are `{ "data": [...], "meta": { current_page, page_size, total, last_page } }` (A7). The wrapper is applied by one interceptor in `common/envelope`, and Swagger schemas derive from the same types.

**Error:** keep the Astos flat shape (reference: `astos-be/src/common/filters/http-exception.filter.ts`):

```json
{ "message": "Validation failed", "error_code": "VALIDATION_ERROR", "timestamp": "2026-10-08T10:00:00.000Z",
  "request_id": "7c9e6679-...", "errors": [{ "field": "email", "message": "must be an email" }] }
```

- `error_code` is stable (`UNAUTHENTICATED`, `VALIDATION_ERROR`, `RATE_LIMITED`, ...); `errors` only for validation failures; `request_id` correlates with logs and the `X-Request-ID` response header (replaces Astos' `trace_id`).
- Validation failures are **422** `VALIDATION_ERROR`; unknown query filter/sort/include is **400** with its own code.
- Error codes live in one enum (`common/errors`), thrown via `AppException(code, message, details?)`; the filter maps everything to the shape above. i18n of messages is optional (off by default).

## A10. Conventions to enforce (machine-checked)

- Env access only through typed config (lint rule against `process.env` outside `config/`).
- Every endpoint documented (A8) and guarded or explicitly `@Public()`.
- Naming: DB columns/Prisma fields follow one convention (the kit uses `snake_case` fields, decided; do not mix).
- Prisma: audit fields (`created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by`) on domain tables; soft delete through a helper, never ad-hoc.
- Coverage threshold in `jest` config + CI (start at 80% statements; raise over time).
- Pre-commit: lint + format + typecheck. CI: build, lint, unit, e2e against Postgres service.
- Migrations: committed, never edited after merge; seed idempotent.

## A11. Documentation shipped with the kit

`README.md` (clone → run in under 5 minutes), `CLAUDE.md` (agent/engineer rules, mirrors `astos-be/CLAUDE.md`
but generic), `ARCHITECTURE.md`, `docs/how-to/*` (add module, enable OTP, enable MFA, remove RBAC, add error code,
enable multi-tenancy, upgrade from a previous kit version), `CHANGELOG.md` with upgrade notes per tag.
Rule carried over from Astos: **if you change behaviour, update the docs in the same PR.**

## A12. Definition of done for v1.0.0

1. Fresh clone: `npm i && docker compose up -d && npm run migrate && npm run seed && npm run start:dev` works.
2. `npm test`, `npm run test:e2e`, `npm run lint`, `npm run build` all green; coverage ≥ threshold.
3. Swagger at `/docs` shows every endpoint with example success + error responses; all four auth flag combinations demonstrated.
4. `example/` module demonstrates the full pattern incl. query builder + permissions + Swagger + tests.
5. Build passes with `rbac/`, `mail/`, `storage/` folders deleted (documented removal steps verified).
6. No Astos-specific names, vendors, or domain terms remain (`grep -ri astos` returns nothing).
7. Tagged `v1.0.0`; `CHANGELOG.md` written.

## A13. Decisions (resolved 2026-10-08)

1. Role model: **fixed enum + central matrix** (`superadmin | admin | user`); DB-driven roles documented only.
2. Field naming: **`snake_case`**.
3. i18n: **off by default**, pluggable.
4. Repo name: **`Palm-Code/nest-starter-kit`** (private, GitHub template).
5. Astos does **not** migrate onto the kit; the kit follows Astos conventions so a later migration stays feasible.

Review answers that changed Part A: pagination/filter wire format (A7), `{ data }` success envelope and flat error shape (A9), email-verification / registration / per-request-check flags (A5), lower-case roles (A6). See `docs/DECISIONS.md`.

---

# Part B — Execution Prompt

> Copy everything inside the block below into a new Claude Code session. Precondition: the working
> directory is an **empty git repo** for the kit, and the Astos backend is readable at the path given in `ASTOS_BE_PATH`.

````text
ROLE
You are a senior NestJS tech lead building a reusable, domain-agnostic NestJS starter kit by
EXTRACTING and GENERALISING proven patterns from an existing project. Work like a professional
lead: extract from real code, not speculation; keep the kit small, boring and well-documented.

INPUTS
- ASTOS_BE_PATH = <absolute path to astos/astos-be>   (READ-ONLY reference. Never modify it.)
- QUERY_BUILDER_REFERENCE = <absolute path to tinyparrotapi/tp-mainsite-api/app/QueryBuilders> (READ-ONLY; Laravel + Spatie concept reference only)
- BLUEPRINT = <absolute path to astos/docs/non-living/shared/NEST-STARTER-KIT-BLUEPRINT.md>, Part A.
  Read Part A fully first. It is the spec; if you must deviate, record why in docs/DECISIONS.md.
- Target: the current working directory (empty repo). Package manager: npm. Node 22.

HARD RULES
1. The kit must be domain-agnostic. No Astos names, vendors (ElevenLabs, Telnyx, Twilio, AdminJS, Rollbar-specific code),
   or domain concepts (agents, campaigns, calls, leads, invoices, credits...). Final `grep -ri "astos"` must be empty.
2. Single-tenant by default. No tenant_id in the base schema; provide only the documented seam.
3. Do not commit unless I ask. Do not run `prisma migrate dev/deploy`: prepare migration files / provide the command for me to run.
   (Generating the initial migration SQL by `prisma migrate diff` is allowed; applying it is not.)
4. Never read or print .env files. Ship `.env.example` only.
5. Prefer small, readable code over clever abstractions. No new dependency unless justified in DECISIONS.md.
6. TDD where practical: write the spec first for guards, query builder, auth state machine, exception filter.
7. Every endpoint must be Swagger-documented per Part A8, and tested.
8. Use the Astos code as the pattern source: read the real file, then generalise it, do not rewrite from memory.

PHASE 0: Audit (read-only, no code yet)
Read ASTOS_BE_PATH (src/main.ts, app.module.ts, config/, common/, auth/, users/, audit/, prisma/, health/,
throttler setup, test setup, eslint/prettier/jest config, Dockerfile, CLAUDE.md, ARCHITECTURE.md) and
QUERY_BUILDER_REFERENCE. Produce `docs/EXTRACTION-MAP.md`: a table of every Astos file/module →
{CORE | OPTIONAL | EXCLUDE | NEEDS-REFACTOR-BEFORE-EXTRACT} with one-line reason, plus the list of
Astos-specific couplings you must cut (e.g. org_id on User, org-context guards, AdminJS, Rollbar, i18n resolvers
tied to user locale, fixed Astos role names). STOP and show me the map + your answers/proposals for
Blueprint section A13 before writing code.

PHASE 1: Skeleton & tooling
Nest 11 + TS project, strict-ish tsconfig, ESLint (flat config) + Prettier, Husky + lint-staged, Jest unit + e2e,
coverage threshold, GitHub Actions CI (build, lint, unit, e2e with Postgres service), Dockerfile (multi-stage),
docker-compose (Postgres + Redis), `.env.example`, typed config with zod env validation (fail fast),
structured logger, request-id, graceful shutdown, health endpoint, helmet, CORS, global ValidationPipe.
Add the lint rule/check banning `process.env` outside `config/`.

PHASE 2: Common layer
Response envelope + interceptor, AppException + error-code enum, global exception filter (generalised from
Astos' http-exception.filter, error shape per A9; i18n optional behind a flag), pagination DTO/meta,
Swagger module + composite decorators + envelope schemas + standard error examples + the "every route is documented" enforcement test (A8).

PHASE 3: Prisma + Users + Audit
PrismaModule/Service, schema with: User, RefreshToken, UserSession, PasswordResetToken, MfaEmailToken/OtpToken,
MfaSecret + recovery codes, UserInvitation, AuditLog, (+ `ExampleItem` for the example module). Audit fields and
soft-delete helper. Initial migration FILES only. Idempotent seed (superadmin/admin/user, password from env).
Users module (list, get, create/invite, update, activate/deactivate, force-logout) using the role-hierarchy helper.
Audit module + interceptor.

PHASE 4: Auth
Implement A5: core (access JWT + opaque rotating refresh token, sessions, logout, revoke-all, password reset,
change password, lockout), strategies (password; email OTP), MFA (TOTP with recovery codes; OTP), `OtpSender`
interface with console + email adapters, login state machine with a uniform response contract, env flags
`AUTH_METHODS` / `AUTH_MFA`, boot-time validation of illegal combinations. Rate-limit sensitive endpoints.
Swagger example for every state. Tests cover every flag combination.

PHASE 5: RBAC
`rbac/` per A6: central permissions matrix, RolesGuard/PermissionsGuard, `@Roles`/`@Permissions`, hierarchy helper.
Auth core depends only on the `user.roles` interface. Add a CI step that builds with `rbac/` deleted
(or a documented script) to prove removability.

PHASE 6: Query builder
Implement `common/query` per A7, test-first. Whitelist enforcement, filter types (exact, partial, boolean,
dateRange, in, callback), sort, include (depth cap), search, pagination with cap, scope merge hook,
`@ApiQueryFrom(definition)` Swagger generation. Unit-test: unknown filter → 400, injection-ish inputs are
treated as plain values, limit cap, default sort, multi-sort, scope merge.

PHASE 7: Example module
`example/` full CRUD exercising: DTOs with `@ApiProperty` examples, query definition, permissions, envelope
decorators, audit, soft delete, unit + e2e tests. This is the template engineers copy; make it exemplary.

PHASE 8: Optional modules & throttling
Mail (nodemailer + console adapter), Storage (S3 + local adapter), Redis throttler storage (fail-open, flag-driven),
cron scaffold. Each folder is deletable; document removal in docs/how-to.

PHASE 9: Documentation
README (clone → running in <5 min), CLAUDE.md (generic version of astos-be/CLAUDE.md: doc-sync rule, conventions,
"how to add a module"), ARCHITECTURE.md, docs/DECISIONS.md, docs/how-to/{add-module, enable-otp, enable-mfa,
remove-rbac, add-error-code, enable-multitenancy, dynamic-roles, upgrade}.md, CHANGELOG.md.

PHASE 10: Verification
Run: install, build, lint, unit, e2e, coverage. Boot the app against docker-compose and walk through Swagger.
Verify A12 items 1 to 7 one by one and report PASS/FAIL with evidence. Run the "delete optional folders and rebuild"
check. Run `grep -ri astos .` (must be empty). Fix failures; do not weaken tests to pass.

WORKING STYLE
- After each phase: run build + tests, summarise what was done, list deviations, and wait for my OK before the next phase
  (unless I say "continue through").
- Keep a running `docs/PROGRESS.md` (phase, status, open questions).
- Prefer editing/composing small files. Match Astos naming (snake_case Prisma fields) unless the A13 decision says otherwise.
- If something in Astos looks wrong or too Astos-specific, flag it instead of silently copying it.

START NOW WITH PHASE 0 ONLY.
````

---

# Part C — Notes for the person running Part B

- Fill the three path placeholders (`ASTOS_BE_PATH`, `QUERY_BUILDER_REFERENCE`, `BLUEPRINT`) before pasting.
- Phase 0 intentionally stops for review: the extraction map is where scope mistakes are cheapest to fix.
- Astos observations worth knowing up front (from a quick look; confirm in Phase 0):
  `User` is tied to `Organization` via `org_id` (a tenant-like concept to cut), roles are a fixed enum with a
  hard-coded matrix in `auth/permissions.ts` (good model for the kit), the exception filter is i18n-coupled,
  and `main.ts` carries AdminJS-specific code that must not be copied.
- After the second real project is built from the kit, run a short retrospective: whatever was changed
  after copying in both projects belongs in the next kit version.
