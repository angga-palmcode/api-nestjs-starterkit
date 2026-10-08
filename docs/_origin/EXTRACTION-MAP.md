# Extraction Map (Phase 0)

> Read-only audit of `astos-be` (NestJS 11 / Prisma 5) and Tiny Parrot's Spatie query builders.
> Classes: **CORE** (copy + generalise) · **OPTIONAL** (deletable / flag) · **EXCLUDE** · **REFACTOR** (extract only after cutting couplings).
> Spec: `docs/non-living/shared/NEST-STARTER-KIT-BLUEPRINT.md` (Part A).

## 1. File / module classification

### Bootstrap, config, common

| Astos path | Class | Notes / couplings to cut |
| :-- | :-- | :-- |
| `src/main.ts` (737 lines) | REFACTOR | ~90 lines generic (trust proxy, helmet, CORS allow-list, validation pipe, Swagger gated off in prod, listen). Rest is AdminJS (`unflattenJsonField`, `/admin` helmet bypass, `express-session`, `PrismaClient` for AdminJS) and an `X-Org-ID` header injected into every Swagger operation. |
| `src/app.module.ts` | REFACTOR | Keep wiring pattern: `ConfigModule`, `ScheduleModule`, `RedisModule`, `ThrottlerModule`, `PrismaModule`, `APP_FILTER`, `APP_GUARD`. Drop ~30 domain modules, NestLens, tasks, `UserLocaleResolver`. |
| `src/config/app.config.ts` | REFACTOR | Drop `elCreditAllotment` (ElevenLabs). |
| `src/config/auth.config.ts` | REFACTOR | TTLs hard-coded (`15m`, `7d`) → env. |
| `src/config/ai-provider.config.ts` | EXCLUDE | |
| `src/config/hydrate-secrets.ts` | OPTIONAL | Cloud Run secret-blob shim; deployment-specific. |
| `src/common/filters/http-exception.filter.ts` | REFACTOR | Keep the shape. Cut Rollbar (→ `ErrorReporter` interface), hard-coded `'sv'` default, `/healthz` special-casing, i18n coupling (make optional). |
| `src/common/throttler/fail-open-throttler.storage.ts` | CORE | Redis storage with in-memory fallback. |
| `src/common/redis/redis.module.ts` | CORE | `REDIS_CLIENT` is `null` when `REDIS_URL` unset. |
| `src/common/rollbar/*` | OPTIONAL | Telephony scrub fields; becomes an `ErrorReporter` adapter at most. |
| `src/common/resolvers/x-locale.resolver.ts` | REFACTOR | Only if i18n is enabled; locales hard-coded `sv/en`. |
| `src/common/resolvers/user-locale.resolver.ts` | EXCLUDE | Coupled to user entity. |
| `src/common/tasks/*` | EXCLUDE | Domain tables. Keep the `ENABLE_CRON` gate pattern. |
| `src/common/utils/timing-safe-equal.util.ts` | CORE | |
| `src/common/utils/ssrf-guard.ts` | OPTIONAL | Only for outbound fetch. |
| `src/common/utils/org-scope.ts`, `dto/business-address.dto.ts`, `constants/dynamic-variables.ts` | EXCLUDE | |
| `src/prisma/*` | CORE | Remove stray `dotenv.config()`. |
| `src/health/health.controller.ts` | REFACTOR | Keep `/healthz` + `/readyz` (DB ping, 503). Cut `/healthz/config`. |
| `src/i18n/*` | OPTIONAL | Keep only `errors` + `validation` bundles if i18n is on. |
| `src/mail/*` | OPTIONAL | Keep thin nodemailer transport + null/console fallback; cut Astos templates, logo, defaults. |
| `src/storage/*` | OPTIONAL | S3 client; rename `B2_*` → `S3_*`; cut recording-URL logic. |
| `prisma/seed.ts` (1028 lines) | REFACTOR | Keep skeleton + `SEED_*` env gate; password from env. |

### Auth / users / audit

