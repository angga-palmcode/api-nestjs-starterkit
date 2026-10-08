# Start a new project from this kit

The kit is meant to be used as a **template**: every new backend starts from a clean copy, then removes what it does not need and builds its own features on top. This page covers creating the copy, the cleanup to do before the first commit, and how to keep the ability to take kit updates later.

## 1. Create the copy

Pick **one** option (A to D); the cleanup in sections 2 to 5 is the same afterwards. They differ in two things: whether the kit already lives on GitHub, and whether the repository for your new project exists yet.

| Option | Needs the kit on GitHub? | Needs the new project's repository first? | Best when |
| :-- | :-- | :-- | :-- |
| **A** GitHub template | yes (marked as a template) | no, it creates it | The normal case once the kit is published |
| **B** `degit` | yes | no | You want the files only, without any git history |
| **C** Manual copy, repository first | no | yes (empty) | You like to `git clone` first and copy files in |
| **D** Manual copy, repository later | no | no | The repository does not exist yet, or you want to start offline |

### A. GitHub template repository (recommended)

One-time setup in the kit repository: *Settings → General → tick "Template repository"*. Then, for every new project:

```bash
gh repo create <org>/<my-project> --template <org>/<kit-repo> --private --clone
# or in the browser: "Use this template" → "Create a new repository", then git clone
cd <my-project>
```

The new repository starts with a single commit, is already connected to GitHub, and does not carry the kit's history.

### B. `degit` (files only, no git history)

```bash
npx degit <org>/<kit-repo> <my-project>        # private repository: add --mode=git
cd <my-project>
git init -b main
```

Connect it to GitHub whenever you are ready (see the end of option D).

### C. Manual copy into a freshly cloned, empty repository

```bash
git clone git@github.com:<org>/<my-project>.git
```

Then copy the kit into it, **excluding** what must not travel:

```bash
# Windows (PowerShell / cmd)
robocopy <kit-folder> <my-project> /E /XD node_modules dist coverage .git .claude storage-data .tmp-rbac-check /XF .env
# macOS / Linux / Git Bash
rsync -a --exclude node_modules --exclude dist --exclude coverage --exclude .git \
  --exclude .claude --exclude storage-data --exclude .tmp-rbac-check --exclude .env \
  <kit-folder>/ <my-project>/
```

What is excluded and why: `node_modules` and `dist` are rebuilt; `.git` would give your project the kit's history and remote; `.claude` is local assistant settings; `.env` may hold secrets; `storage-data` is local file storage from development.

Check that dot-files came along: `ls -a` must show `.github`, `.husky`, `.env.example`, `.gitignore`, `.gitattributes`, `.prettierrc`, `.dockerignore`.

### D. Manual copy, repository created later (local first)

Copy exactly as in option C, but into a plain new folder, then start a local repository:

```bash
# copy with the same robocopy / rsync command as option C, into <my-project>
cd <my-project>
git init -b main
```

Do sections 2 to 5 below (cleanup, verification, first commit). Connect GitHub whenever you like:

```bash
# the repository already exists on GitHub (created in the browser):
git remote add origin git@github.com:<org>/<my-project>.git
git push -u origin main

# or create it from the command line and push in one go (GitHub CLI):
gh repo create <org>/<my-project> --private --source . --remote origin --push
```

If the repository was created on GitHub with a README or license, the first push is rejected because the histories differ. Either force it when the remote content does not matter (`git push -u origin main --force`) or integrate it first (`git pull origin main --rebase --allow-unrelated-histories`, resolve the conflicts, push).

### What not to do

- **Do not `git pull` the kit into an existing project repository.** It merges the kit's whole history into yours. Use options A to D for the first copy and the controlled merge in [upgrade.md](upgrade.md) for later updates.
- Do not keep the kit's `.git` folder.
- Do not copy `.env`; create your own from `.env.example`.

## 2. Make it yours (before the first commit)

