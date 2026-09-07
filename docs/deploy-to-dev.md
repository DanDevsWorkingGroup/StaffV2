# Deploying the password-reset feature to dev

> ## ⚠️ FIRST: clean up leftover git lock files
>
> An attempted rebase inside the Linux sandbox failed partway because the mount
> does not permit deleting files, and git left state behind. **Your commit, your
> branch and your working tree are all intact** — but git will refuse to run until
> these three paths are removed. From Windows, in the repo root:
>
> ```powershell
> del .git\index.lock
> del .git\HEAD.lock
> rmdir /s /q .git\rebase-merge
> ```
>
> Then confirm all is well:
>
> ```powershell
> git status
> git log --oneline -1        # should show a556702
> ```
>
> Nothing was lost: `feat/password-reset-otp` still points at `a556702`, HEAD was
> never detached, and every source file on disk matches that commit. The rebase in
> §1 below has **not** been done — it is still yours to run, and will work
> normally on Windows where deletes are permitted.
>
> The failed attempt also left a few untracked files from `origin/dev` in the
> working tree (`.github/workflows/branch-policy.yml`, `migrations/README.md`,
> `scripts/db-setup.mjs`, `scripts/build-dummy-seed.mjs`, `seeds/`). They are
> genuine `origin/dev` content and will be tracked properly after the rebase, so
> they are harmless — but do not `git add` them before rebasing.

**Then: blocked on two things before anything can be deployed.** Read §1 and §2
first — the rest is the mechanics once those are resolved.

---

## 1. BLOCKER: the feature branch is built on a stale `main`

`feat/password-reset-otp` was branched from **local `main` @ `1b0bae3`**, which is
**8 commits behind `origin/main` @ `6cc9147`**.

Everything describing the three-environment setup lives in those 8 commits:

```
6cc9147 Merge pull request #5 from DanDevsWorkingGroup/staging
b5d1adf Merge pull request #4 from DanDevsWorkingGroup/dev
56675b4 Give staging and dev their own hostnames, behind Access
eefdc86 Verify the dev Workers Build connection deploys to abpm-trainer-dev
b05633b Merge pull request #3 from DanDevsWorkingGroup/staging
e1cfc65 Merge pull request #2 from DanDevsWorkingGroup/dev
4cf2f7a Document the three environments and the promotion path
92fbecb Add staging and dev environments
```

So the branch is missing, and would **revert**, all of:

| Missing from the branch's base | Consequence |
|---|---|
| `env.dev` / `env.staging` blocks in `wrangler.jsonc` | No dev environment exists to deploy to |
| `vars.APP_ENV` | No way to tell environments apart at runtime |
| `build:dev`, `deploy:dev`, `db:setup`, `seed:dummy` npm scripts | The documented commands don't exist |
| `seeds/dummy.sql`, `seeds/production.sql` | No seed data |
| `scripts/db-setup.mjs`, `scripts/build-dummy-seed.mjs` | No migration runner |
| `.github/workflows/branch-policy.yml` | Promotion policy check |
| README "Environments" section | The documentation of all of the above |

**Merging this branch as-is would delete the entire multi-environment setup.**

### Also: the branch targets the wrong place

The repo enforces **dev → staging → main** via `.github/workflows/branch-policy.yml`,
marked as a required check. A PR from `feat/password-reset-otp` into `main` is
**rejected by CI**, by design. The only exception is a `hotfix/*` branch, which
this is not.

### Fix

Rebase onto `origin/dev` (which is where a feature goes, and is itself slightly
ahead of `origin/main` with the prod-routes commit), then open the PR against
`dev`:

```sh
git fetch origin
git rebase origin/dev feat/password-reset-otp
```

Expect conflicts in three files, all mine, all straightforward:

- **`wrangler.jsonc`** — take `origin/dev`'s version wholesale, then re-add the
  `ratelimits` block. **See §2.**
- **`package.json`** — keep `origin/dev`'s full script list, and re-apply only the
  change to `test` (which now runs both suites).
- **`README.md`** — keep `origin/dev`'s Environments section, re-add the Secrets
  section.

`src/`, `migrations/`, `docs/` and `scripts/test/` should not conflict — they are
new files or files the other branches did not touch.

---

## 2. BLOCKER: rate-limit bindings are not inherited by environments

From the repo's own comment in `wrangler.jsonc`:

> Bindings and vars are **NOT** inherited from the top level, so each environment
> repeats them in full.

That is a Cloudflare rule for named environments, and `ratelimits` is a binding. I
added the `PW_RESET_REQUEST` / `PW_RESET_VERIFY` bindings **at the top level only**.
After the rebase they would apply to production and **not** to dev or staging.

The code treats a missing binding as "no burst guard" rather than an error, so
**dev would still work** — the authoritative hourly caps live in the
`password_reset_throttle` D1 table, which is unaffected. But dev then would not be
testing the same configuration as prod.

