# First prompt for an AI coding assistant

Paste the prompt below as the **first message** of the first session in a project created from this kit (Claude Code, or any assistant that can read the repository and run commands). It tells the assistant, in order: what to **run** to get the project working, what to **read** before touching code, what it may and may not do on its own, and to answer with a plan instead of writing code.

Claude Code loads `CLAUDE.md` from the project root by itself; the prompt also names it explicitly so the rules are read first and acknowledged.

## How to use

1. Fill in the three `<...>` placeholders with facts about **your** project.
2. Paste it as the first message of a session opened **in the project folder**.
3. The assistant sets the project up by itself (the same steps as the README's "Quick start"). It stops and asks you for the two things it must not invent: the values in `.env` (it never reads that file) and, if you have not done it yet, the superadmin seed password.
4. Keep this file in the repository. Anyone joining the project (or a new session) can reuse it; update the project description when the scope changes.
5. Answer the assistant's questions, then work one small task at a time (see "Suggested order" below).

## The prompt

```text
This repository was created from our NestJS starter kit and is the backend for <PROJECT NAME>:
<2-3 sentences: what it does, who uses it, the main entities>.

STEP 1 - Read the rules first
Read CLAUDE.md completely before anything else and follow it for the whole session.
Do NOT open or print .env files (only .env.example).

STEP 2 - Set the project up (skip anything that is already done, and check before each step)
Requirements: Node 22, npm, Docker. Run, in this order, from the project root:
  a. If the folder is not a git repository, run `git init -b main` BEFORE npm ci (the git hooks are installed into it).
  b. If `docs/_origin` exists, delete it (it is the kit maintainers' provenance, not part of this project). This is the
     only deletion you may do without asking.
  c. `npm ci` (installs, runs `prisma generate`, installs the git hooks).
  d. If `.env` does not exist, create it with `cp .env.example .env` (copy only; never read it afterwards).
     Then STOP and tell me which values I have to set myself: SEED_SUPERADMIN_PASSWORD (12+ characters) and, if this
     project does not use Redis, that REDIS_URL should stay commented out. Wait until I say .env is ready.
  e. `docker compose up -d` (PostgreSQL; Redis only if used).
  f. `npm run migrate` (applies the existing migrations to the LOCAL database), then `npm run seed`.
  g. `npm run lint:check && npm run typecheck && npm test` - all must pass.
  h. Start `npm run start:dev` in the background and check `curl -s localhost:3000/healthz` and
     `curl -s -o /dev/null -w "%{http_code}" localhost:3000/docs` (API docs), then stop the server.
Report each step's result honestly. If a step fails, stop, show the error and explain; do not work around it silently.

STEP 3 - Read the project (do this after the setup works)
  1. README.md and ARCHITECTURE.md
  2. docs/DECISIONS.md (skim: why things are the way they are)
  3. docs/how-to/use-as-template.md and docs/how-to/add-module.md
  4. src/example/ (the reference module: README.md, then the controller, service, query, DTOs and the two spec files)
  5. .env.example, src/app.module.ts and src/rbac/permissions.ts

Ground rules
- You may do without asking: the setup commands above, installing from the lockfile, lint/typecheck/tests, running the dev server, reading and editing source files for the task I give you.
- Ask me first for: git commit or push, deleting files or folders (except `docs/_origin`), `npm run migrate:dev` or any new migration (show me the schema change first), installing a new dependency, and any command that could touch a database other than the local Docker one.
- Follow CLAUDE.md. Copy src/example to add features; do not hand-roll pagination, error shapes or auth.
- After each change run `npm run lint:check && npm run typecheck && npm test` and tell me the result honestly, including anything you could not run.
- If a convention gets in the way, stop and ask instead of working around it.

FIRST TASK (no code yet): after steps 1-3, reply with
a) a short summary of what you understood the kit provides and what it leaves to us,
b) which optional modules (src/redis, src/mail, src/storage, src/jobs, src/rbac) this project does not need and why, citing docs/how-to/optional-modules.md,
c) a proposed list of the modules, Prisma models and permissions for <PROJECT NAME>, based on the description above,
d) the questions you need answered before starting.
Wait for my answers before changing anything.
```

## Suggested order of work after the first answers

1. Remove the unused kit modules (its own commit).
2. Design the first Prisma model and the permission rows.
3. Build the first feature by copying `src/example`.
4. Delete `src/example` and the `ExampleItem` model.

The checks described in `CLAUDE.md` (every route documented, an access policy on every route, tests for each behaviour) keep the assistant on the kit's conventions. If a test fails, ask it to fix the cause, never to weaken the test.

## Why each part is there

| Part | Reason |
| :-- | :-- |
| Project description | The kit is domain-agnostic; without it the assistant cannot propose models or permissions |
| Step 1: read `CLAUDE.md` first | It holds the rules that tests and lint enforce; reading it before running or editing anything avoids rework |
| "Do NOT open .env" | `.env` holds secrets; only `.env.example` is meant to be read. The assistant may *create* `.env` by copying the example, then asks you to fill it |
| Step 2: the setup commands | The same ordered steps as the README Quick start, so the assistant verifies the project really runs (lint, types, tests, health, docs) before changing anything |
| Delete `docs/_origin` | It is the kit's provenance for its maintainers (it names the project the kit was extracted from); nothing in a derived project needs it |
| `git init` before `npm ci` | Husky installs its git hooks into the repository during `npm ci` |
| Stop at `.env` | Secrets and the seed password are yours to choose; the assistant must not invent them |
| `npm run migrate` allowed, `migrate:dev` asks | Applying the committed migrations to the local database is part of setup; creating a new migration is a design decision to review |
| Step 3: read the project | Rules first, then the big picture, then a working example to imitate |
| "Report honestly" | Prevents "done" claims for checks that were not actually run |
| Plan first, wait for answers | Cheaper to correct a plan than a pile of code |
