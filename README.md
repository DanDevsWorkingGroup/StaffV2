# ABPM Trainer System

Trainer scheduling and activity management for Akademi Bomba dan Penyelamat
Malaysia, running on Cloudflare Workers with a D1 database.

## Stack

| Layer    | Implementation                                  |
| -------- | ----------------------------------------------- |
| Runtime  | Cloudflare Workers                              |
| Database | Cloudflare D1 (SQLite)                          |
| Web      | TanStack Start (React 19, SSR) + Tailwind CSS 4 |
| Auth     | Session cookies backed by D1                    |

Previously this ran as a Node/Nitro container on a single VPS talking to a
self-hosted Supabase stack. See [Migration notes](#migration-notes).

## Getting started

```sh
npm install
npx wrangler login

# Create the local database
npx wrangler d1 execute abpm-trainer --local --file=migrations/0001_schema.sql
npx wrangler d1 execute abpm-trainer --local --file=migrations/0002_seed.sql
npx wrangler d1 execute abpm-trainer --local --file=migrations/0003_event_trainer_schedule.sql

npm run dev
```

## Scripts

| Command             | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Local dev server with a local D1                      |
| `npm run build`     | Production build                                      |
| `npm run typecheck` | `tsc --noEmit`                                        |
| `npm test`          | Unit tests for the D1 query layer (real SQLite)       |
| `npm run smoke`     | Logs in per role against a deployment, checks routes  |
| `npm run deploy`    | Build and deploy by hand (see Deployment below)        |

## Environments

Three environments, each its own Worker and its own D1 database. Changes are
promoted one way: **dev → staging → main**.

| Branch    | Worker                 | D1 database            | Data                   |
| --------- | ---------------------- | ---------------------- | ---------------------- |
| `dev`     | `abpm-trainer-dev`     | `abpm-trainer-dev`     | `seeds/dummy.sql`      |
| `staging` | `abpm-trainer-staging` | `abpm-trainer-staging` | `seeds/dummy.sql`      |
| `main`    | `abpm-trainer`         | `abpm-trainer`         | real records           |

Only production holds real people. Staging and dev are seeded with synthetic
records covering all seven roles; every dummy account uses the password
`AbpmDev123!`, with `admin@abpm.test`, `ptcoordinator@abpm.test` and so on, plus
`trainer1@abpm.test` … `trainer33@abpm.test`.

### Promotion

`main` accepts pull requests only from `staging`, and `staging` only from `dev`.
This is enforced by the `Check source branch` workflow, which branch protection
marks as required — GitHub cannot express "only from this branch" on its own.
An urgent production fix may branch as `hotfix/*` and target `main` directly;
the check allows it and records a warning.

### Deployment

Each Worker is connected to this repository through
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) and
watches its own branch, so no Cloudflare credentials are stored in GitHub.

Because the Cloudflare Vite plugin resolves the target environment when it
builds — writing an already-resolved config into `dist/` — `wrangler deploy
--env staging` has no effect. The environment is chosen with `CLOUDFLARE_ENV`
at build time, which is what each Worker's build command sets:

| Worker                 | Build command                       | Deploy command       |
| ---------------------- | ----------------------------------- | -------------------- |
| `abpm-trainer`         | `npm run build`                     | `npx wrangler deploy` |
| `abpm-trainer-staging` | `CLOUDFLARE_ENV=staging npm run build` | `npx wrangler deploy` |
| `abpm-trainer-dev`     | `CLOUDFLARE_ENV=dev npm run build`     | `npx wrangler deploy` |

To deploy by hand: `npm run deploy`, `npm run deploy:staging`,
`npm run deploy:dev`.

### Rebuilding a database

```sh
npm run db:setup -- dev        # migrations + dummy seed
npm run db:setup -- staging
npm run db:setup -- dev --local
```

Production refuses to seed without `--seed-production`, because
`seeds/production.sql` replaces every row.

## Layout

```
migrations/          D1 schema and the data migrated from Supabase
scripts/
  build-seed.mjs     Turns Postgres JSON exports into the D1 seed
  smoke.mjs          Role-by-role checks against a deployment
  test/              Unit tests for the query layer
src/
  middleware/rbac.ts Roles, permissions, per-module access checks
  utils/
    auth.ts          Password hashing and session handling
    db.ts            D1 binding helpers
    postgrest.ts     PostgREST-compatible query builder over D1
    schema.ts        Table/column metadata used by the query builder
    supabase.ts      Client facade — same API, D1 underneath
```

## Migration notes

The app was written against `@supabase/ssr`, with roughly 85 `supabase.from(...)`
call sites spread across the route files. Rather than rewrite each one, the
Supabase client was replaced by a facade of the same shape
(`src/utils/supabase.ts`) built on a PostgREST-compatible query builder
(`src/utils/postgrest.ts`) that translates to D1. Route code is therefore
unchanged, and the translation layer is covered by unit tests.

Points worth knowing:

- **Types.** Postgres arrays (`participants`, `availability`) are stored as TEXT
  holding JSON and decoded on read; booleans are INTEGER `0`/`1`; timestamps and
  dates are ISO-8601 TEXT.
- **Auth.** Supabase GoTrue is replaced by `src/utils/auth.ts`. The 154 migrated
  accounts kept their bcrypt hashes, which are still accepted; on a successful
  login the hash is upgraded in place to PBKDF2-SHA256, which the Workers
  runtime computes natively. Sessions are opaque cookie tokens, stored only as
  their SHA-256.
- **Row-level security.** Postgres RLS is gone. Access control lives in the
  application, in `src/middleware/rbac.ts` and the route `beforeLoad` guards —
  which is where this app already enforced it.
- **Carried-over quirks.** `events.trainer_ids` is queried but has never existed,
  so those counts render as `0`, exactly as before. `get_trainer_profile()` never
  existed either, so `/profile` continues to use its fallback query path.
  `event_trainer_schedule` *is* now created, so writes to it no longer fail
  silently; nothing reads it yet.
