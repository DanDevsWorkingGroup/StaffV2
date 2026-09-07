# Implementation Plan — Forgot Password via Email OTP

**Status: IMPLEMENTED.** See `docs/password-reset-setup.md` for the DNS and secret
steps Dan still needs to do. This document is kept as the design record; where the
build diverged from the original plan it is marked **[changed]** below.
**Date:** 2026-09-07
**Scope (confirmed by Dan):** forgot-password while **logged out** only. A logged-in
"change my password" screen is explicitly **out of scope**.

**Decisions since drafting:**

- Sending domain is **`abpmtrainer.my`**, which Dan controls. From-address
  `no-reply@abpmtrainer.my`, pending his confirmation.
- The account is on **Workers Free**, so Cloudflare Email Service is out (outbound
  sending to arbitrary recipients needs Workers Paid). **Resend** it is — it is a
  plain outbound `fetch`, which Workers Free permits.
- **[changed] Code TTL is 20 minutes, not 10.** Government mail gateways greylist,
  deferring first delivery by 5–15 minutes; a 10-minute code would expire in
  transit to the `@bomba.gov.my` recipients. The attempt cap, not the window, is
  what bounds brute force, so the security cost is negligible. Reasoning in
  `docs/password-reset-setup.md` §5.
- **[changed] Code and ticket are separate lifetimes.** Ticket stays at 10 minutes,
  since by then the user is actively on the page.

---

## 1. What exists today

Grounded in a read of the repo at `StaffV2/`.

### Auth

`src/utils/auth.ts` is the whole auth layer. Relevant primitives already present:

| Thing | Where | Notes |
| --- | --- | --- |
| `hashPassword(password)` | `src/utils/auth.ts:55` | PBKDF2-SHA256, 100k iterations, format `pbkdf2$sha256$<iters>$<b64salt>$<b64hash>` |
| `verifyPassword(password, stored)` | `src/utils/auth.ts:68` | Accepts PBKDF2 **and** legacy bcrypt `$2a$` hashes from the GoTrue migration |
| `timingSafeEqual(a, b)` | `src/utils/auth.ts:61` | **module-private today — must be exported for OTP compare** |
| `sha256Hex(value)` | `src/utils/auth.ts:99` | **module-private today — export or duplicate** |
| `newToken()` | `src/utils/auth.ts:107` | 32 random bytes, base64url. Reuse verbatim for the reset ticket |
| `startSession(userId)` | `src/utils/auth.ts:113` | Cookie `abpm_session`, 30-day TTL, only SHA-256 of the token stored |
| `getSessionUser()` | `src/utils/auth.ts:135` | |
| `signIn` / `signOut` | `src/utils/auth.ts:161` / `:206` | `signIn` already returns a single generic `'Invalid login credentials'` for both unknown-email and wrong-password — the anti-enumeration precedent to follow |
| `adminCreateUser` | `src/utils/auth.ts:230` | Public self-registration was deliberately removed; accounts are ADMIN-created |

There is **no** password-change or password-reset code anywhere in the repo yet.

### Sessions

`migrations/0001_schema.sql`:

```sql
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,   -- SHA-256 of the cookie token, hex
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
```

`sessions_user_id_idx` already exists, so `DELETE FROM sessions WHERE user_id = ?`
(the "log everyone out" step) is a cheap indexed delete. Nothing else needs to change
for global sign-out — there are no JWTs or stateless tokens to worry about.

### Users

```sql
CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  email_confirmed_at TEXT,
  created_at         TEXT NOT NULL DEFAULT (...),
  updated_at         TEXT NOT NULL DEFAULT (...),
  last_sign_in_at    TEXT,
  raw_user_meta_data TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
```

Email is unique case-insensitively, and every existing query uses
`WHERE lower(email) = lower(?)`. Follow that.

`trainers` (`migrations/0001_schema.sql:88`) has `user_id TEXT UNIQUE REFERENCES users(id)`
and carries `name` — useful for personalising the email ("Hi Ahmad") but **not required**,
and reading it must not change response timing (see §6.3).

### Routes and server functions

- TanStack Start file routes under `src/routes/`. Public routes live at the top level
  (`src/routes/login.tsx`, `src/routes/logout.tsx`); everything authenticated is under
  `src/routes/_authed/` and gated by `src/routes/_authed.tsx` `beforeLoad`.
- Server functions use the pattern
  `createServerFn({ method: 'POST' }).inputValidator((d: T) => d).handler(async ({ data }) => ...)`
  — see `loginFn` in `src/routes/_authed.tsx:6`.
- `src/middleware/rbac.ts` exports `requireRole` / `requirePermission` etc. **None of
  these apply here** — the reset flow is deliberately unauthenticated.