**Fix:** repeat the `ratelimits` block inside `env.dev` and `env.staging`. Use
**different `namespace_id` values per environment** — two bindings sharing a
namespace id share their counters *across Workers on the same account*, so reusing
`2001`/`2002` would let dev traffic consume production's rate-limit budget:

| Environment | `PW_RESET_REQUEST` | `PW_RESET_VERIFY` |
|---|---|---|
| production (top level) | `2001` | `2002` |
| staging | `2011` | `2012` |
| dev | `2021` | `2022` |

---

## 3. BLOCKER for *testing*: the OTP code is unrecoverable on dev

This one is specific to testing without Resend, and it is a real dead end as the
code stands.

Dan has no Resend account yet, so `RESEND_API_KEY` will be unset. The flow
degrades correctly — `sendEmail()` logs and returns `false`, nothing crashes, the
code row is still written — **but there is then no way to learn the code**:

- **It is not logged.** `src/utils/email.ts` deliberately logs only the subject,
  never the recipient and never the body. That was a deliberate security choice
  (`observability` is on, so anything logged is retained in the dashboard).
- **It is not in the database.** `password_reset_otps.code_hash` is
  `HMAC-SHA256(OTP_PEPPER, code)`. That is the whole point of §2.2 of
  `how-it-works.md`.
- **The dev seed makes email impossible anyway.** Dummy accounts use
  `@abpm.test` addresses — `.test` is a reserved TLD (RFC 6761) that can never
  receive mail, even once Resend is configured.

So `wrangler tail` will show you `[email] no RESEND_API_KEY configured — would have
sent "Your ABPM Trainer System password reset code"` and nothing more. You can
reach step 2 and get no further.

### Options

**(a) Add a dev-only log line — recommended.** The `APP_ENV` var already exists
for exactly this kind of branch. Roughly:

```ts
if ((env as { APP_ENV?: string }).APP_ENV === 'dev') {
  console.warn(`[password-reset][dev] code for ${user.email}: ${code}`)
}
```

Gated on `=== 'dev'` (not `!== 'production'`, which would also catch staging and
anything unset). This is a **code change I have not made** — it puts a live
credential into retained logs, and even on dev that deserves your explicit yes.

**(b) Set up Resend first** and test with a real mailbox by temporarily adding a
real address to a dev account. Slower, but it also exercises the actual delivery
path, which (a) does not.

**(c) Recover it by brute force.** With `OTP_PEPPER` known to you, all 10⁶
candidate HMACs can be computed against the stored `code_hash` in milliseconds.
Works, and proves the design, but it is a silly way to run a smoke test.

I would do **(a)** for the click-through now, then **(b)** once the domain is
verified, since only (b) tests deliverability to `bomba.gov.my`.

---

## 4. Applying migration 0006 to dev

**Database: `abpm-trainer-dev`, id `1af77a20-e765-47cd-aaa8-453d2a5abff1`.**
(Production is `abpm-trainer` / `08ce77d6-…` — do not touch it.)

**Do not use `npm run db:setup -- dev` for this.** That script re-runs *every*
migration from `0001` and then reloads `seeds/dummy.sql`. `0001_schema.sql` uses
plain `CREATE TABLE` without `IF NOT EXISTS`, so it will fail on the first file
against an existing database — and if it did succeed it would wipe dev's data. It
is a from-scratch rebuild tool, not an incremental one.

Apply just the new migration:

```sh
npx wrangler d1 execute abpm-trainer-dev --remote \
  --file=migrations/0006_password_reset_otps.sql
```

Verify:

```sh
npx wrangler d1 execute abpm-trainer-dev --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'password_reset%';"
```

Expect two rows: `password_reset_otps`, `password_reset_throttle`.

**I have not run this.** It changes a remote database and needs your credentials.

---

## 5. Secrets — per environment, not inherited

Worker secrets belong to a Worker. Anything set on `abpm-trainer` does **not**
reach `abpm-trainer-dev`. Set them against the dev Worker explicitly:

```sh
npx wrangler secret put OTP_PEPPER --name abpm-trainer-dev
npx wrangler secret put EMAIL_FROM --name abpm-trainer-dev
# RESEND_API_KEY: skip for now — see §3
```

`--name` is used rather than `--env dev` because it is unambiguous about which
Worker is being changed; `--env dev` also works and resolves to the same Worker.

For `OTP_PEPPER` on dev, any 32 random bytes will do — `openssl rand -base64 32`.
It does not need to match production, and it should not.

Without `OTP_PEPPER` the flow still runs but logs
`OTP_PEPPER is not set — using an insecure development pepper`. Fine for a
click-through; set it anyway so dev matches prod's code path.

---

