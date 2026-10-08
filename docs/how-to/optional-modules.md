# Optional modules: enable, configure, remove

Four feature folders are optional (`src/mail`, `src/storage`, `src/redis`, `src/jobs`), plus `src/rbac` (see [remove-rbac.md](remove-rbac.md)). Nothing in the rest of the kit imports them: they plug in through a token or a flag. `npm run check:rbac-removable` (CI) deletes each one alone and then all together, applies the steps below to a temporary copy, and type-checks it, so the removal paths cannot rot.

## Removing any of them

1. Delete the folder (`src/mail/`, ...).
2. In `src/app.module.ts` remove the module's `import` line and its entry in `imports`.
3. Remove or neutralise its settings in `.env` (the schema keeps accepting them; unused ones are harmless).

Then `npm run typecheck && npm test`. What changes in behaviour is listed per module.

## Mail (`src/mail`)

Provides `EMAIL_TRANSPORT` (interface in `src/common/email`). Auth emails (OTP codes, verification, reset, lock notice) and invitations use it when `AUTH_DELIVERY=email`.

| Setting | Meaning |
| :-- | :-- |
| `MAIL_TRANSPORT=console` (default) | Logs `to` and subject; the body (codes, links) only when `NODE_ENV=development` |
| `MAIL_TRANSPORT=smtp` | nodemailer; needs `SMTP_HOST`, `MAIL_FROM`; `SMTP_PORT` (587), `SMTP_SECURE` (true = implicit TLS, usually 465), `SMTP_USER` + `SMTP_PASSWORD` together |
| `AUTH_DELIVERY=email` | Route auth and invitation emails through the transport |

Sending is fire-and-forget: a delivery failure is logged, never shown to the caller (and never reveals whether an account exists).

**Removing it:** `AUTH_DELIVERY=email` then refuses to boot ("requires an EMAIL_TRANSPORT provider"). Either keep `AUTH_DELIVERY=console`, or provide your own provider: `{ provide: EMAIL_TRANSPORT, useClass: MyTransport }` in a global module (any class with `send({ to, subject, text, html? })`: SES, Postmark, ...).

## Storage (`src/storage`)

Inject `@Inject(STORAGE) storage: StorageService` (`put`, `get`, `exists`, `delete`, `signedUrl`). Keys look like `avatars/<user-id>/photo.png`; anything with `..`, absolute paths, empty segments or odd characters is rejected by both drivers.

| Setting | Meaning |
| :-- | :-- |
| `STORAGE_DRIVER=local` (default) | A directory (`STORAGE_LOCAL_DIR`, default `./storage-data`, git-ignored); atomic writes; `signedUrl` returns `null` |
| `STORAGE_DRIVER=s3` | Any S3-compatible service: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, optional `S3_ENDPOINT` (MinIO, Backblaze B2, R2) and `S3_FORCE_PATH_STYLE` |

The API is Buffer-based on purpose. For big files hand the client a presigned URL instead of proxying bytes through the app. **Removing it:** nothing else uses it; just delete the folder (and the `@aws-sdk/*` dependencies if you want them gone).

## Redis (`src/redis`)

Provides `REDIS_CLIENT` (`null` when `REDIS_URL` is unset, so injecting it is always safe) and, with `THROTTLE_STORAGE=redis`, a shared throttle storage for rate limiting across instances.

- The storage **fails open**: if Redis errors, requests are counted per instance in memory (the API stays up, limits degrade), a warning is logged at most every 30 s, and it recovers by itself.
- The client never queues commands while disconnected and reconnects with a capped back-off.
- Counters are a fixed window, updated by one atomic Lua script (checked against a real Redis in `test/redis.e2e-spec.ts`).
- No readiness check on purpose: Redis being down must not take instances out of the load balancer.

**Removing it** while `THROTTLE_STORAGE=redis` fails at boot ("requires the redis module"); set `THROTTLE_STORAGE=memory`.

## Jobs (`src/jobs`)

`@nestjs/schedule` scaffold with one real job, `CleanupJob` (daily 03:00): deletes expired refresh/reset/OTP tokens, expired unaccepted invitations and long-revoked sessions older than `JOBS_RETENTION_DAYS` (30), and writes a `system.cleanup` audit entry.

- Gate: jobs only run when `ENABLE_CRON=true`. **Enable it on exactly one instance** (a dedicated worker, or one replica); otherwise every replica repeats the work.
- Add a job: copy `cleanup.job.ts`, change the `@Cron(...)` expression, list it in `JobsModule`. Keep the body in a public `run()` so tests and scripts can call it without the schedule.
- A failing run is logged and never crashes the process; the next run retries.
- `@nestjs/schedule` is pinned to the 6.x line: version 12 is ESM-only and breaks Jest (and CommonJS builds on older Node).

**Removing it:** nothing else depends on it; expired rows then simply accumulate until you add your own cleanup.