- Mutations from components go through `src/hooks/useMutation.ts` (`useMutation({ fn, onSuccess })`).

### The Supabase facade

`src/utils/supabase.ts` is a shim keeping ~20 route files compiling; `.auth` delegates
straight to `src/utils/auth.ts`. **Do not add reset methods to the facade.** It exists to
avoid rewriting legacy call sites; new code should import `~/utils/auth` and `~/utils/db`
directly, the way `src/middleware/rbac.ts` already does.

### DB access

`src/utils/db.ts` exposes `db()`, `all()`, `first()`, `run()` over the D1 binding `DB`.
Use these; do not reach for the PostgREST builder (`src/utils/postgrest.ts`) — it is a
compatibility layer, not the preferred API.

### Migrations

Sequential, hand-applied: `0001_schema.sql` … `0005_dormitory_visitor_batches.sql`.
There is no migration runner — `npm run db:migrate` only executes `0001`, and the README
tells you to run each file by hand with
`npx wrangler d1 execute abpm-trainer --local --file=migrations/000N_*.sql`.
Next free number is **`0006`**.

### Config and secrets

`wrangler.jsonc` currently declares only the D1 binding:

```jsonc
{
  "name": "abpm-trainer",
  "compatibility_date": "2025-09-24",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
  "observability": { "enabled": true },
  "d1_databases": [{ "binding": "DB", "database_name": "abpm-trainer", "database_id": "..." }]
}
```

No KV, no Durable Objects, no Queues, no rate-limit binding, no secrets.

`.env` exists in the working tree and is **untracked** (confirmed: `git ls-files` returns
nothing for it). It holds leftover self-hosted-Supabase credentials from before the
migration. It is a Vite `.env`, not a Worker secret store — `import.meta.env` values are
build-time and `VITE_`-prefixed ones are **inlined into the client bundle**. An OTP pepper
or email API key must never go there. Worker secrets are read through
`env` from `cloudflare:workers`, exactly as `src/utils/db.ts` does for `DB`.

Deployment is automatic via Workers Builds on push to `main` (README, "Deployment");
`.github/workflows/ci.yml` only typechecks/tests/builds. So **secrets must be set once
with `wrangler secret put`, not through CI**.

### Existing UI hook

`src/components/Auth.tsx:113` already renders a dead link:

```tsx
<a href="#" className="...">Forgot your password?</a>
```

That is the entry point to wire up.

### Recipient domains

The 154 migrated accounts (`migrations/0002_seed.sql`) are mostly **external mailboxes**:
~94 `@gmail.com`, ~29 `@bomba.gov.my`, ~15 `@yahoo.com`, ~9 `@abpm.gov.my`, plus a few
others. This matters a lot for provider choice (§2): the system must send to **arbitrary
third-party recipients**, not to a small allowlist.

---

## 2. Email sending from Cloudflare Workers — 2026 options

Workers cannot open raw TCP/SMTP sockets to a mail server, so the options are an HTTP API
or a native binding. Everything below was checked against current docs on 2026-09-07.

### Ruled out immediately

- **MailChannels' free Workers integration** — dead. Terminated 31 August 2024; the free
  Workers-specific route no longer exists, and Cloudflare's own docs now point elsewhere.
  MailChannels remains available as a paid Email API with a small free tier, but there is
  no reason to pick it now.
- **Cloudflare Email Routing** — receive-only. It handles *inbound* mail (`email()` handler,
  `message.forward()`). It cannot originate a password-reset email to a Gmail address.
- **SendGrid** — no longer has a permanent free tier (60-day trial only, then ~$19.95/mo).
  Wrong shape for this project.
- **Postmark** — excellent deliverability, but the free developer plan is 100 emails
  **per month**. Too tight to be comfortable, and it is a paid product past that.

### Real candidates

| Option | Free tier | Custom domain / DNS required? | Notes |
| --- | --- | --- | --- |
| **Cloudflare Email Service (Email Sending)** | **Not available on Workers Free.** Workers **Paid** ($5/mo) includes 3,000 outbound/mo, then $0.35 per 1,000. Sending to *verified destination addresses in your own account* is free on any plan and doesn't count toward quota. | Yes — sender domain must be onboarded to Email Service. Before onboarding a domain you can only send to verified destinations. | Native `send_email` binding (`env.EMAIL.send({to, from, subject, html, text})`), no API key in your code at all, no extra vendor. Also has REST API and authenticated SMTP submission on `smtp.mx.cloudflare.net:465`. Marked **Beta**. |
| **Resend** | 3,000/month **and** 100/day, 1 verified domain, 30-day log retention. Permanent free plan, no card. | Yes for real sending. The `onboarding@resend.dev` sandbox sender can only deliver to your own account address, so it is a dev-only convenience. | Simple `POST https://api.resend.com/emails` with a bearer key. This is what Cloudflare's own docs now point Workers users toward. |
| **Brevo** | 300/day (~9,000/mo), shared across marketing *and* transactional. | Domain authentication strongly recommended; sending works sooner without it but deliverability suffers. | Highest free daily ceiling of the realistic options. Heavier, marketing-oriented product. |
| **Mailgun** | 100/day on the current free tier; paid from ~$15/mo for 10k. | Yes — domain + DNS verification. | Fine, but no advantage over Resend here. |

