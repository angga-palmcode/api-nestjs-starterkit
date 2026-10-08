# Decisions & deviations

Why the kit is the way it is: deviations from the original design, dependency pins and the reasons behind non-obvious choices. IDs (D-xxx) are referenced from code comments and other docs. "The source project" is the application the kit's patterns were extracted from; its audit and the original plan are kept for maintainers in `docs/_origin/`.

Records every deviation from the original Blueprint (`docs/_origin/non-living/shared/NEST-STARTER-KIT-BLUEPRINT.md`, maintainers only) (Part A) and every new dependency, with the reason.
Blueprint Part A was updated in place on 2026-10-08 to reflect D-001 to D-009; the original wording is summarised here.

## Deviations from the original Blueprint

| ID | Date | Topic | Blueprint said | Decision | Why |
| :-- | :-- | :-- | :-- | :-- | :-- |
| D-001 | 2026-10-08 | Pagination params | `page`, `limit` (default 20) | `page`, `page_size`, default 25, max 100 | The source project wire-compatible; cheaper FE migration |
| D-002 | 2026-10-08 | Pagination meta | `page, limit, total, total_pages` | `current_page, page_size, total, last_page` (`last_page >= 1`) | Same |
| D-003 | 2026-10-08 | Filter syntax | `filter[x]` | `filter[x]` kept; snake_case names (`filter[created_between]`) | Explicit, no param-name clashes with the source project's flat params |
| D-004 | 2026-10-08 | Unknown sort/filter | 400 | 400 with its own error code (the source project silently ignored) | Fail loud |
| D-005 | 2026-10-08 | Success envelope | `{ data, meta }` | `{ data }` on every success; lists add `meta` | Uniform + Swagger-friendly; deliberately differs from the source project raw bodies |
| D-006 | 2026-10-08 | Error shape | nested `error.code` | The source project flat shape `{message, error_code, timestamp, request_id, errors?}`; `request_id` replaces `trace_id` | Parity with the source project clients; A9 wording was wrong |
| D-007 | 2026-10-08 | Validation status | 400 | 422 `VALIDATION_ERROR` | The source project convention |
| D-008 | 2026-10-08 | Roles | `SUPER_ADMIN / ADMIN / USER` | `superadmin / admin / user` | Consistent with snake_case; keeps code portable from the source project |
| D-009 | 2026-10-08 | Auth flags | `AUTH_METHODS`, `AUTH_MFA` | Add `AUTH_REQUIRE_EMAIL_VERIFICATION` (default true), `AUTH_ALLOW_REGISTRATION` (default false, invite-only), `AUTH_VERIFY_USER_PER_REQUEST` (default true) | Review answers 4-6 |
| D-010 | 2026-10-08 | Resolved A13 | open | enum+matrix, snake_case, i18n off, repo `Palm-Code/nest-starter-kit`, no the source project migration | Review answer 7 |

## Phase 1 implementation decisions

| ID | Topic | Decision | Why |
| :-- | :-- | :-- | :-- |
| D-101 | Dependency: `zod` | Env validation schema | Mandated by Blueprint A2/A10; single source for env types |
| D-102 | Dependency: `class-validator`, `class-transformer` | Global `ValidationPipe` | Required by Nest's pipe; DTO validation from Phase 2 on |
| D-103 | Dependency: `helmet` | Security headers | Blueprint A3 |
| D-104 | No logger dependency | Own ~50-line JSON `LoggerService` (`AppLogger`) with request-id via `AsyncLocalStorage` | Avoids pino/winston for what the kit needs; swappable behind Nest's `LoggerService` |
| D-105 | No `@nestjs/terminus` | Hand-rolled `/healthz` + `/readyz` with a pluggable readiness-check registry | Prisma arrives in Phase 3; the DB check registers itself then. Matches the source project behaviour (200/503) |
| D-106 | Validation status already 422 | `ValidationPipe` configured with `errorHttpStatusCode: 422` now | D-007; exception filter unifies shape in Phase 2 |
| D-107 | Throttler / Redis | Not in Phase 1 (Part B puts them in Phase 8); `REDIS_URL` is in the env schema as optional only | Phase scope |
| D-108 | `strict: true` | Full strict (incl. `strictPropertyInitialization`); DTO fields use `!` | source-project audit §3 #16 |
| D-109 | `process.env` ban | ESLint `no-restricted-syntax` outside `src/config/**`, tests and tooling configs | Blueprint A10 |
| D-110 | Lint scripts | `lint` = `eslint --fix`, `lint:check` = no fix (used by CI and pre-commit check) | source-project audit §3 #16 |
| D-111 | ts-jest / jest | jest 30 with ts-jest 29.4+ (declares jest 30 support); no auth-specific `transformIgnorePatterns` | source-project audit §3 #16 |
| D-112 | Health outside the envelope | `/healthz` and `/readyz` return plain bodies, never `{ data }` | Orchestrators read the status code; keep probes trivial (D-005 applies to API routes) |
| D-113 | Version pins | `@nestjs/*` ^11, `@nestjs/config` ^4, TypeScript ^5.9, ESLint ^9, `@types/node` ^22. `npm i` otherwise resolves Nest 12 / TS 6 / ESLint 10 | Blueprint A2 says Nest 11 + Node 22; revisit as an explicit upgrade |
| D-114 | `isolatedModules: true` | In `tsconfig.json` | Required by ts-jest for `module: nodenext`; type-checking stays in `npm run typecheck` (CI + pre-commit) |
| D-115 | Env validated at import | `ConfigModule.forRoot({ validate })` runs when `app.module.ts` is loaded. E2E tests therefore override `ConfigService` with a validated config instead of mutating `process.env`; boot failure is covered by `env.schema.spec.ts` | Nest's `forRoot` is synchronous at import |
| D-116 | Coverage scope | Threshold 80% (all four metrics) over unit tests; `main.ts`, `app.setup.ts` and `*.module.ts` excluded (wiring, exercised by e2e) | Avoid inflating/deflating numbers with bootstrap code |
| D-117 | Graceful shutdown | `HealthService` flips `/readyz` to 503 and `GracefulShutdownService` arms a `SHUTDOWN_TIMEOUT_MS` watchdog on signal only (not on programmatic `app.close()`) | Drain at the load balancer first; never hang forever |

