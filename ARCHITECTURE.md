# Architecture

How the kit is put together, and why. For setup see [README.md](README.md); for the reason behind individual choices see [docs/DECISIONS.md](docs/DECISIONS.md).

## 1. Goals and boundaries

A **domain-agnostic** backend base. In scope: HTTP API, configuration, auth, users, permissions, auditing, a query layer, API documentation, operational basics. Out of scope by design: business modules, vendor integrations, a frontend, multi-tenancy in the base schema (a documented extension, see [how-to](docs/how-to/enable-multitenancy.md)).

Guiding rules: boring and explicit over clever; every convention is machine-checked (lint, tests, CI) rather than remembered; optional features are folders you can delete; security defaults are on and the flags only relax them deliberately.

## 2. Module map

```
                    ┌───────────────────────── AppModule ─────────────────────────┐
 foundation         │ Config · Logger · Common (filter, envelope) · Health · Prisma · Audit │
                    └───────────────────────────────┬──────────────────────────────┘
 request pipeline        Throttle ──► Auth (JWT guard) ──► Rbac (permission guard)
 features                          Users · Example (your modules go here)
 optional plug-ins        Mail · Storage · Redis · Jobs · Rbac     (delete the folder, remove one line)
```

Dependency rules:

- `common/` and `config/` depend on nothing in the feature folders.
- Features depend on `common/`, `config/`, `prisma/`, `audit/`, `auth/core`. They never import optional modules; they talk to them through an interface and a token that lives in `common/` (`EMAIL_TRANSPORT`, `THROTTLER_STORAGE_OVERRIDE`) or through a flag.
- The role model and hierarchy live in `auth/core/roles.ts`, not in `rbac/`, so auth and user management compile without RBAC.
- `npm run check:rbac-removable` enforces all of this by deleting each optional module (and all of them together) from a copy and type-checking.

## 3. Request lifecycle

`src/app.setup.ts` (`configureApp`) is the single place that configures the HTTP app; `main.ts` and every end-to-end test call it, so tests exercise the real pipeline.

1. **Express level, in order**: logger takeover → `trust proxy` → extended query parser (so `filter[x]=y` becomes an object) → **request-id middleware** (accepts a safe `X-Request-ID` or generates one, stores it in `AsyncLocalStorage`, logs one line per finished request without the query string) → **helmet** → **CORS** (explicit allow-list; empty means no CORS headers; `*` is rejected) → global **validation pipe** → Swagger (+ optional basic auth) → shutdown hooks.
2. **Global guards**, in this order: `ThrottlerGuard` (rate limit, applies to anonymous traffic too) → `JwtAuthGuard` (Bearer token; `@Public()` opts out) → `PermissionsGuard` (fail-closed: the route must declare `@Public`, `@Authenticated`, `@Permissions` or `@Roles`).
3. **Interceptors**: `EnvelopeInterceptor` (global, outermost) wraps results as `{ data }` / `{ data, meta }`; route-level `AuditInterceptor` records `@Audited` actions after success.
4. **Pipes**: the validation pipe turns DTOs into validated instances (whitelist + reject unknown fields, 422 with per-field errors); `ParseUUIDPipe` on id params.
5. **Handler** → service → Prisma.
6. **Errors**: everything is caught by `AllExceptionsFilter` and rendered as `{ message, error_code, timestamp, request_id, errors? }`. Expected failures are `AppException(ErrorCode, ...)`; unknown errors become a generic 500 whose details only reach the logs and the `ErrorReporter` seam.

Probe routes (`/healthz`, `/readyz`) are `@Public`, `@SkipThrottle`, `@SkipEnvelope` and answer with plain bodies.

## 4. Response contract

| Case | Shape |
| :-- | :-- |
| Single resource | `{ "data": { ... } }` |
| List | `{ "data": [ ... ], "meta": { "current_page", "page_size", "total", "last_page" } }` |
| No content | `204`, empty body |
| Error | `{ "message", "error_code", "timestamp", "request_id", "errors"?: [{ "field", "message" }] }` |

Status codes: validation 422 (`VALIDATION_ERROR`), bad query parameters 400 (`INVALID_QUERY`, `UNKNOWN_FILTER|SORT|INCLUDE`), unauthenticated 401, forbidden 403, missing 404, conflict 409, rate limit 429 (`RATE_LIMITED` plus `Retry-After`). All codes are the `ErrorCode` enum.

## 5. Authentication

### The login state machine