### Recommendation

**Resend, behind a thin `sendEmail()` adapter in `src/utils/email.ts`.**

Reasoning for *this* project:

- **Volume is trivially inside the free tier.** 154 accounts; password resets are a
  handful a week at most. 100/day is never going to bind — and if a spike ever does hit
  it, that spike is an attack, and the rate limits in §6.1 will have already stopped it.
- **Recipients are arbitrary external addresses** (94 Gmail accounts). That rules out any
  "free to verified destinations only" path.
- **It works on the Workers Free plan.** Cloudflare Email Service is the more elegant
  answer — a binding, no third-party key, no extra vendor — but outbound sending to
  arbitrary recipients requires **Workers Paid**, and it is still Beta. If the account is
  already on Workers Paid, flip the recommendation: use the native binding.
- **A one-file adapter makes the choice cheap to reverse.** `sendEmail()` takes
  `{ to, subject, html, text }`; swapping Resend for `env.EMAIL.send()` or Brevo is a
  ~20-line change with no callers touched.

Trade-offs to accept: one more vendor and one more API key to rotate; the free tier is one
verified domain, so staging and production share a sending domain (use different `from`
local-parts, e.g. `noreply@` vs `noreply-staging@`); 30-day log retention is fine for
debugging a reset flow.

**DNS is required either way.** Resend needs SPF + DKIM records on the sending domain
(and a DMARC record is strongly advised, since Gmail enforces authentication for bulk
senders). `.env` references `api.abpmtrainer.my`, which suggests `abpmtrainer.my` is
available — see the open questions in §8. Sending as `@bomba.gov.my` or `@abpm.gov.my`
would need the DNS owner's cooperation and is very unlikely to be granted quickly.

---

## 3. Database migration

New file: `migrations/0006_password_reset_otps.sql`

```sql
-- Email OTP codes for the logged-out "forgot password" flow.
--
-- One row per issued code. The code itself is never stored: only an HMAC-SHA256
-- of it, keyed by the OTP_PEPPER Worker secret, so a leaked D1 snapshot cannot
-- be turned back into working codes even for a 6-digit space.
--
-- A row is single-use. It moves through:
--   issued            -> verified_at set  -> consumed_at set
--   (or) expires_at passes / attempts hits the cap -> dead
CREATE TABLE password_reset_otps (
  id                 TEXT PRIMARY KEY,          -- uuid
  user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email_lower        TEXT NOT NULL,             -- lower(email) at issue time; for rate-limit counting
  code_hash          TEXT NOT NULL,             -- HMAC-SHA256(OTP_PEPPER, code), hex
  attempts           INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,             -- ISO-8601
  expires_at         TEXT NOT NULL,             -- created_at + 10 min
  verified_at        TEXT,                      -- set when the correct code is entered
  consumed_at        TEXT,                      -- set when the password is actually changed
  ticket_hash        TEXT,                      -- SHA-256 of the step-3 cookie token, hex
  ticket_expires_at  TEXT,                      -- verified_at + 10 min
  request_ip         TEXT                       -- CF-Connecting-IP at issue time
);

CREATE INDEX idx_pw_reset_user       ON password_reset_otps (user_id);
CREATE INDEX idx_pw_reset_email      ON password_reset_otps (email_lower, created_at);
CREATE INDEX idx_pw_reset_ticket     ON password_reset_otps (ticket_hash);
CREATE INDEX idx_pw_reset_expires    ON password_reset_otps (expires_at);

-- Durable per-identifier counters for rate limiting. The Workers rate-limit
-- binding is per-datacentre and eventually consistent, so it is only a burst
-- guard; this table is the authoritative hourly cap.
CREATE TABLE password_reset_throttle (
  key         TEXT PRIMARY KEY,       -- 'email:<sha256(lower(email))>' or 'ip:<sha256(ip)>'
  count       INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL          -- ISO-8601; reset when now - window_start > 1h
);
```

Notes on the design choices:

- **`code_hash` is an HMAC, not a bare SHA-256.** A 6-digit code has only ~20 bits of
  entropy; a plain digest of it is trivially reversed by a rainbow table over all
  1,000,000 values. Keying with a Worker secret (`OTP_PEPPER`) that never touches the
  database removes that. This is the one place where a plain SHA-256 (fine for the
  128-bit session token in `sessions.id`) is **not** good enough.