| Step | What to do |
| :-- | :-- |
| Remove the kit's provenance | `rm -rf docs/_origin` (notes for the people who maintain the kit; they name the project the kit was extracted from) |
| Identity | Set `name` and `version` in `package.json`; set `APP_NAME` (shown in Swagger) in `.env`; replace `CHANGELOG.md` with your own (start with `## [Unreleased]`) |
| Configuration | `cp .env.example .env`. Development works with the placeholder secrets; for any shared or production environment generate three different secrets with `openssl rand -base64 48` |
| Remove optional modules you do not need | See section 3 |
| Seed and permissions | Replace the seed accounts (`SEED_*` variables) and the permission matrix in `src/rbac/permissions.ts` with yours |
| Repository hygiene | Add whatever your editor or tools create (for example `.claude/`) to `.gitignore`; never commit `.env` |
| Verify | `npm ci && npm run lint:check && npm run typecheck && npm test` must be green after the removals |
| Commit | Make the removals a separate first commit (for example `chore: remove unused kit modules`) so your own work starts from a clear baseline |

Run the full local setup once to confirm everything works end to end:

```bash
docker compose up -d      # PostgreSQL (and Redis, if you kept it)
npm run migrate
npm run seed
npm run start:dev         # then open http://localhost:3000/docs
```

## 3. What to remove, and what to keep

**Keep (the foundation):** `config`, `common`, `prisma`, `auth`, `users`, `audit`, `health`. Auth, users and audit are the reason to use the kit; removing them is a different project.

**Optional (delete the folder and one line in `src/app.module.ts`):**

| Folder | Delete it when | What changes |
| :-- | :-- | :-- |
| `src/redis` | You do not need rate limiting shared across instances. Also removes the "Redis connection error" warning if you never run Redis. Remove `REDIS_URL` and `THROTTLE_STORAGE` from `.env` | Rate limits are counted in memory per instance. If `THROTTLE_STORAGE=redis` is still set the app refuses to boot |
| `src/mail` | You send no email, or you provide your own `EMAIL_TRANSPORT` (SES, Postmark, ...) | `AUTH_DELIVERY=email` refuses to boot without a transport; use `console` or your own provider |
| `src/storage` | You store no files | Nothing else uses it |
| `src/jobs` | You have no scheduled work | Expired tokens and sessions accumulate unless you add your own cleanup |
| `src/rbac` | You do not need a permission matrix | Any signed-in user passes route checks; user management keeps its own admin-level gate. Also remove every `@Permissions(...)` / `@Roles(...)` line. See [remove-rbac.md](remove-rbac.md) |
| `src/example` | After your first real module exists | Also delete the `ExampleItem` model (add a migration) and the `example.*` rows in `PERMISSION_ROLES` |

Steps and consequences in detail: [optional-modules.md](optional-modules.md). Before you remove anything, `npm run check:rbac-removable` shows the kit itself compiles without each module; run it again afterwards if you want the same guarantee for your project.

Also consider authentication options you will not use and their flags (`AUTH_METHODS`, `AUTH_MFA`, `AUTH_ALLOW_REGISTRATION`): they are configuration, not code to delete. Leave the code in place and set the flags; see [enable-otp.md](enable-otp.md) and [enable-mfa.md](enable-mfa.md).

## 4. Build your first feature

Copy `src/example` (checklist in [add-module.md](add-module.md)), register the module, write its tests by copying the example's, then delete `src/example`. Conventions are enforced by tests and lint, so the build tells you if you forget a Swagger decoration or an access policy.

## 5. Keep the upgrade path open

A project made from the template is a copy, so kit fixes do not arrive by themselves. To stay mergeable:

- Extend through the seams (new modules, the permission matrix, `ErrorCode`, `EMAIL_TRANSPORT`, `STORAGE`, the query builder's `scope`) instead of editing kit files.
- If you must edit a kit file, keep the change small and write it down in your own docs.
- Note which kit version you started from (the tag, or the commit hash if there is no tag yet) in your `README` or `CHANGELOG.md`.
- Read [upgrade.md](upgrade.md) before the first update.