## 6. Deploying

Once §1 and §2 are resolved, deployment is **automatic**: Workers Builds watches
the `dev` branch and deploys `abpm-trainer-dev`. So "deploy to dev" means:

```sh
git checkout dev && git merge feat/password-reset-otp && git push origin dev
```

or open a PR from `feat/password-reset-otp` into `dev` (allowed — the branch policy
only constrains PRs into `staging` and `main`).

**If you deploy by hand instead, the command is `npm run deploy:dev`.** Note the
warning already in the README:

> Because the Cloudflare Vite plugin resolves the target environment when it
> builds, `wrangler deploy --env staging` has no effect.

So `npx wrangler deploy --env dev` would **silently deploy dev's code to
production**. `npm run deploy:dev` sets `CLOUDFLARE_ENV=dev` at build time, which
is the part that matters.

---

## 7. Testing through Cloudflare Access

`dev.abpmtrainer.my` sits behind Access, and `workers_dev: false` means there is no
`*.workers.dev` bypass — deliberately.

**I cannot reach it.** An automated browser hits the Access login and cannot
complete your SSO/one-time-PIN. Options:

- **You drive the click-through.** Simplest, and the right call for a first pass.
- **A service token** (Access → Service Auth) would let a script through with
  `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers. That is an account
  configuration change and a long-lived credential, so it is your decision, not
  something to add for one test.

### The click-through, once §3 is resolved

1. In one terminal: `npx wrangler tail abpm-trainer-dev --format pretty`
2. Open `https://dev.abpmtrainer.my/login`, authenticate through Access.
3. Click **Forgot your password?** → should land on `/forgot-password`.
4. Enter `admin@abpm.test` (dummy seed; password `AbpmDev123!`). Submit.
5. In `wrangler tail`, read the code from the dev-only log line from §3(a).
6. Enter it. Then set a new password — check the show/hide toggles work on both
   fields, and that the **Resend code** button counts down from 60s.
7. Confirm you are redirected to `/login` and **not** auto-logged-in.
8. Sign in with the new password. Then confirm the old one fails.

### Worth checking while you are in there

- Enter an address that does **not** exist. It must look **identical** — same
  screen, same wording, same delay. That is the anti-enumeration property.
- Enter a wrong code five times, then the right one — it must be refused.
- Sign in on a second browser first, then complete a reset; the second session
  must be signed out.

---

## 8. What I did and did not do

| | |
|---|---|
| Committed the feature to `feat/password-reset-otp` (`a556702`) | ✅ done |
| Pushed the branch | ❌ **failed — no git credentials in this environment** |
| Rebased onto `origin/dev` | ❌ **attempted, failed on the sandbox file-permission model.** Working tree, branch and commit all intact; see the cleanup box at the top. Run it yourself on Windows. |
| Reconciled `wrangler.jsonc` to `origin/dev` + `ratelimits` | ✅ done in the working tree |
| Reconciled `package.json` to `origin/dev` + dual test suite | ✅ done in the working tree |
| Reconciled `README.md` to `origin/dev` + Secrets section | ✅ done in the working tree |
| Added `ratelimits` to `env.dev` / `env.staging`, distinct namespace ids | ✅ done |
| Dev-only OTP logging, gated `APP_ENV === 'dev'` | ✅ done, with 5 tests |
| Full suite + typecheck after the changes | ✅ 27 + 34 passing, `tsc` clean |
| Applied `0006` to any remote database | ❌ not done — needs your credentials |
| Set any secret | ❌ not done |
| Deployed anything, anywhere | ❌ not done |
| Touched `main` or production | ❌ **never** |

Because the three reconciled files exist only in the working tree (not in
`a556702`), a `git rebase` will overwrite them with the conflicted versions. The
simplest path is therefore **not** a rebase — see §9.

---

## 9. Simplest path to a correct branch

Given the working tree already holds the fully reconciled files, skip the
conflict-resolution dance entirely:

```powershell
:: 0. clean up the locks (box at the top of this document)

:: 1. stash the reconciled working tree
git stash push -u -m "reconciled files + dev-only log"

:: 2. start a clean branch from origin/dev
git fetch origin
git checkout -b feat/password-reset-otp-v2 origin/dev

:: 3. bring back the reconciled files
git stash pop

:: 4. bring the rest of the feature over from the old commit
git checkout feat/password-reset-otp -- src migrations docs scripts/test .gitignore

:: 5. check what you have, then commit
git status
npm test && npm run typecheck && npm run build
git add -A
git commit -m "Add forgot-password flow with email OTP"
git push -u origin feat/password-reset-otp-v2
```

Then open a PR into **`dev`** (not `main` — the branch policy rejects that).

Step 5's `npm run build` is the one check that has never been run anywhere; it
needs your Windows `node_modules`.