- **`attempts` on the row**, not on a session — bounded verification tries even if the
  attacker discards cookies between guesses.
- **`consumed_at` gives single use** — checked in the same `UPDATE ... WHERE consumed_at IS NULL`
  so the check and the claim are atomic.
- **`ticket_hash` follows the existing session pattern**: random token in an httpOnly
  cookie, only the SHA-256 in the row.
- **`email_lower` is denormalised** so the rate-limit count works without touching `users`
  and works identically for emails that don't exist (there is no row to join to).
- **No cleanup job needed** (Workers Free has no Cron on this Worker today). Delete expired
  rows opportunistically at the start of each `requestPasswordReset` call:
  `DELETE FROM password_reset_otps WHERE expires_at < ?`. Volume is tiny.

Apply with:

```sh
npx wrangler d1 execute abpm-trainer --local  --file=migrations/0006_password_reset_otps.sql
npx wrangler d1 execute abpm-trainer --remote --file=migrations/0006_password_reset_otps.sql
```

---

## 4. End-to-end flow

Three steps, three server functions, one route with three UI states.

```
  ┌─ /forgot-password ───────────────────────────────────────────────┐
  │                                                                  │
  │ STEP 1  enter email                                              │
  │   → requestPasswordResetFn({ email })                            │
  │   → ALWAYS returns { ok: true } after a fixed-floor delay         │
  │   → if the account exists: 6-digit code emailed, row inserted     │
  │                                                                  │
  │ STEP 2  enter the 6-digit code                                   │
  │   → verifyPasswordResetOtpFn({ email, code })                    │
  │   → on success: sets httpOnly cookie abpm_pwreset (10 min),      │
  │     stamps verified_at + ticket_hash                             │
  │   → on failure: { ok: false } — "Invalid or expired code."       │
  │     attempts++; row dies at 5                                     │
  │                                                                  │
  │ STEP 3  choose a new password                                    │
  │   → resetPasswordFn({ password, confirmPassword })               │
  │   → validates the ticket cookie, rehashes with hashPassword(),   │
  │     UPDATE users, DELETE all sessions for that user,             │
  │     stamps consumed_at, clears both cookies                       │
  │   → redirect to /login with a "password updated" notice          │
  │     (deliberately does NOT auto-login)                            │
  └──────────────────────────────────────────────────────────────────┘
```

**Why a ticket cookie rather than re-posting the code in step 3:** it keeps the OTP out of
the final request, lets step 3 fail generically without re-checking the code, and means a
shoulder-surfed code is useless once the 10-minute ticket window closes. The alternative —
one combined `verifyAndReset({ email, code, password })` call — is simpler and would also
be defensible; see §8.

**Email content:** plain, short, no link. Something like:

> Your ABPM Trainer System password reset code is **481 902**.
> It expires in 10 minutes. If you didn't request this, you can ignore this email —
> your password has not changed.

No reset *link* at all. A code-only flow avoids token-in-URL leakage through Referer
headers and mail-scanner prefetching, which is a real concern with government mail
gateways.

---

## 5. Files, signatures, and where things go

### New files

| Path | Purpose |
| --- | --- |
| `migrations/0006_password_reset_otps.sql` | schema above |
| `src/utils/email.ts` | provider adapter: `sendEmail({ to, subject, html, text })` |
| `src/utils/passwordReset.ts` | all OTP logic, server-only, imports `~/utils/db` + `~/utils/auth` |
| `src/routes/forgot-password.tsx` | public route + the three server functions |
| `src/components/ForgotPassword.tsx` | the three-step form UI |
| `scripts/test/passwordReset.test.mjs` | unit tests against real SQLite, matching the existing harness |

### Modified files

| Path | Change |
| --- | --- |
| `src/utils/auth.ts` | export `timingSafeEqual` and `sha256Hex`; add `invalidateAllSessions(userId)` and `setUserPassword(userId, plaintext)` |
| `src/components/Auth.tsx:113` | `<a href="#">Forgot your password?</a>` → `<Link to="/forgot-password">` |
| `wrangler.jsonc` | add the `ratelimits` bindings (§6.1) |
| `README.md` | document `OTP_PEPPER` / `RESEND_API_KEY` / `EMAIL_FROM` under Deployment |
| `worker-configuration.d.ts` | regenerate via `npm run cf-typegen` after the wrangler change |

### Signatures

`src/utils/email.ts`

```ts
export type OutboundEmail = {
  to: string
  subject: string
  html: string
  text: string
}

/** Fire an email through the configured provider. Throws on non-2xx. */
export async function sendEmail(msg: OutboundEmail): Promise<void>
```