## Phase 2 implementation decisions

| ID | Topic | Decision | Why |
| :-- | :-- | :-- | :-- |
| D-201 | Dependency: `@nestjs/swagger` | OpenAPI + Swagger UI | Blueprint A8 |
| D-202 | Error codes | `ErrorCode` enum + `ERROR_STATUS` map in `common/errors`; `AppException(code, message, { status?, errors? })`; `codeForStatus` for plain `HttpException`s. Query-builder codes arrive in Phase 6, auth codes in Phase 4 | One source for codes (A9) |
| D-203 | 5xx hygiene | The filter never returns the original message for 5xx (including `HttpException` 5xx); detail goes to logs and the `ErrorReporter` seam (`ERROR_REPORTER`, no-op by default) | Avoid leaking internals; replaces vendor-specific reporting |
| D-204 | i18n | Not wired: messages are plain strings (A9: optional, off by default) | A13 #3 |
| D-205 | Validation errors | `createValidationPipe()` builds `AppException(VALIDATION_ERROR)` with `errors: [{ field: "a.b", message }]` (one entry per violated constraint) instead of Nest's string array | Per-field errors (A9) |
| D-206 | Malformed JSON | Nest maps the parser `SyntaxError` to `BadRequestException(parser message)` before our filter; we return `400 BAD_REQUEST` with that text. Raw body-parser errors (e.g. 413) get fixed messages | Cannot intercept earlier without replacing the body parser |
| D-207 | `/readyz` 503 | Controller sets the status via `@Res({ passthrough })` and returns the body instead of throwing, so the probe body is not reshaped by the filter (D-112) | Probe contract |
| D-208 | Swagger config | New env: `APP_NAME`, `APP_VERSION`, `APP_DESCRIPTION`, `SWAGGER_ENABLED` (unset = on except production), `SWAGGER_USER`/`SWAGGER_PASSWORD` (both or neither, password >= 8). UI at `/docs`, JSON at `/docs-json`. Enabling in production without credentials logs a warning | Blueprint A8 |
| D-209 | operationId | `<controller_snake>_<method_snake>` via `operationIdFactory` (e.g. `health_liveness`) | Stable FE type generation |
| D-210 | "Every route documented" check | `findUndocumentedRoutes(app)` (scans `ModulesContainer`) asserted empty in `test/swagger.e2e-spec.ts`. It checks `@ApiOperation` + a response decorator. **Not yet checked: guarded-or-`@Public()`** (needs Phase 4/5). ESLint rule not added; the e2e test is the enforcement | Metadata keys are hard-coded because `@nestjs/swagger/dist/constants` is not exported under `nodenext` |
| D-211 | Coverage | `swagger.setup.ts` bootstrap body and `error-response.dto.ts` are only exercised by e2e; global branch coverage stays above 80% without excluding them | D-116 |

## Phase 3 implementation decisions