| Astos path | Class | Notes |
| :-- | :-- | :-- |
| `src/auth/auth.service.ts` | REFACTOR | Core flows are good; remove `org.mfa_enforced`, `org.locale`, `register` (creates org), `getInvitation.organization_name`, `getMe` phone-number include, issuer `'Astos'`, hard-coded superadmin/admin in `deactivateMe`, `orgId` threading. |
| `src/auth/auth.controller.ts` | REFACTOR | Same endpoints, regrouped by strategy; add per-endpoint throttles missing in Astos (forgot-password, resend-verification, accept-invite, reset-password). |
| `src/auth/strategies/*`, `guards/jwt-auth.guard.ts`, `local-auth.guard.ts` | CORE | Keep `LocalAuthGuard` rethrow of specific exceptions; JWT `algorithms:['HS256']` + `aud` check. |
| `src/auth/guards/roles.guard.ts`, `decorators/roles.decorator.ts`, `permissions.ts` | REFACTOR → `rbac/` | Role union hard-coded in 5 places → single source. Make guard **fail-closed**. |
| `src/auth/guards/org-context.guard.ts`, `optional-org-context.guard.ts`, `decorators/optional-org.decorator.ts`, `skip-org-context.decorator.ts` | EXCLUDE | Tenant-specific (`X-Org-ID`). |
| `src/auth/guards/super-admin.guard.ts` | REFACTOR | Becomes a permission check. |
| `src/auth/decorators/{current-user,public,match}.decorator.ts` | CORE | Remove `orgId`/role union from `AuthenticatedUser`. |
| `src/auth/dto/*` | REFACTOR | Drop `register.dto` (org/industry); examples `@astos.ai` → `example.com`. |
| `src/users/users.service.ts` | REFACTOR | Keep list/invite/role/deactivate/activate/force-logout + `assertCanActOnRole`. Cut `ASTOS_INTERNAL_ROLES`, `is_system` lookup, `system_side`, cross-org select, `ALLOWED_INVITE_ROLES` duplicate of hierarchy. |
| `src/users/*` controller/DTOs | REFACTOR | Roles from the single rbac source. |
| `src/audit/*` | REFACTOR | Make `org_id` optional; add interceptor + fire-and-forget safe logging. |
| `prisma/schema.prisma` | REFACTOR | Keep `User`, `RefreshToken`, `UserSession`, `UserInvitation`, `MfaEmailToken`, `PasswordResetToken`, `AuditLog`. Remove `Organization` + ~35 domain back-relations. |

### Tooling

| Item | Class | Notes |
| :-- | :-- | :-- |
| `eslint.config.mjs` (flat, `recommendedTypeChecked`), `.prettierrc`, `nest-cli.json`, `tsconfig*.json`, `test/jest-e2e.json` | CORE | Add `lint:check` (Astos `lint` uses `--fix`). Enable `strict`. Align jest 30 with a compatible ts-jest. |
| `Dockerfile` (2-stage node:22-alpine, non-root) | CORE | Keep. |
| `package.json` | REFACTOR | Drop `adminjs*`, `nestlens`, `rollbar`, `pdfkit`, `csv-parse`; keep what auth/mail need. |
| CI (`.github/workflows`, Cloud Build, Taskfile) | EXCLUDE | Astos has **no backend CI**; kit CI is new. |

### Query builder

| Source | Class | Notes |
| :-- | :-- | :-- |
| Tiny Parrot `Builder.php` + concrete builders | CONCEPT | Per-entity whitelist class; unknown filter/sort/include → 400; `?search` multi-column OR; default sort; scoping helpers (`forMyBusiness`). Pitfall: whitelist, validation and OpenAPI were three copies → kit derives all from one definition. |
| Astos hand-written listing in ~12 services | REPLACE | Duplicated: page math, `sort=-x` parsing (unknown silently ignored), `OR contains insensitive` search (23 places), comma-enum filters, `date_from/date_to`, per-endpoint `ListXDto`. |

## 2. Astos couplings that must be cut (checklist)

- `User.org_id` / `Organization` (≈20 Astos fields + back-relations), `UserInvitation.org_id`, `AuditLog.org_id`
- Role union typed in 5 places; Astos roles `client`, `client_admin`, `customer_success`
- Org-context guards/decorators, `org-scope.ts`, `X-Org-ID` header in Swagger
- AdminJS (≈650 lines of `main.ts`), `express-session`, NestLens, Rollbar, `hydrate-secrets`
- ElevenLabs/AI-service config, Telnyx/Twilio, B2-specific storage
- i18n tied to user/org locale, default `'sv'`
- Mail templates/branding, TOTP issuer `'Astos'`, `@astos.ai` examples
- `MFA_DISABLED` / `MFA_TOTP_ENABLED` read via raw `process.env` (replace with validated `AUTH_*` config)

## 3. Do NOT copy (defects found in Astos)

Ordered by severity; each becomes a requirement in the kit.