Reads `RESEND_API_KEY` and `EMAIL_FROM` off `env` from `cloudflare:workers`, exactly as
`src/utils/db.ts:5` reads `DB`. The whole body is one `fetch` to
`https://api.resend.com/emails`. Swapping to the Cloudflare binding later means replacing
that `fetch` with `env.EMAIL.send(...)` and nothing else.

`src/utils/auth.ts` — additions

```ts
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean   // un-private
export async function sha256Hex(value: string): Promise<string>          // un-private

/** Delete every session row for a user. Used after a password change. */
export async function invalidateAllSessions(userId: string): Promise<void>

/** Hash and store a new password, bumping updated_at. Does not touch sessions. */
export async function setUserPassword(userId: string, password: string): Promise<void>
```

`src/utils/passwordReset.ts`

```ts
export type ResetOutcome = { ok: true } | { ok: false }

/** Step 1. Always resolves to { ok: true }; never reveals whether the email exists. */
export async function requestPasswordReset(email: string, ip: string): Promise<{ ok: true }>

/** Step 2. Generic failure; increments attempts; issues the ticket cookie on success. */
export async function verifyPasswordResetOtp(
  email: string,
  code: string,
  ip: string,
): Promise<ResetOutcome>

/** Step 3. Reads the ticket cookie, sets the password, kills all sessions. */
export async function completePasswordReset(password: string): Promise<ResetOutcome>

// internal
function generateOtp(): string                                    // 6 digits, crypto.getRandomValues, rejection-sampled
async function hmacOtp(code: string): Promise<string>             // HMAC-SHA256(OTP_PEPPER, code) hex
async function consumeThrottle(key: string, limit: number): Promise<boolean>
```

`src/routes/forgot-password.tsx`

```ts
export const requestPasswordResetFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => { /* ... */ })

export const verifyPasswordResetOtpFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string; code: string }) => d)
  .handler(async ({ data }): Promise<ResetOutcome> => { /* ... */ })

export const resetPasswordFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { password: string; confirmPassword: string }) => d)
  .handler(async ({ data }): Promise<ResetOutcome> => { /* ... */ })

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordComp,
})
```

Placed at the top level of `src/routes/`, **not** under `_authed/` — this route must work
with no session. Mirrors how `src/routes/login.tsx` is structured (thin route file, real UI
in `src/components/`).

Client side uses the existing `useMutation` hook from `src/hooks/useMutation.ts`, following
`src/components/Login.tsx` as the template.

Getting the client IP inside a handler: `getRequestHeader('CF-Connecting-IP')` from
`@tanstack/react-start/server` (same module the existing code imports `getCookie`/`setCookie`
from). Treat a missing header as the literal `'unknown'` and rate-limit that bucket too.

---

## 6. Security details

### 6.1 Rate limiting — two layers

**Layer 1: Workers Rate Limiting binding** (burst guard, ~free, no storage).
Add to `wrangler.jsonc`:

```jsonc
"ratelimits": [
  { "name": "PW_RESET_REQUEST", "namespace_id": "2001", "simple": { "limit": 3,  "period": 60 } },
  { "name": "PW_RESET_VERIFY",  "namespace_id": "2002", "simple": { "limit": 10, "period": 60 } }
]
```

Call as `await env.PW_RESET_REQUEST.limit({ key: 'email:' + emailHash })` and again with
`'ip:' + ipHash`. Note the documented caveats: `period` must be **10 or 60 seconds only**,
counters are **per Cloudflare location** and eventually consistent, and the docs explicitly
warn against IP-keyed limits as a *primary* control because NATs and mobile carriers share
addresses. So this layer stops hammering, and nothing more.

**Layer 2: D1 `password_reset_throttle`** (the authoritative cap, strongly consistent).

| Bucket | Cap |
| --- | --- |
| per email address | **3 OTP requests / hour** |
| per IP address | **10 OTP requests / hour** |
| resend cooldown per email | **60 seconds** minimum between codes |
| verify attempts per code | **5**, then the row is dead (`attempts >= 5`) |
| live codes per user | **1** — issuing a new code expires all previous unconsumed rows for that user |

Critically: **the throttle is checked and incremented for emails that do not exist too.**
If unknown addresses skipped the counter, an attacker could distinguish "throttled" from
"not throttled" and enumerate that way. Hence `email_lower` on the throttle key rather than
`user_id`.

When throttled, step 1 still returns `{ ok: true }` — silently. Step 2 returns the same
generic failure as a wrong code.

### 6.2 Code length and entropy

