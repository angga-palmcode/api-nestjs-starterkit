# Upgrade a project to a newer kit version

A project created from this template (see [use-as-template.md](use-as-template.md)) is a **copy**, not a dependency: nothing updates itself. To pick up fixes and features from a newer kit release you merge them in, and `CHANGELOG.md` tells you what to expect.

## 1. Know what you own

| Kit-owned (change rarely, merge easily) | Project-owned (yours) |
| :-- | :-- |
| `src/common/**`, `src/config/**`, `src/prisma/**`, `src/audit/**`, `src/health/**` | Your feature modules (copies of `src/example`) and their tests |
| `src/auth/**`, `src/users/**`, `src/rbac/**` | Rows you add to `PERMISSION_ROLES`, new `ErrorCode`s, new env variables |
| `src/mail`, `src/storage`, `src/redis`, `src/jobs` (the ones you kept) | New models and migrations in `prisma/` |
| `test/helpers/**`, `scripts/**`, `.github/**`, `eslint.config.mjs`, `tsconfig*.json`, `Dockerfile` | Seed accounts, `.env`, `package.json` name and your own dependencies |

The fewer kit-owned files you edit, the cheaper every upgrade. Extend through the seams (new modules, the permission matrix, `ErrorCode`, `EMAIL_TRANSPORT`, `STORAGE`, `scope`) rather than editing kit code. When you must edit it, keep the change small and note it in your own `docs/`.

## 2. Merge a release

```bash
git remote add kit https://github.com/<org>/nest-starter-kit.git     # once
git fetch kit --tags
git log --oneline <your-base-tag>..<new-tag> -- .                    # what changed
git diff <your-base-tag> <new-tag> -- CHANGELOG.md                   # read the upgrade notes first
git checkout -b upgrade-kit-<new-tag>
git merge kit/<new-tag> --allow-unrelated-histories                  # first time only; later merges need no flag
```

A template repository starts with unrelated history, so the first merge needs `--allow-unrelated-histories` and will conflict wherever you edited kit files: resolve in favour of the kit for files you never meant to change, and by hand elsewhere. Prefer merging over copying files: git remembers the base and later upgrades get smaller. Cherry-picking a single fix is fine too.

## 3. Migrations

- Kit migrations are timestamped and committed; yours are too. Never edit a migration that has been merged anywhere.
- After merging, `npx prisma migrate status` shows what is pending; apply with `npm run migrate` (`migrate deploy`) in each environment as a release step, never on boot.
- If a kit migration touches a table you extended, read it before applying; the changelog calls out such migrations.

## 4. Verify

```bash
npm ci                          # lockfile may have changed; also regenerates the Prisma client
npm run lint:check && npm run typecheck && npm test
npm run test:e2e                # + RUN_DB_TESTS=true against a migrated database
npm run check:rbac-removable    # if you removed optional modules, confirms the build still stands
```

The conventions are enforced by tests (every route documented and with an access policy, approved public routes, env validation), so a merge that breaks one of them fails loudly. If the approved public-route list or the permission matrix conflicts, the right answer is almost always to keep **both** sets of entries.

## 5. Dependency pins

`package.json` pins majors on purpose: NestJS 11, TypeScript 5.9, ESLint 9, Prisma 5, `@nestjs/schedule` 6 (version 12 is ESM-only and breaks Jest). Treat a major bump as its own upgrade with its own branch; `docs/DECISIONS.md` records why each pin exists.

## Versioning

The kit follows semantic versioning. Breaking changes (renamed environment variables, changed response shapes, removed endpoints, migrations that rewrite data) bump the major version and are listed under **Upgrade notes** in `CHANGELOG.md`.