| ID | Topic | Decision | Why |
| :-- | :-- | :-- | :-- |
| D-301 | Dependencies | `@prisma/client` + `prisma` pinned to ^5.22 (Blueprint A2), `bcryptjs` (password hashing; pure JS, no native build on Windows/Alpine), `dotenv` (the seed script loads `.env`) | Needed for the phase |
| D-302 | Single role per user | `User.role` (Prisma enum `Role`: `superadmin`, `admin`, `user`) instead of a `roles` relation/array | Matches the source project and the fixed enum + matrix decision (A13 #1). The Blueprint wording "`user.roles`" is read as "the role of the user"; auth core will depend on `AuthenticatedUser.role` only |
| D-303 | Hierarchy helper location | Originally planned in `rbac/`; it lives in `src/auth/core/roles.ts` (level map, `canActOn`, `assertCanActOnRole`, `assertCanAssignRole`) so that user management compiles without RBAC (see D-501) | Hierarchy is "implemented once" (A6) while permissions/guards still arrive in Phase 5 |
| D-304 | Interim authorization | `UsersService` requires admin level (`hasAtLeast`) for every operation; replaced by the permission matrix in Phase 5 | No guards yet |
| D-305 | Placeholder auth | `AuthRequiredGuard` is fail-closed (401 unless `request.user` is set; nothing sets it until Phase 4). `AuthenticatedUser` and `@CurrentUser()` live in `auth/core` and are final. e2e tests inject a user with a middleware (`x-test-role` header) | Users endpoints must exist and be documented now, but never be open |
| D-306 | Users endpoints | `GET /users`, `GET/PATCH/DELETE /users/:id`, `POST /users/invitations`, `POST /users/:id/{activate,deactivate,force-logout}`. The list uses interim flat filters (`search`, `role`, `is_active`) until the query builder (Phase 6). No direct "create user with a password": users arrive through invitations (invite-only default, D-009) | Part B Phase 3 |
| D-307 | Self-protection and hierarchy | An actor can never act on themselves through these endpoints, nor on anyone at or above their level; roles are assignable only strictly below the actor (an admin can only invite `user`; a superadmin cannot create another superadmin) | source-project audit section 2 (`assertCanActOnRole`); self-service profile changes belong to `/auth/me` (Phase 4) |
| D-308 | Access revocation | Deactivate / force-logout / delete revoke every refresh token and session and bump `User.token_version` in one transaction; a role change bumps `token_version` too. Phase 4's per-request check (D-009) compares it | Finding 3.7 |
| D-309 | Soft delete | Helper `src/prisma/soft-delete.ts` (`notDeleted`, `softDeleteData`), applied explicitly in services; the query builder will apply it by default (Phase 6). A soft-deleted user keeps their email reserved (invitations check all rows) | A10 |
| D-310 | Invitations | Only the SHA-256 hash of a 256-bit token is stored; a new invitation revokes pending ones for the email; TTL `INVITATION_TTL_HOURS` (72); delivery goes through an `INVITATION_SENDER` seam, fire-and-forget with logged failures. The default `ConsoleInvitationSender` prints the link only when `NODE_ENV=development` | Findings 3.10, 3.12. Accepting an invitation is Phase 4 |
| D-311 | Audit | `AuditService.record()` is fire-and-forget and never throws; `@Audited(action, entity_type)` + `AuditInterceptor` write after success only. No request bodies in audit rows. Failed logins/lockouts will be audited in Phase 4 | Finding 3.14 |
| D-312 | LIKE escaping | `escapeLike()` for user-supplied `contains` values (Prisma does not escape `%`/`_`); to be verified against a real database by `test/database.e2e-spec.ts` | the source-project audit (`docs/_origin/source-project audit.md` section 4) |
| D-313 | Database in tests | Unit/e2e tests use a hand-rolled Prisma mock (`test/helpers/prisma-mock.ts`) so they run without Docker. `test/database.e2e-spec.ts` runs against a real DB only with `RUN_DB_TESTS=true` (CI: migrate, then run). **Not yet executed anywhere** at the end of Phase 3 | No local Postgres/Docker available while building |
| D-314 | `DATABASE_URL` required | Boot fails without it. Prisma connects lazily, so the app still boots when the database is down; `/readyz` reports `database: down` (503) | Fail-fast config vs. resilient boot |
| D-315 | Migrations | `prisma/migrations/20261008000000_init` generated with `prisma migrate diff --from-empty --to-schema-datamodel` (verified identical to the schema); **not applied**. Run `npm run migrate` | Hard rule 3 |
| D-316 | Schema notes | `OtpToken` (purpose `login`/`mfa`) merges the Blueprint's MfaEmailToken/OtpToken; `RefreshToken` has `family_id` and `session_id` (reuse detection, session binding: findings 3.6/3.8); `MfaSecret.pending_secret` + `last_used_step` (findings 3.4/3.5); `ExampleItem` is the Phase 7 reference entity | Findings section 3 |
| D-317 | Seed | `npm run seed` (also `prisma db seed`): superadmin required, admin/user optional, passwords from `SEED_*` env (>= 12 chars), never printed, existing accounts untouched unless `SEED_RESET_PASSWORDS=true`; account parsing is unit-tested (`prisma/seed-accounts.ts`) | Part B Phase 3 |
| D-318 | Docker | Builder runs `prisma generate`; the runner copies `node_modules/.prisma`; new `migrator` stage (`--target migrator`) for `prisma migrate deploy`; OpenSSL installed. **Image not built locally** (Docker daemon off) | Migrations never run on boot |
| D-319 | Coverage scope | `*.controller.ts` excluded from unit coverage (exercised by e2e); Jest `roots` includes `prisma/` so seed helpers are unit-tested | D-116 |

## Phase 4 implementation decisions

| ID | Topic | Decision | Why |
| :-- | :-- | :-- | :-- |
| D-401 | Dependencies | `@nestjs/jwt` (HS256 tokens), `@nestjs/throttler` (rate limits). **No** passport, **no** otplib: TOTP (RFC 6238) and base32 are ~100 lines on `node:crypto`, verified against the RFC test vectors | Fewer dependencies; avoids otplib's ESM/Jest friction seen in the source project |
| D-402 | Interpreting `AUTH_METHODS` | `password` = email + password. `password,otp` **adds** passwordless email-code login (omit `password` in `POST /auth/login`); it is an alternative, not a second factor. Second factors are `AUTH_MFA` (`totp` / `otp`). `password` is always required in the list | The Blueprint's `[otp_required]` state only makes sense if OTP can be the first step |
| D-403 | State machine contract | One `LoginResponseDto`: `status` (`authenticated` / `otp_required` / `mfa_required`) + `next_step` (`verify_otp` / `verify_mfa` / null) + `challenge_token` / `mfa_method` / tokens. Endpoints: `POST /auth/login`, `POST /auth/login/otp`, `POST /auth/mfa/verify`. After an emailed-code login the email second factor (`AUTH_MFA=otp`) is skipped (mailbox already proven); TOTP is still required when enrolled. Users who have not enrolled TOTP under `AUTH_MFA=totp` log in without it (enforcing enrolment is a project decision) | Uniform FE contract (A5) |
| D-404 | Challenges | Each challenge is an `OtpToken` row (id = JWT `jti`): single use, `AUTH_OTP_MAX_ATTEMPTS`, expiry `AUTH_CHALLENGE_TTL_SECONDS`; the attempt is counted *before* the code is checked; success is consumed with an atomic `updateMany`. TOTP challenges use the same row (code_hash `totp`). Email codes are 6 digits, stored as SHA-256(`user_id:code`) | Finding 3.1 |
| D-405 | No account enumeration | Wrong password and unknown address both give `401 INVALID_CREDENTIALS` after equal bcrypt work (decoy hash); passwordless login returns a decoy challenge for unknown/disabled/locked addresses; forgot-password, resend-verification and register always answer 202. `EMAIL_NOT_VERIFIED` / `ACCOUNT_DISABLED` are only revealed after the password is proven. While locked, even the right password answers like a wrong one | Findings 3.2 / 3.15 |
| D-406 | Lockout | `AUTH_MAX_FAILED_LOGINS` failures lock for `AUTH_LOCKOUT_MINUTES`; every further failure after a lock doubles it (cap 24h); the owner is notified once (first lock); a locked account is never extended by attempts (no lock-out DoS); success resets. Wrong MFA/OTP codes count too. Shared `assertLoginAllowed` + lock check on every step | Findings 3.2 / 3.15 |
| D-407 | Sessions & refresh tokens | A session is created at login; access tokens carry its id (`sid`), never a client-supplied header. Refresh tokens are opaque, hashed, single use, in a rotation family; reuse of a spent token (or losing a concurrent race) revokes the family and session and audits `auth.refresh_reuse_detected`. Two truly simultaneous refreshes of the same token therefore end the session (no grace window) | Findings 3.6 / 3.8 |
| D-408 | Per-request check | Global `JwtAuthGuard` (`APP_GUARD`, registered via `useExisting` so tests can override it). With `AUTH_VERIFY_USER_PER_REQUEST=true` (default) it loads the session and user (2 queries per request): revoked session, inactive/deleted user or stale `token_version` → 401; the **role comes from the database**, not the token. With `false` the token is trusted until expiry (logout then no longer kills the access token; documented and tested) | Finding 3.7 / answer 6 |
| D-409 | Three secrets | `AUTH_ACCESS_SECRET`, `AUTH_MFA_CHALLENGE_SECRET`, `AUTH_EMAIL_VERIFY_SECRET`: >= 32 chars, pairwise different, distinct audiences, `HS256` pinned; `change-me...` placeholders refused in production. The refresh secret the source project demanded but never used is gone (refresh tokens are opaque). Email verification links are JWTs that expire (`AUTH_EMAIL_VERIFY_TTL_HOURS`) | Finding 3.9 |
| D-410 | TOTP | Secret encrypted at rest with AES-256-GCM (`AUTH_MFA_ENCRYPTION_KEY`, required when `AUTH_MFA=totp`); enrolment uses `pending_secret` (a repeat `/setup` only replaces the pending one; `/setup` when enabled is 409); `last_used_step` blocks replay (atomic); 10 recovery codes, SHA-256 hashed, redeemed with an atomic `updateMany` and only while MFA is enabled; `/disable` needs password + code; regenerating invalidates old codes. All `/auth/mfa/totp/*` routes are 404 unless `AUTH_MFA=totp` | Findings 3.3-3.5 |
| D-411 | Passwords | bcrypt via `bcryptjs`; cost `AUTH_BCRYPT_ROUNDS` (12; tests use 4); length 10-72 (bcrypt ignores bytes past 72, so longer is rejected rather than truncated). Reset / change-password revoke every session and bump `token_version`; reset links are hashed, single use, latest-wins, `AUTH_RESET_TTL_MINUTES`; following a reset or invitation link also verifies the email | Findings 3.10 |
| D-412 | Invitations (accept) | `POST /auth/accept-invite` claims the invitation with an atomic update inside a transaction, creates the verified user with the invited role, rolls back if the email was taken. Returns the user (sign in afterwards) | Finding 3.10 |
| D-413 | Delivery seams | `OtpSender` (OTP codes) and `AuthNotifier` (verification, reset, lock notice) with console adapters (secrets printed only when `NODE_ENV=development`) and email adapters over a tiny `EmailTransport` interface (`src/common/email`, outside the optional mail module). `AUTH_DELIVERY=email` without an `EMAIL_TRANSPORT` provider fails at boot; OTP flows in production require `AUTH_DELIVERY=email`. The nodemailer transport itself arrives in Phase 8. All sends are fire-and-forget with logged failures | A5 boot validation; findings 3.12 |
| D-414 | Throttling | `ThrottleModule` (in-memory) with `THROTTLE_LIMIT` / `THROTTLE_TTL_SECONDS` / `THROTTLE_ENABLED`; stricter per-route limits on login (10/min), OTP/MFA verify (10/min), refresh (30/min), register / forgot-password / resend (5/min), reset/accept/verify (10/min), change-password and MFA management (5-10/min); health is skipped; 429 -> `RATE_LIMITED` with a fixed message and `Retry-After`. Redis storage: Phase 8 | Finding 3.11 |
| D-415 | Error codes | Added `INVALID_CREDENTIALS`, `INVALID_TOKEN`, `INVALID_CODE` (401), `EMAIL_NOT_VERIFIED`, `ACCOUNT_DISABLED` (403). One-time link tokens (reset, verify, invite) use `INVALID_TOKEN` with status 400 | A9 |
| D-416 | Audit events | `auth.login`, `auth.login_failed` (reason only; no email stored for unknown accounts), `auth.account_locked`, `auth.refresh_reuse_detected`, `auth.logout`, `auth.logout_all`, `auth.password_changed`, `auth.password_reset(_requested)`, `auth.email_verified`, `auth.register`, `auth.invitation_accepted`, `auth.mfa_enabled/disabled`, `auth.recovery_codes_regenerated`, `auth.session_revoked`, `auth.profile_updated`; `AuditService` stamps the current request id | Finding 3.14 |
| D-417 | Authentication coverage check | `listPublicRoutes(app)` must equal an approved list (`test/swagger.e2e-spec.ts`); everything else is guarded by the global `JwtAuthGuard`. Completes the "guarded or `@Public()`" half of D-210 (RBAC/permission coverage comes with Phase 5) | A10 |
| D-418 | `AuthRequiredGuard` removed | Replaced by the global `JwtAuthGuard` + `@Public()`; Users e2e now use real access tokens | Phase 3 placeholder |
| D-419 | Test strategy | Flow tests live in `src/auth/*-flow.spec.ts` (run by `npm test`, count towards coverage): the real Nest app over `test/helpers/memory-prisma.ts` (atomic `updateMany`, uniqueness, `increment`, transactions with rollback) with all deliveries captured (`test/helpers/auth-harness.ts`). Every `AUTH_METHODS` x `AUTH_MFA` combination (6) is exercised. The memory DB is a simulation: the same flows against PostgreSQL run in `test/database.e2e-spec.ts` (**not executed yet**, see D-313) | No Docker/Postgres locally |
| D-420 | Config precedence in tests | `ConfigService.get` prefers injected values over `process.env`, so `createApp({ env })` always wins (earlier comments saying the opposite were wrong and are corrected) | Verified in `@nestjs/config` source |

### Coverage of the defects found in the source project (the source-project audit (`docs/_origin/source-project audit.md` section 3))

| # | Defect | Status |
| :-- | :-- | :-- |
| 1 | OTP without attempt limit / reusable `mfa_token` | Fixed: D-404 |
| 2 | MFA step skips lockout / verification | Fixed: D-406 |
| 3 | Non-atomic recovery codes, 8 bcrypt compares | Fixed: atomic redeem, SHA-256 (D-410) |
| 4 | TOTP replay | Fixed: `last_used_step` (D-410) |
| 5 | `/mfa/setup` overwrites active secret | Fixed: pending secret (D-410) |
| 6 | No refresh reuse detection | Fixed: families (D-407) |
| 7 | Stale role/active for 15 min | Fixed: per-request check (D-408) |
| 8 | Session decoupled from tokens | Fixed: `sid` in the token (D-407) |
| 9 | One secret for everything | Fixed: three secrets, audiences (D-409) |
| 10 | Plaintext invite tokens, racy accept, reset keyed by email | Fixed: hashes, atomic claim, FK + latest-wins (D-310, D-411, D-412) |
| 11 | Missing per-endpoint throttles | Fixed: D-414 |
| 12 | Unawaited/swallowed mail, repeated lock mails | Fixed: logged fire-and-forget, notify once (D-406, D-413) |
| 13 | `RolesGuard` fail-open | Fixed in Phase 5: D-503 |
| 14 | Unguarded audit, unaudited failures | Fixed: D-311, D-416 |
| 15 | Lockout DoS | Mitigated: no extension while locked, back-off, notice (D-406) |
| 16 | Tooling (lint --fix, any, jest/ts-jest) | Fixed in Phase 1 |
| 17 | No env validation | Fixed in Phase 1 (+ auth rules) |
| 18 | Inconsistent envelopes | Fixed in Phase 2 |

## Phase 5 implementation decisions

| ID | Topic | Decision | Why |
| :-- | :-- | :-- | :-- |
| D-501 | Resolves D-303 | The role model and hierarchy moved to `src/auth/core/roles.ts` (auth core). `src/rbac/` now holds only the permission matrix, decorators, guard, `GET /rbac/permissions` and the policy-coverage helper. `users` no longer imports `rbac/` except for `@Permissions` decorator lines | A12 #5: the project must build without `rbac/` |
| D-502 | Matrix | `src/rbac/permissions.ts`: `PERMISSION_ROLES` (`users.read/invite/update/activate/deactivate/force_logout`: admin + superadmin; `users.delete`: superadmin only). Typed `Permission` union, `can()`, `permissionsOf()` | Single central matrix (A6) |
| D-503 | Fail-closed guard | `PermissionsGuard` (global, after `JwtAuthGuard`): a route must declare `@Public()`, `@Authenticated()`, `@Roles(...)` or `@Permissions(...)`; otherwise 403 and an error log. No user on a non-public route is 401. A role and a permission requirement must both hold. `@Authenticated()` (marker in `auth/core`) means "any signed-in user" | Finding 3.13 |
| D-504 | CI-time coverage | `findRoutesWithoutPolicy(app)` must be empty (`test/rbac.e2e-spec.ts`), so a forgotten decorator fails the build instead of 403-ing in production | A10 |
| D-505 | Defence in depth | `UsersService` keeps its admin-level gate and the hierarchy/self-protection rules even though the controller now requires permissions. They protect user management if RBAC is removed; the matrix adds finer rules on top. The duplication is deliberate | Removal safety (see how-to) |
| D-506 | Removability proof | `npm run check:rbac-removable` (`scripts/check-rbac-removable.mjs`, run in CI): copies `src/`, deletes `src/rbac/`, strips `@Permissions/@Roles` lines, their imports and `RbacModule`, then runs `tsc`. Decorators must stay single-line for this to work. Steps documented in `docs/how-to/remove-rbac.md` | A6 / A12 #5 |
| D-507 | `GET /rbac/permissions` | Returns the caller role and permissions so a frontend does not duplicate the matrix | Convenience; lives in the removable module |

## Phase 6 implementation decisions

| ID | Topic | Decision | Why |
| :-- | :-- | :-- | :-- |
| D-601 | API | `src/common/query`: `defineQuery<Where, OrderBy, Include>(config)` returns `parse(rawQuery, { scope?, withTrashed? })` and `describe()`. `parse` yields `where`, `orderBy`, `include`, `skip`, `take`, `page`, `page_size`, `args` (ready for `findMany`) and `paginate(rows, total)` (the `{ data, meta }` result). No new dependency | A7 |
| D-602 | Filter types | `exact` (single value; optional `values` whitelist and `cast`: string/number/uuid), `oneOf` (comma list or repeated param; the Blueprint's `in`, renamed because `in` is a keyword), `partial` (case-insensitive contains, `%`/`_`/`\` escaped), `boolean`, `dateRange` (`from,to`, inclusive; bare dates are UTC days; either end may be empty; start <= end), `callback`. Operator-style input such as `filter[name][$ne]=x` is rejected | A7 |
| D-603 | Strictness | Unknown `filter[x]`, `sort` field or `include` name -> 400 with `UNKNOWN_FILTER` / `UNKNOWN_SORT` / `UNKNOWN_INCLUDE` and `errors: [{ field, message }]` listing what is allowed; a bad value -> 400 `INVALID_QUERY`. Whitelist lookups use `hasOwnProperty`, so `constructor`/`__proto__` cannot slip through. Unrelated top-level parameters (cache busters, `utm_*`) are ignored, which also means a typo such as `page_sise` is silently ignored | D-004 / Blueprint A7 |
| D-604 | Limits | `page` >= 1 (integer), `page_size` default 25 and **capped** (not rejected) at 100, `search` <= 100 chars, <= 3 sort keys, <= 50 values per list filter, include depth <= 2 (checked when the definition is created), `skip` must fit Prisma's Int. Per-definition overrides: `defaultPageSize`, `maxPageSize`, `maxIncludeDepth` | A7 |
| D-605 | Prisma pitfalls (the source-project audit (`docs/_origin/source-project audit.md` section 4)) | Everything is combined in one `AND: [...]` list (scope, soft-delete, filters, search), so no condition clobbers another `OR`; soft-deleted rows are hidden by default (`softDelete: true`; opt out with `withTrashed`, or `softDelete: false` for tables without `deleted_at`); every sort ends with a stable `id` tiebreaker (direction of the first key); `$transaction([findMany, count])` is the documented pattern; LIKE wildcards escaped | Findings of the the source project audit |
| D-606 | Scope hook | `parse(raw, { scope })` AND-merges a caller-supplied where: row-level scoping today, the multi-tenancy seam later (A6) | A6 / A7 |
| D-607 | Query parser | `app.set('query parser', 'extended')` in `configureApp`: Express 5 defaults to the flat parser, which would not produce `filter[x]` objects. Consequence: qs limits apply (depth 5, 20 array items, 1000 parameters) | Required by the URL format |
| D-608 | Swagger | `@ApiQueryFrom(definition)` generates `filter[...]`, `sort`, `page`, `page_size`, `search`, `include` from the definition (descriptions, examples, enums, limits) | A7 / A8 |
| D-609 | Users migrated | `GET /users` now uses `userQuery` (`src/users/users.query.ts`): `filter[id|email|name|role|is_active|email_verified|created_between]`, `search` (name/email), `sort` (`name|email|created_at|last_login_at`, default `-created_at`). **Behaviour change vs Phase 3:** flat `?role=`/`?is_active=` and 422 on bad values are gone (400 + `INVALID_QUERY` instead); `ListUsersQueryDto` was deleted. `PaginationQueryDto` stays for hand-written lists | Phase 6 replaces the interim filters |
| D-610 | Not in v1 | Cursor pagination, `fields` selection, filters across relations other than via `callback` | A7 |

## Phase 7 implementation decisions

| ID | Topic | Decision | Why |
| :-- | :-- | :-- | :-- |
| D-701 | Scope of the module | `src/example/`: `GET/POST /example-items`, `GET/PATCH/DELETE /example-items/:id` over the `ExampleItem` model (no relations, so no `include`). Registered in `AppModule`; deleting it plus the model is the documented first step of a real project. `src/example/README.md` is the "add a module" checklist (the `docs/how-to/add-module.md` of Phase 9 will point to it) | A3 / A12 #4 |
| D-702 | Permissions | `example.read` (user, admin, superadmin), `example.create/update/delete` (admin, superadmin). A plain user therefore holds exactly `example.read` | Shows a matrix where every role has something |
| D-703 | Row-level scope | Plain users only see published items. The same `visibleTo(actor)` scope is applied to the list **and** to single-row lookups (`findOrFail`), so a draft cannot be read, updated or deleted by guessing its id, and a hidden row answers 404 like a missing one. This is the reference use of the query builder's `scope` hook | A6 / A7 |
| D-704 | Input hygiene | Create/update DTOs are allow-lists (`id`, `created_by`, `deleted_at`... -> 422); `name` is trimmed; PATCH accepts `description: null` to clear it; responses go through `toExampleItemDto` (no `updated_by`/`deleted_at`) | A8 |
| D-705 | Tests | `example.flow.spec.ts` (27 cases over the real pipeline + in-memory DB: auth, permissions, scope, validation, filters, search, sort, pagination, soft delete, audit), `example.service.spec.ts` (exact Prisma calls), plus a real-PostgreSQL case in `test/database.e2e-spec.ts` (filters, pagination without gaps/overlap, `%`/`_` literal matching, soft delete) that has **not been executed yet** | A12 #4 |
| D-706 | Memory DB fidelity | `test/helpers/memory-prisma.ts` gained `skip`/`take`, an `exampleItem` table and Prisma's rule that `undefined` means "not provided" (it had overwritten defaults with `undefined`; real Prisma ignores them) | Keep the simulation honest |

## Phase 8 implementation decisions

| ID | Topic | Decision | Why |
| :-- | :-- | :-- | :-- |
| D-801 | Dependencies | `nodemailer` (+ `@types/nodemailer`), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `ioredis`, `@nestjs/schedule` **pinned to ^6**. `@nestjs/schedule` 12 (what `npm i` resolves) is ESM-only: it breaks Jest and CommonJS builds, and its peers allow Nest 11 only on paper. The Redis throttler storage is our own ~40 lines (no `@nest-lab/throttler-storage-redis`) | A3 optional modules; keep dependencies few |
| D-802 | Plug-in model | Every optional module is a folder + one line in `AppModule` and connects through a token or a flag; nothing outside imports it. `npm run check:rbac-removable` (CI) deletes each of rbac, mail, storage, redis, jobs alone and then all together on a temporary copy, applies the documented steps, and type-checks (6 scenarios). Runtime consequences of removal are explicit boot errors (e.g. `AUTH_DELIVERY=email` without the mail module), never silent degradation. Guide: `docs/how-to/optional-modules.md` | A3 / A12 #5 |
| D-803 | Mail | `src/mail`: `EMAIL_TRANSPORT` (interface in `src/common/email`) via `MAIL_TRANSPORT=console|smtp`; SMTP has 10 s/20 s timeouts; the console transport prints the body only in development. `AUTH_DELIVERY=email` now covers OTP, verification, reset, lock notice **and invitations** (`EmailInvitationSender`); the "pick the transport or fail at boot" helper moved to `common/email/email-delivery.ts` and is shared by auth and users. Integration tests run the real adapters and only replace the final transport | A5 |
| D-804 | Storage | `src/storage`: `STORAGE` token, `StorageService` (`put/get/exists/delete/signedUrl`, Buffer-based on purpose: big files go through presigned URLs). `LocalStorage` (atomic writes, root-jailed) and `S3Storage` (any S3-compatible service, presigning is offline-testable). Both validate keys with `assertSafeKey` (no `..`, absolute paths, empty segments or odd characters) and reject (never throw synchronously) | A3 |
| D-805 | Redis | `src/redis`: `REDIS_CLIENT` (`null` without `REDIS_URL`) and, when `REDIS_URL` is set (originally also gated by a `THROTTLE_STORAGE` flag, removed in D-904), a shared throttle storage: one atomic Lua script per hit (fixed window, optional block duration, a TTL on every key), wrapped in `FailOpenThrottlerStorage` (Redis errors -> per-instance in-memory counting, warning at most every 30 s, automatic recovery). The client uses `enableOfflineQueue:false`, `maxRetriesPerRequest:1`, capped back-off. No readiness check on purpose. The Lua script runs only against a real Redis in `test/redis.e2e-spec.ts` (**not executed yet**) | Finding 3.11, source-project audit (fail-open throttler) |
| D-806 | Throttle seam | `ThrottleModule` injects an optional `THROTTLER_STORAGE_OVERRIDE` (the boot failure for a missing module was removed in D-904) | Keeps `common/` independent of `redis/` |
| D-807 | Jobs | `src/jobs`: `ScheduleModule` + `CleanupJob` (daily 03:00): deletes expired refresh/reset/OTP tokens, expired unaccepted invitations and sessions revoked longer than `JOBS_RETENTION_DAYS` (30) ago, in one transaction, and audits `system.cleanup`. Gate `ENABLE_CRON=true` (enable on exactly one instance); failures are logged, never crash; `run()` is callable without the schedule | A3 (cron scaffold) |
| D-808 | Env | Added `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_*`, `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `S3_*`, `ENABLE_CRON`, `JOBS_RETENTION_DAYS`; cross-field validation at boot (smtp needs host+from, SMTP credentials as a pair, s3 needs bucket/region/keys, ); `requireEnv()` replaces `as string` assertions | A5 / A10 |
| D-809 | CI | Redis service + `REDIS_URL` for the gated suites; the removability check now covers every optional module | A12 |

## Post-release polish

| ID | Topic | Decision | Why |
| :-- | :-- | :-- | :-- |
| D-901 | Redis is opt-in | `.env.example` ships with `REDIS_URL` commented out; connection errors are logged readably (`describeRedisError` turns an empty `AggregateError` into `ECONNREFUSED`) and say that rate limiting falls back to memory | A fresh project without a running Redis printed a confusing, empty-looking warning on every start |
| D-902 | Swagger UI over http | Outside production the helmet CSP drops `upgrade-insecure-requests`; production keeps helmet's defaults. Covered by a header test for both modes | Safari and Firefox would otherwise request the UI's assets from `https://localhost` and render a blank page |
| D-903 | First prompt | `docs/prompts/first-prompt.md` is the saved first message for a new project: read `CLAUDE.md`, run the setup steps (including removing `docs/_origin`, stopping for `.env`), read the docs, answer with a plan. Local `npm run migrate` / `seed` are allowed; creating migrations, commits and other deletions need approval | One paste gets a pulled project to a verified, running state |
| D-904 | `REDIS_URL` is the only Redis switch | The `THROTTLE_STORAGE` flag is gone: `REDIS_URL` set -> `REDIS_CLIENT` plus the shared fail-open throttle storage; unset -> no client and in-memory limits. Removing `src/redis` just means in-memory limits (no boot error). Covered by tests for: no override (memory), fail-open with Redis down, and a shared storage being used | The source project works this way. The extra flag allowed "URL set but unused" (a confusing warning on every start) and made the optional module harder to remove |