```
 POST /auth/login ──► credentials ok? ──no──► 401 INVALID_CREDENTIALS (same for unknown / locked)
        │ (email only, AUTH_METHODS=password,otp)
        ├──────────────► status: otp_required ──► POST /auth/login/otp ──┐
        ▼                                                                 ▼
   password ok ───────────────────────────────────────────► second factor needed?
                                                              │ no            │ yes (AUTH_MFA)
                                                              ▼               ▼
                                                     status: authenticated   status: mfa_required
                                                     (access + refresh)      └─► POST /auth/mfa/verify ─► authenticated
```

Every response is one `LoginResponseDto`: `status`, `next_step`, and `challenge_token` / `mfa_method` / tokens. A frontend only switches on `status`, whatever the flags are.

| Flag | Effect |
| :-- | :-- |
| `AUTH_METHODS=password` / `password,otp` | Adds passwordless email-code login as an alternative first step |
| `AUTH_MFA=none` / `totp` / `otp` | Second factor: nothing / authenticator app (+ recovery codes) / emailed code. An emailed-code login already proved the mailbox, so the email second factor is skipped after it |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Block login until the address is verified (invited users and reset links verify implicitly) |
| `AUTH_ALLOW_REGISTRATION` | Open `POST /auth/register`; default is invite-only |
| `AUTH_VERIFY_USER_PER_REQUEST` | Re-read session and user on every request (see below) |
| `AUTH_DELIVERY=console\|email` | How codes and links are delivered |

Flags change the **flow**, never the schema: the OTP and MFA tables always exist. Contradictory combinations fail at boot.

### Tokens

| Token | Form | Lifetime (default) | Secret / audience |
| :-- | :-- | :-- | :-- |
| Access | JWT HS256 (`sub`, `sid`, `ver`, `role`, `email`) | 15 min | `AUTH_ACCESS_SECRET` / `access` |
| Refresh | Opaque 256-bit, only its SHA-256 stored, single use, rotated within a family | 7 days | none |
| Challenge | JWT; its `jti` is the `OtpToken` row (single use, attempt limited) | 5 min | `AUTH_MFA_CHALLENGE_SECRET` / `login-challenge` |
| Email verification | JWT | 24 h | `AUTH_EMAIL_VERIFY_SECRET` / `email-verify` |
| Invitation, password reset | Opaque, hashed at rest, single use | 72 h / 1 h | none |

The three secrets must differ; `HS256` is pinned and audiences are checked.

### Sessions and revocation

A login creates a session; the access token carries its id (`sid`), never a client-supplied value. With `AUTH_VERIFY_USER_PER_REQUEST=true` (default) `JwtAuthGuard` loads the session and the user on every request (2 queries): a revoked session, a deactivated or deleted user, or a stale `token_version` is rejected **immediately**, and the **role comes from the database**, not the token. Deactivate, force-logout, delete, role change, password reset and password change revoke sessions and bump `token_version`. With the flag off the token is trusted until it expires (cheaper; logout then no longer kills the live access token).

Presenting an already-used refresh token means it leaked: the whole family and its session are revoked (and the event is audited). Two truly simultaneous refreshes of the same token end the session too: there is no grace window.

### What an attacker does not learn

Unknown address, wrong password and a locked account all answer `401 INVALID_CREDENTIALS`; passwordless login returns a decoy challenge for addresses that cannot sign in; forgot-password, resend-verification and register always answer `202`. Reasons such as "disabled" or "unverified" are revealed only after the password is proven.

## 6. Authorization

- **Roles**: `superadmin > admin > user` (Prisma enum `Role`; levels in `auth/core/roles.ts`). Hierarchy rule, implemented once and used by user management: you may act only on someone strictly below your own role, never on yourself, and you may only assign roles below yours.
- **Permissions**: one matrix, `PERMISSION_ROLES` in `src/rbac/permissions.ts`; routes say `@Permissions('users.read')`. `GET /rbac/permissions` exposes the caller's list to frontends.
- **Fail-closed**: a non-public route with no declared policy is denied and logged; a CI test also lists such routes.
- **Row-level**: handled in services with a query-builder `scope` (the example module hides unpublished items from plain users in lists *and* single lookups; a hidden row answers 404).
- `UsersService` keeps an admin-level gate and the hierarchy rules even though the controller is permission-guarded, so user management stays restricted if RBAC is removed.

## 7. Data model

| Table | Purpose |
| :-- | :-- |
| `users` | Account, role, flags (`is_active`, `mfa_enabled`), lockout (`failed_login_attempts`, `locked_until`), `token_version`, audit fields, soft delete |
| `user_sessions`, `refresh_tokens` | Sessions and the refresh-token families that belong to them |
| `otp_tokens` | Login challenges: emailed codes (hashed) and TOTP challenges, with attempts and expiry |
| `mfa_secrets`, `mfa_recovery_codes` | Encrypted TOTP secret (+ pending secret during enrolment, + last used step), hashed recovery codes |
| `password_reset_tokens`, `user_invitations` | Hashed one-time tokens |
| `audit_logs` | Who did what: actor, action, entity, request id, IP, user agent, small metadata |
| `example_items` | The reference entity |

