# Progress

| Phase | Status | Notes |
| :-- | :-- | :-- |
| 0 Audit | Done | `docs/EXTRACTION-MAP.md`; review answers received 2026-10-08 |
| 1 Skeleton & tooling | Done (approved) | build, lint:check, format:check, typecheck, unit (33) + coverage, e2e (7) green. Not verified: Docker image build (daemon off), real SIGTERM on Windows |
| 2 Common layer | Done (approved) | envelope, errors, filter, validation pipe, pagination types, Swagger (+ enforcement test). 91 unit + 22 e2e tests green |
| 3 Prisma + Users + Audit | Done (approved; DB-backed checks still pending, see below) | 153 unit + 36 e2e green (Prisma mocked). **Not executed:** migration against a database, `test/database.e2e-spec.ts`, seed against a database, Docker build. Commands: `docker compose up -d && npm run migrate && npm run seed`, then `RUN_DB_TESTS=true npm run test:e2e` |
| 4 Auth | Done (approved) | 265 unit/integration tests (in-memory DB) + 39 e2e green; all 6 `AUTH_METHODS` x `AUTH_MFA` combinations covered. **Not executed:** anything against real PostgreSQL (`test/database.e2e-spec.ts` now also covers login, refresh reuse), Docker build |
| 5 RBAC | Done (approved) | 278 unit/integration + 43 e2e green; `npm run check:rbac-removable` passes (build without `src/rbac/`). Still not run against real PostgreSQL |
| 6 Query builder | Done (approved) | 54 builder tests (written first) + Users migrated; 333 unit/integration + 49 e2e green. Not run against real PostgreSQL (wildcard escaping, `$transaction` pagination, ordering) |
| 7 Example module | Done (approved) | 368 unit/integration + 49 e2e green; `check:rbac-removable` still passes. The real-PostgreSQL cases (including this module) are still unrun |
| 8 Optional modules & throttling | Done (approved) | 453 unit/integration + 49 e2e green; `check:rbac-removable` passes all 6 scenarios. Unrun against real services: PostgreSQL suites, `test/redis.e2e-spec.ts` (the Lua script), an actual SMTP server / S3 bucket |
| 9 Documentation | Done, awaiting OK | README, ARCHITECTURE, CHANGELOG, 9 how-to guides, CLAUDE.md rewritten for kit users, provenance moved to docs/_origin so the rest of the repo no longer names the source project |
| 10 Verification | Not started | |

## Open questions
- Phase 3 handoff: apply the migration yourself (`npm run migrate`) and run the DB-backed suite; report any failure (notably the `%` search test and the migration SQL).
- Phase 4 notes: D-402 (how `AUTH_METHODS=password,otp` is interpreted) and D-408 (2 queries per request when per-request verification is on) are the decisions most worth a second look.
- D-303 is resolved (D-501).