1. **Email OTP has no attempt limit; `mfa_token` is reusable for 5 min.** → attempt counter, invalidate on N failures, single-use challenge.
2. **MFA step 2 skips lockout and `email_verified` checks.** → shared `assertLoginAllowed(user)`.
3. **Recovery-code redemption is non-atomic and doesn't check `mfa_enabled`; up to 8 bcrypt compares/request.** → atomic consume (transaction/CAS), cheaper hashing (SHA-256 of high-entropy codes is fine).
4. **TOTP replay within window.** → store last accepted time-step.
5. **`/mfa/setup` overwrites secret + recovery codes on repeat call before confirm.** → reject if already enabled; separate "pending" secret.
6. **Refresh rotation has no reuse detection / token family.** → family id, revoke family on reuse; claim+lookup in one transaction.
7. **JWT carries role for 15 min; deactivation/role change not enforced until expiry.** → keep short TTL and add a lightweight per-request check (`is_active`, `token_version`/role) behind a flag.
8. **`UserSession` is decoupled from tokens** (`X-Session-ID` client-supplied, never updated, deleting a session doesn't log out). → bind session ↔ refresh token; derive session id from the token, not a header.
9. **Same secret signs access and MFA tokens; refresh secret demanded but unused; email-verify HMAC reuses JWT secret.** → separate secrets/audiences (`ACCESS`, `MFA_CHALLENGE`, `EMAIL_VERIFY`), drop unused ones; verification links expire.
10. **Invite tokens stored in plaintext; accept-invite not race-safe; `PasswordResetToken` keyed by email with no FK/ordering.** → hash tokens, transactional accept, FK + latest-wins.
11. **Missing per-endpoint throttles** on forgot-password, resend-verification, accept-invite, reset-password. → add.
12. **Mail sends not awaited, errors swallowed; lock email sent on every lock.** → explicit fire-and-forget with logging; dedupe.
13. **`RolesGuard` fail-open when no `@Roles` metadata.** → fail-closed; routes opt out with `@Public()`.
14. **Audit insert awaited and unguarded; failed logins/lockouts/refresh not audited.** → safe logger + audit those events.
15. **Account lockout enables targeted lock-out DoS.** → keep, but progressive back-off + notify once.
16. Tooling: `lint` uses `--fix`; `noImplicitAny:false`; jest 30 + ts-jest 29; auth-specific `transformIgnorePatterns`.
17. Env: no central validation; scattered `process.env`. → zod schema + lint ban.
18. Success responses are **not enveloped**; paginated shape differs across services (see §4).

## 4. Query-builder/response decisions that deviate from the Blueprint

| Topic | Blueprint (A7/A9) | Astos reality | Proposal |
| :-- | :-- | :-- | :-- |
| Pagination params | `page`, `limit` | `page`, `page_size` | **`page`, `page_size`** (Astos-compatible), default 25, max 100 |
| Pagination meta | `page, limit, total, total_pages` | `current_page, page_size, total, last_page` | **Astos shape**; `last_page ≥ 1` |
| Filter syntax | `filter[x]` | flat params (`status`, `role`, `is_active`) | **`filter[x]`** (explicit, no param-name clashes); document mapping for FE migration |
| Unknown sort/filter | 400 | silently ignored | **400** with error code |
| Success envelope | `{ data, meta }` for all | none; only lists use `{data, meta}` | see Q2 |
| Error shape | `error.code` nested | flat `{message, error_code, timestamp, trace_id, errors?}` | keep **Astos flat shape**, add `request_id` correlation; fix blueprint A9 wording |
| Validation status | 400 | 422 | **422** `VALIDATION_ERROR` (Astos) |
| Prisma pitfalls to handle | — | `deleted_at: null` added by hand; `OR` clobbering; `count` + `findMany` non-atomic; `%`/`_` not escaped in `contains`; no stable tiebreaker | default soft-delete filter (opt-out `withTrashed`), combine via `AND`, `$transaction` for count+rows, escape wildcard chars, append `id` tiebreaker, multi-key sort |

## 5. Proposed answers to Blueprint A13

| # | Question | Proposal |
| :-- | :-- | :-- |
| 1 | Role model | **Enum + central matrix**, single source (`rbac/roles.ts` + `permissions.ts`), hierarchy helper reused by invite/role-change/deactivate. Dynamic DB roles documented only. |
| 2 | Field naming | **`snake_case`** (matches Astos DB/API; FE already used to it). |
| 3 | i18n | **Off by default**, pluggable; exception filter works without it. |
| 4 | Repo name | `Palm-Code/nest-starter-kit` (private, GitHub template). Local folder is `starterkit-nestjs`; confirm. |
| 5 | Astos migrates to kit? | **Not planned**; kit follows Astos conventions so a later migration is feasible, but no refactor of Astos is assumed. |

## 6. Open questions for review (answers needed before Phase 1)

1. **Query/pagination convention**: OK to follow Astos wire format (`page`, `page_size`, `meta.current_page/last_page`) and add `filter[x]`? (§4)
2. **Success envelope**: Astos returns raw bodies (only lists use `{data, meta}`). For the kit, choose:
   (a) **`{ data }` wrapper on every success** (uniform, Swagger-friendly, but differs from Astos), or
   (b) keep Astos style: raw object for single resources, `{ data, meta }` for lists. *(my recommendation is (a) for a new project; (b) if you want FE parity with Astos)*
3. **Default roles**: `SUPER_ADMIN / ADMIN / USER` as in the Blueprint, or reuse Astos-like names (`superadmin / admin / user`) in lower-case to keep Astos code portable? *(recommend lower-case `superadmin | admin | user`, consistent with snake_case)*
4. **Email verification** on signup: include (Astos requires it for login) or leave as a flag `AUTH_REQUIRE_EMAIL_VERIFICATION` (default true)?
5. **Self-registration**: Astos removed `/auth/register` (invite-only). Kit default: invite-only, with open registration behind a flag?
6. **Hardening scope (§3 #7)**: per-request user check (`is_active`/role) by default, or only a documented option?
7. Confirm A13 proposals in §5.

Phase 1 starts after your answers.