**6 digits, uniformly random from `crypto.getRandomValues`**, rejection-sampled to avoid
modulo bias (draw a `Uint32`, discard values ≥ `4294967295 - (4294967295 % 1000000)`, then
`% 1000000`, zero-padded).

That is ~19.9 bits. On its own that is weak — but the security comes from the combination:

- 1,000,000 possible codes
- **5** attempts per code
- **10-minute** expiry
- one live code per user at a time
- ≤3 codes per email per hour

Probability of a blind guess succeeding against one issued code: 5 / 1,000,000 = **5 × 10⁻⁶**.
Sustained over an hour (3 codes × 5 attempts) it is 1.5 × 10⁻⁵. Acceptable for this
application. If Dan wants more margin, **8 digits** costs nothing in implementation and
takes it to 5 × 10⁻⁸ — the only cost is typing. Do **not** drop below 6.

Display as `481 902` (space-grouped) in the email for readability; strip all non-digits
server-side before comparing.

### 6.3 No user enumeration

This is the requirement most likely to be broken accidentally. Rules:

1. **Identical response body.** Step 1 returns exactly `{ ok: true }` in every case:
   unknown email, known email, throttled, malformed, provider outage. The UI always advances
   to the code screen with "If an account exists for that address, we've sent a code."
2. **Identical status code.** Always 200. No 404, no 429 — a 429 on step 1 is itself a
   signal, so throttling is silent.
3. **Identical timing.** The dangerous asymmetry is that the "user exists" path does an
   HMAC, a D1 insert, and an HTTPS call to Resend, while the "no such user" path does
   almost nothing. Two mitigations, use both:
   - **Do not await the provider call in the response path.** Kick off `sendEmail()` and
     let it settle independently of the response (`ctx.waitUntil`-equivalent). The user's
     wait must never be a function of the mail provider's latency.
   - **Pad every step-1 response to a fixed floor** — e.g. record `Date.now()` at entry and
     `await` the remainder of a 400 ms budget before returning. Do this on *every* path,
     including validation failures. 400 ms comfortably exceeds the real work.
   - Also: do the HMAC and the throttle write on both paths. Never `return` early on
     "user not found" — set a flag and keep walking the same code path.
4. **Step 2 leaks nothing either.** Wrong code, expired code, no code ever issued, unknown
   email, attempts exhausted — all return `{ ok: false }` with the single string
   *"Invalid or expired code."* Also pad step 2 to a fixed floor, since "no row found" is
   much faster than "row found, HMAC computed, compared".
5. **No email echoed back.** The step-2 and step-3 screens must not display the address, and
   `resetPasswordFn` must not include it in any response.
6. **Nothing in logs.** Never `console.log` the email, the code, or the ticket. The Worker
   has `observability.enabled = true` in `wrangler.jsonc`, so anything logged is retained
   and readable in the dashboard. (Note: `src/routes/__root.tsx:35` already logs user role
   data — worth cleaning up separately, but out of scope here.)

### 6.4 Constant-time comparison

Compare the **HMAC digests**, not the codes:

```ts
const candidate = await hmacOtp(normalisedCode)   // hex
timingSafeEqual(hexToBytes(candidate), hexToBytes(row.code_hash))
```

`timingSafeEqual` already exists at `src/utils/auth.ts:61` and is correct (XOR-accumulate,
length-checked, no early return) — it just needs exporting. Never use `===` on the code or
the digest.

Same for the reset ticket: SHA-256 the cookie token and look it up by `ticket_hash`; since
the ticket is 256 bits of randomness, an indexed equality lookup is fine there (identical
reasoning to the existing `sessions.id` lookup at `src/utils/auth.ts:141`).

### 6.5 Expiry windows

| Thing | Window |
| --- | --- |
| OTP code | **10 minutes** from issue |
| Reset ticket (cookie + `ticket_hash`) | **10 minutes** from successful verification |
| Resend cooldown | 60 seconds |

10 minutes is the usual balance: long enough to survive a slow government mail gateway,
short enough that a code sitting in a shared inbox goes stale quickly. Expiry is enforced
**in the SQL predicate**, not in JS after the fetch — `WHERE expires_at > ?` — so a clock
mistake in one place cannot open the window.

### 6.6 Session invalidation after a password change

In `resetPasswordFn`, in this order:

```sql
UPDATE users
   SET password_hash = ?, updated_at = ?
 WHERE id = ?;

DELETE FROM sessions WHERE user_id = ?;         -- every device, everywhere

UPDATE password_reset_otps
   SET consumed_at = ?, ticket_hash = NULL
 WHERE id = ? AND consumed_at IS NULL;

DELETE FROM password_reset_otps                  -- kill any other live codes
 WHERE user_id = ? AND consumed_at IS NULL;
```