Conventions: `snake_case`, UUID ids, `deleted_at` soft delete through `notDeleted` / `softDeleteData`, no `tenant_id`. Migrations are committed and never edited after merge.

## 8. The query layer

`defineQuery` (in `src/common/query`) is one definition per entity: whitelisted filters (`exact`, `oneOf`, `partial`, `boolean`, `dateRange`, `callback`), sort fields, include names, search columns, paging limits. `parse(rawQuery, { scope, withTrashed })` returns Prisma arguments plus a `paginate()` helper. Guarantees: unknown parameters are 400; everything is combined with `AND`; soft-deleted rows are hidden by default; `page_size` is capped; a stable `id` tiebreaker ends every sort; LIKE wildcards in user input are escaped; the same definition generates the Swagger parameters (`@ApiQueryFrom`).

## 9. Configuration and operations

- **Config**: `src/config/env.schema.ts` (zod) is the only reader of the environment. Cross-field rules (for example "TOTP needs an encryption key", "OTP in production needs email delivery") run at boot.
- **Logging**: one JSON line per entry in production (`pretty` in development) with `request_id`; request logs omit query strings; secrets are never logged outside `NODE_ENV=development` console adapters.
- **Health**: liveness `/healthz`; readiness `/readyz` aggregates registered checks (the database) and turns 503 as soon as shutdown starts.
- **Shutdown**: SIGTERM/SIGINT → readiness 503 → drain → exit; `SHUTDOWN_TIMEOUT_MS` watchdog.
- **Database**: Prisma connects lazily, so the process boots and serves `/healthz` while the database is down; migrations run as a separate release step.
- **Audit**: `@Audited('x.y', 'entity')` after success; `AuditService.record()` is fire-and-forget and can never fail a request.

## 10. Optional modules

| Folder | Provides | Connects through | If deleted |
| :-- | :-- | :-- | :-- |
| `rbac` | Permission matrix, guard, `GET /rbac/permissions` | Decorator lines on routes | Any signed-in user passes route checks; user management keeps its own gate |
| `mail` | `EMAIL_TRANSPORT` (console / SMTP) | Token | `AUTH_DELIVERY=email` refuses to boot |
| `storage` | `STORAGE` (local / S3) | Token | Nothing else uses it |
| `redis` | `REDIS_CLIENT`, shared fail-open throttle storage | Token + `THROTTLE_STORAGE` | `THROTTLE_STORAGE=redis` refuses to boot |
| `jobs` | Cron scaffold + token cleanup job | None | Expired rows accumulate |

See [docs/how-to/optional-modules.md](docs/how-to/optional-modules.md).

## 11. Testing strategy

| Layer | Where | What it proves |
| :-- | :-- | :-- |
| Unit | `src/**/*.spec.ts` | Pure logic: query builder, TOTP (RFC 6238 vectors), crypto, guards, filters, adapters |
| Integration ("flow") | `src/**/*-flow.spec.ts`, `example.flow.spec.ts` | The real Nest app (guards, pipes, filter, envelope, audit) over an **in-memory Prisma stand-in**: every login flag combination, lockout, replay, reuse detection, invitation races, RBAC, the example module |
| E2E | `test/*.e2e-spec.ts` | Bootstrap, headers, error contract, Swagger coverage (every route documented, approved public routes, access policy on every route), RBAC |
| Real services | `test/database.e2e-spec.ts`, `test/redis.e2e-spec.ts` | The same behaviours on PostgreSQL and the Redis Lua script. They run only with `RUN_DB_TESTS=true` (CI provides the services) |
| Structural | `npm run check:rbac-removable` | Each optional module can be deleted without breaking the build |

The in-memory database is a simulation (atomic `updateMany`, uniqueness, `increment`, rollback); anything that depends on real SQL behaviour belongs in the real-service suites. Coverage gate: 80% (statements, branches, functions, lines).

## 12. Known limits (by design, for v1)

- Single-tenant (documented extension, not built). Fixed roles (DB-managed roles are documented, not built).
- No cursor pagination, no `fields` selection, no filters across relations except through `callback`.
- No admin endpoint to reset another user's MFA (a locked-out user with no recovery codes needs a database intervention or a project-specific endpoint).
- OAuth / SSO / passkeys are not included; the login state machine is the extension point.
- The Redis throttle counter is a fixed window; the in-memory fallback is per instance.
- File handling is a storage seam only; there are no upload endpoints.
