# Changelog

All notable changes to this kit are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/). Projects created from the template should read the **Upgrade notes** of every release between their base and the target version ([docs/how-to/upgrade.md](docs/how-to/upgrade.md)).

## [Unreleased] - towards 1.0.0

Not tagged yet: the final verification against real PostgreSQL, Redis and Docker is still to be done and recorded here.

### Added

- **Foundation**: NestJS 11 + strict TypeScript + Prisma 5 + PostgreSQL; typed, zod-validated configuration that fails at boot; structured JSON logging with request ids; `/healthz` and `/readyz`; graceful shutdown; helmet, CORS allow-list, rate limiting; Dockerfile (non-root, health check, `migrator` target) and `docker-compose.yml` (PostgreSQL + Redis); GitHub Actions CI; ESLint (flat config), Prettier, Husky + lint-staged.
- **API conventions**: `{ data }` / `{ data, meta }` envelopes, one error shape with stable `ErrorCode`s (`AppException`), 422 validation errors with per-field details, Swagger at `/docs` with realistic examples, composite documentation decorators, operation ids, optional basic auth, and tests that fail when a route is undocumented or has no access policy.
- **Authentication**: login state machine (`authenticated` / `otp_required` / `mfa_required`), passwordless email-code login (`AUTH_METHODS=password,otp`), TOTP and email second factors (`AUTH_MFA`), recovery codes, rotating refresh tokens with reuse detection, sessions bound to tokens, per-request user verification, lockout with back-off, invitations, email verification, password reset and change, optional self-registration, per-endpoint rate limits, no account enumeration.
- **Authorization**: role hierarchy, central permission matrix, fail-closed `PermissionsGuard`, `GET /rbac/permissions`.
- **Users and audit**: user management with invitations, activate / deactivate / force-logout / soft delete; audit log with `@Audited`.
- **Query builder** (`src/common/query`): `filter[...]`, `search`, `sort`, `include`, pagination with a hard cap, whitelist enforcement, soft-delete awareness, row-level `scope`, Swagger generation from the same definition.
- **Optional modules**: mail (console / SMTP), storage (local / S3), Redis (shared, fail-open rate limiting), jobs (cron scaffold + token cleanup), RBAC; each deletable, verified by `npm run check:rbac-removable`.
- **`src/example`**: a complete reference module with a copy-me checklist.
- **Documentation**: README, ARCHITECTURE, `docs/DECISIONS.md`, and how-to guides (use as template, add a module, OTP, MFA, error codes, optional modules, remove RBAC, multi-tenancy, dynamic roles, upgrade).

### Upgrade notes

First release: nothing to upgrade from.

When this section changes in a future release it will list, per version: renamed or removed environment variables, changed response shapes, new required migrations (and whether they rewrite data), and dependency pins that moved.