Then `deleteCookie('abpm_pwreset')` and `deleteCookie('abpm_session')`, and redirect to
`/login`. **Do not start a new session** — someone who just proved control of the mailbox
should still type the new password once, and it makes the "all devices signed out" promise
literally true.

D1 has no multi-statement transactions through the `prepare().run()` helpers in
`src/utils/db.ts`, but it does support `db().batch([...])`. Use `batch()` so the password
update and the session delete land together. Order matters if it ever splits: update the
password **first**, so a partial failure leaves old sessions alive with a new password
rather than the reverse.

Also worth adding to the email side: after a successful reset, send a second, non-actionable
notification ("your password was changed") to the same address. That is how a user finds out
if someone else did it. Cheap, and it stays inside the free tier.

### 6.7 Secrets

Three values, all Worker secrets, none in `.env` and none in the repo:

```sh
npx wrangler secret put OTP_PEPPER        # 32 random bytes, base64 — pepper for the OTP HMAC
npx wrangler secret put RESEND_API_KEY    # from the Resend dashboard
npx wrangler secret put EMAIL_FROM        # e.g. "ABPM Trainer System <noreply@abpmtrainer.my>"
```

(`EMAIL_FROM` is not secret and could be a plain `vars` entry in `wrangler.jsonc` instead —
either is fine, keeping it with the others is simpler.)

Read them via `env` from `cloudflare:workers`, following `src/utils/db.ts:5`, and throw a
clear startup error if `OTP_PEPPER` or `RESEND_API_KEY` is missing rather than silently
sending nothing. Run `npm run cf-typegen` afterwards so `worker-configuration.d.ts` picks
them up and `npm run typecheck` stays green.

