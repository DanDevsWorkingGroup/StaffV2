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

## Deployment

Pushes to `main` are built and deployed automatically by
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), which
is connected to this repository. It runs:

```sh
npm run build      # build command
npx wrangler deploy  # deploy command
```

No Cloudflare credentials are stored in GitHub. The `CI` workflow only
typechecks, tests and builds.

The Worker name in the Cloudflare dashboard must match the `name` field in
`wrangler.jsonc` (`abpm-trainer`), or the build fails.

To deploy by hand — say, from a branch — run `npm run deploy` with your own
`wrangler login`.

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