Local dev: put them in `.dev.vars` (Wrangler's local secret file), and **add `.dev.vars` to
`.gitignore`** — it is not there today. `.env` should be left alone; it is untracked and
holds unrelated legacy Supabase values (which, separately, are worth rotating now that the
Supabase stack is gone).

Rotating `OTP_PEPPER` invalidates every outstanding code. That is fine — it is a 10-minute
blast radius — but do it deliberately.

### 6.8 Other hardening

- **Password policy on step 3.** There is currently no policy anywhere in the codebase.
  Minimum 10 characters, enforced **server-side** in `resetPasswordFn` (client-side too, for
  UX). Reject the case where the new password equals the old one (`verifyPassword` against
  the current hash before overwriting).
- **Cookies.** `abpm_pwreset`: `httpOnly: true, secure: true, sameSite: 'lax', path: '/forgot-password', maxAge: 600`.
  Narrower `path` than the session cookie, and a short `maxAge`. Match the existing options
  at `src/utils/auth.ts:125`.
- **CSRF.** TanStack server functions are POSTs with a JSON content type, which blocks the
  simple-request cross-origin case, and `sameSite: 'lax'` covers the ticket cookie. Step 1
  and step 2 carry no ambient authority, so the exposure is limited to step 3 — and an
  attacker cannot obtain a valid ticket. No extra token needed, but worth a comment in the code.
- **Do not reuse `signIn`'s "upgrade bcrypt on login" path here.** A reset always writes a
  fresh PBKDF2 hash via `hashPassword()`, which is what `setUserPassword` should call.

---

## 7. Testing

Extend the existing harness (`scripts/test/`, run with `npm test`, real SQLite via
`node --experimental-strip-types`). Cases worth writing:

1. Unknown email → `{ ok: true }`, no row inserted, no send attempted.
2. Known email → exactly one row, `code_hash` is not the code, `expires_at` ≈ +10 min.
3. Wrong code five times → sixth attempt fails even with the *correct* code.
4. Expired code → fails.
5. Correct code → ticket issued; **replaying the same code** → fails (`verified_at` set).
6. Full happy path → `users.password_hash` changed, `verifyPassword(new)` true,
   `verifyPassword(old)` false.
7. **Session invalidation:** seed three `sessions` rows for the user, complete a reset,
   assert zero rows remain and that a session row for a *different* user survives.
8. Throttle: 4th request within the hour for the same email is suppressed but still
   returns `{ ok: true }`.
9. Enumeration: assert the step-1 response bodies for a known and an unknown address are
   byte-identical.

Timing-equality is not practically unit-testable; the fixed-floor pad is the mitigation, and
a comment in the code should say so.

Also add a manual entry to `scripts/smoke.mjs` or the deploy checklist: send one real code
to a real mailbox on each of Gmail and `bomba.gov.my` after the DNS records go live, and
check it lands in the inbox rather than spam.

---

## 8. Open questions

**Answered:**

1. ~~Sending domain~~ → `abpmtrainer.my`, Dan controls the DNS.
2. ~~Workers Paid?~~ → No, Free plan. Resend, not the Cloudflare binding.

**Still open — Dan's call:**

3. **From-address.** `no-reply@abpmtrainer.my` is what the setup doc assumes and what
   `EMAIL_FROM` should be set to. Confirm, or pick a replyable address instead.
   Note: a send-only address needs **no mailbox and no email hosting** — Resend
   authenticates via DKIM on the domain. The domain has no MX records today and
   sending will still work. Details and the replyable-address alternative are in
   `docs/password-reset-setup.md` §2d.
4. **Two-step or one-step?** Built as two steps: verify the code, then set the password on
   a separate screen with a ticket cookie. A single `verifyAndReset({ email, code, password })`
   would be fewer moving parts. Easy to collapse later if preferred.
5. **Code length: 6 or 8 digits?** Built with 6. Changing it is one constant
   (`CODE_DIGITS` in `src/utils/passwordReset.ts`) — 8 digits would give 1,000× more
   margin at the cost of more typing.
6. **What happens to a user with no reachable email?** Some seeded addresses look like data
   entry rather than live mailboxes (there is a literal `@MUHAMMAD` in the seed). Is the
   fallback "ask an ADMIN to set a password", and if so is there an admin UI for that today?
   (`adminCreateUser` exists; an admin *password reset* does not — **not built**.)
7. **Email language.** The user guide is dwi bahasa (commit `c4aa6ab`). The OTP email and the
   reset screens are currently English only. Bahasa Malaysia, or both?
8. **Should `email_confirmed_at` matter?** Every migrated account has it set, so the code
   currently ignores the column. Refusing to send when it's `NULL` would be another silent
   branch that must not change the response shape or timing.
9. **Blocked during research:** `resend.com/docs/dashboard/domains/introduction` was not
   approved for fetching, so the exact DKIM/SPF record set must be read off the Resend
   dashboard when the domain is added. The record *shapes* in
   `docs/password-reset-setup.md` §2 come from secondary sources; the Cloudflare figures
   come from Cloudflare's own docs.

---

## 9. Build status

| # | Step | State |
| --- | --- | --- |
| 1 | Settle sending domain / plan questions | done (§8) |
| 2 | `migrations/0006_password_reset_otps.sql` | **written**, not yet applied to `--remote` |
| 3 | `src/utils/auth.ts` — export `timingSafeEqual`, `sha256Hex`, `newToken`; add `invalidateAllSessions`, `setUserPassword` | **done**, purely additive |
| 4 | `src/utils/email.ts` — Resend adapter, degrades to a logged no-op with no key | **done** |
| 5 | `src/utils/emailTemplates.ts` | **done** (English only — see Q7) |
| 6 | `src/utils/passwordReset.ts` + 26 unit tests | **done**, all passing |
| 7 | `src/routes/forgot-password.tsx` server functions | **done** |
| 8 | `src/components/ForgotPassword.tsx`, link wired in `Auth.tsx` | **done** |
| 9 | `wrangler.jsonc` rate-limit bindings | **done** |
| 10 | `wrangler secret put` ×3, `cf-typegen` | **Dan** — setup doc §3 |
| 11 | DNS records on `abpmtrainer.my` | **Dan** — setup doc §2 |
| 12 | Real end-to-end send to Gmail + `bomba.gov.my` | **Dan** — setup doc §5 |
| 13 | Apply `0006` to `--remote`, deploy | **Dan** — setup doc §1, §4 |

Verified locally: `npm test` → 27 + 26 passing; `tsc --noEmit` clean. The production
build (`npm run build`) was **not** run — this workspace's `node_modules` was installed
on Windows, so rollup's Linux native binary is absent. Worth running once on your machine
before pushing.

`src/routeTree.gen.ts` was regenerated to pick up the new route; the diff is
additions only.

---

## Sources

- [Cloudflare Email Service overview](https://developers.cloudflare.com/email-service/)
- [Cloudflare Email Service — pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Cloudflare Email Service — limits](https://developers.cloudflare.com/email-service/platform/limits/)
- [Cloudflare Email Service — configure send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [MailChannels — End of Life notice for Cloudflare Workers](https://support.mailchannels.com/hc/en-us/articles/26814255454093-End-of-Life-Notice-Cloudflare-Workers)
- [Resend free tier explained (2026)](https://automationatlas.io/answers/resend-free-tier-explained-2026/)
- [Resend pricing 2026](https://nuntly.com/resend-pricing)
- [Brevo free plan 2026](https://www.emailsoftwareinsights.com/reviews/brevo/pricing/free-plan/)
- [SendGrid free tier: what happened (2026)](https://blog.mystrika.com/sendgrid-free-tier/)
- [Transactional email services compared (2026)](https://www.emailtooltester.com/en/blog/best-transactional-email-service/)
