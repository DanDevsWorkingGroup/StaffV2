# Password reset — production behaviour and go-live

Companion to [`how-it-works.md`](how-it-works.md) (mechanism + threat model) and
[`password-reset-setup.md`](password-reset-setup.md) (first-time account/DNS
setup). This doc is the **behaviour spec** and the **`main` / `abpm-trainer`
go-live runbook**, written after the feature was validated end-to-end on
`abpm-trainer-dev` and `abpm-trainer-staging`.

---

## 1. Status

| Environment | Feature | Migration `0006` | Secrets | Verified end-to-end |
|---|---|---|---|---|
| `abpm-trainer-dev` | ✅ deployed | ✅ applied | ⬜ none (uses insecure fallback pepper; no email) | ✅ flow works, code read from Worker log |
| `abpm-trainer-staging` | ✅ deployed | ✅ applied | ✅ all 3 set | ✅ **real email delivered to Gmail inbox**, Resend `200` |
| `abpm-trainer` (**prod**) | ⬜ not promoted | ⬜ **not applied** | ⬜ **none set** | ⬜ |

Two defects were found during dev/staging validation and fixed before promotion —
see §6.

---

## 2. Expected behaviour in production

### 2.1 The user flow

1. **`/login` → "Forgot your password?"** → `/forgot-password`.
2. **Step 1 — enter email.** Always shows the same "if an account exists, we've
   sent a code" screen, whether or not the address is registered, with the same
   ~400 ms delay. A registered address gets a 6-digit code emailed from
   `ABPM Trainer System <no-reply@abpmtrainer.my>`.
3. **Step 2 — enter the 6-digit code.** Valid for **20 minutes**, single-use, **5
   wrong attempts** locks that code.
4. **Step 3 — choose a new password.** Minimum **10 characters**, must differ from
   the current one. On success: password is updated and **every session for that
   user is destroyed** ("signed out on all devices"), a "your password was
   changed" notice is emailed, and the user returns to `/login`.

### 2.2 Timings and limits (constants in `src/utils/passwordReset.ts`)

| Thing | Value | Constant |
|---|---|---|
| Code length | 6 digits | `CODE_DIGITS` |
| Code lifetime | **20 min** (deliberately not 10 — see §5) | `CODE_TTL_MS` |
| Wrong-guess cap per code | 5 | `MAX_ATTEMPTS` |
| Step-3 ticket lifetime | 10 min after the code verifies | `TICKET_TTL_MS` |
| Resend cooldown | 60 s between codes for one account | `RESEND_COOLDOWN_MS` |
| Requests per **email** per hour | **3** | `MAX_REQUESTS_PER_EMAIL_PER_HOUR` |
| Requests per **IP** per hour | 10 | `MAX_REQUESTS_PER_IP_PER_HOUR` |
| Response floor (timing-oracle defence) | 400 ms | `RESPONSE_FLOOR_MS` |
| Min new-password length | 10 | `MIN_PASSWORD_LENGTH` |

### 2.3 Rate limiting — what applies to whom

There is **no device/cookie fingerprint**. Two dimensions, each with a short
burst guard (Cloudflare rate-limit binding) *and* an hourly cap (D1
`password_reset_throttle`, keys stored **SHA-256-hashed**):

| Dimension | Burst (`PW_RESET_REQUEST`) | Hourly cap |
|---|---|---|
| **Email address** (the value typed in the form, lowercased) | 3 / 60 s | **3 / hour** |
| **Client IP** | 3 / 60 s | 10 / hour |

Verify step: `PW_RESET_VERIFY` = 10 / 60 s per IP, plus the per-code 5-attempt cap.

Consequences:

- Requesting a reset for one address **3× in an hour** blocks the 4th — from any
  device, any network. Switching devices does not help; switching networks only
  loosens the (higher) IP cap.
- The hourly window is **fixed from the first request**, not rolling. It resets to
  zero on the next request after the hour elapses.
- The cap is enforced for **unregistered addresses too**, so the throttle can't
  be used to enumerate accounts.
- A blocked request is **silent**: no code row, no email, identical screen. In
  Worker logs it simply produces no `[email]` line.

### 2.4 What a leaked database snapshot does NOT give an attacker

- **Codes**: stored only as `HMAC-SHA256(OTP_PEPPER, code)`. The pepper lives in
  Worker secrets, never in D1. Without it, a 6-digit code cannot be reversed.
- **Tickets / sessions**: stored only as SHA-256 of a 32-byte token.
- **Throttle keys**: SHA-256 of `email:…` / `ip:…` — no plaintext addresses or IPs.

### 2.5 Email delivery

- Sent via **Resend** (`POST https://api.resend.com/emails`), a plain outbound
  `fetch()` — works on Workers Free.
- The send is `waitUntil`'d (not awaited into the response), so it completes
  reliably without adding Resend's latency to the user's wait. **This was a
  fix — see §6.**
- If `RESEND_API_KEY` is unset the flow still works; the code is simply not
  emailed (`sendEmail` logs and returns `false`, nothing 500s). **On prod the
  key must be set** or every reset is a dead end.
- `no-reply@abpmtrainer.my` is a valid `From` with **no mailbox** — DKIM proves
  the domain, not a mailbox. Bounces route to Resend's dashboard.

### 2.6 Failure modes and how they present

| Situation | User sees | Logs / dashboard |
|---|---|---|
| Unregistered email | Same "code sent" screen | no `[email]` line, no `POST /emails` |
| Rate-limited | Same "code sent" screen | no `[email]` line |
| `RESEND_API_KEY` missing | Same "code sent" screen; **no email ever arrives** | `[email] no RESEND_API_KEY configured …` |
| Resend rejects (domain unverified, bad `From`) | Same screen; no email | `[email] failed to send: … <status> …`; Resend log shows the error |
| Code expired / 5 attempts used | "Invalid or expired code" at step 2 | — |
| Ticket expired (slow on step 3) | "Invalid or expired code" at step 3 | — |
| `OTP_PEPPER` unset | Flow works, but codes hashed with the **insecure hardcoded pepper** | `[password-reset] OTP_PEPPER is not set — using an insecure development pepper` |

---

## 3. Production go-live runbook (`main` / `abpm-trainer`)

Do these **in order**. The code degrades safely if the migration lags (only
`/forgot-password` 500s; login is untouched — no other code path reads the
`password_reset_*` tables), but migration-first is the correct sequence.

### 3.1 Apply migration `0006` to the prod D1

```sh
npx wrangler d1 execute abpm-trainer --remote --file=migrations/0006_password_reset_otps.sql
```
`abpm-trainer` is D1 `08ce77d6-0eac-478b-a660-7ea049f9a295`. It only adds
`password_reset_otps` + `password_reset_throttle` + their indexes.

### 3.2 Set the three prod secrets

```sh
# 32 random bytes — generate locally, never paste into chat:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put OTP_PEPPER     --name abpm-trainer   # MANDATORY

npx wrangler secret put RESEND_API_KEY --name abpm-trainer   # Resend → API Keys → "Sending access"
npx wrangler secret put EMAIL_FROM     --name abpm-trainer   # ABPM Trainer System <no-reply@abpmtrainer.my>
```

- **`OTP_PEPPER` is not optional in prod.** Without it the Worker falls back to
  `insecure-development-pepper`, which is in the source — a leaked D1 snapshot
  would then expose live codes.
- The Resend **domain `abpmtrainer.my` is already Verified** (one-time, covers all
  environments), so the same key/from-address that work on staging work on prod.
  A separate prod API key is fine but not required.
- Secrets persist across deploys; this is one-time.

### 3.3 Promote `staging → main`

PR `base: main` ← `compare: staging` (branch policy allows only this source into
`main`). This currently also carries the `052465a` "Point abpmtrainer.my at the
Worker" commit — expected, it's the custom-domains record catching up. Merge →
Workers Build deploys `abpm-trainer`.

### 3.4 Verify on prod

- Log in normally with a real account — unchanged.
- `/login` → "Forgot your password?" lands on `/forgot-password`.
- Run **one real reset** end-to-end with a mailbox you control. Confirm:
  - code arrives (check All Mail / tabs; first send from the domain may sort oddly)
  - the code works once and is refused on reuse
  - after completion, another logged-in session for that account is signed out
  - Resend dashboard shows `delivered`

---

## 4. Operations

### 4.1 Monitoring

- **Resend → Logs / Emails**: every send, with `delivered` / `bounced` / `failed`
  and the provider reason. This is the authoritative delivery record.
- **`wrangler tail abpm-trainer`**: `[email] failed to send: …` and
  `[password-reset] …` lines. (`[password-reset][dev-only] code for …` only ever
  fires when `APP_ENV === 'dev'` — never on staging or prod.)
- **D1**: `SELECT count(*) FROM password_reset_otps WHERE consumed_at IS NULL` for
  outstanding codes; `password_reset_throttle` for current pressure.

### 4.2 "I'm locked out / no email"

1. Check Resend Logs for that address. `delivered` → tell the user to check spam
   / other tabs / wait (greylisting, §5). `bounced`/`failed` → read the reason.
   No entry → they were rate-limited (§2.3) or the address isn't registered.
2. Rate-limited: they wait for the hour window to roll, or an admin clears their
   row: `DELETE FROM password_reset_throttle WHERE key = <sha256('email:'||lower(addr))>`.
   (Only an operator can compute the key; it is not stored in plaintext.)
3. As a last resort, an ADMIN can set a temporary password directly (there is no
   admin-driven reset UI; it is a manual `users.password_hash` update via
   `hashPassword()` — see `adminCreateUser` for the pattern).

### 4.3 Rotating `OTP_PEPPER`

`wrangler secret put OTP_PEPPER --name abpm-trainer` with a new value.
Invalidates every outstanding code immediately — a ≤20-minute blast radius.
Rotate freely, just deliberately.

### 4.4 Tuning the throttle

`MAX_REQUESTS_PER_EMAIL_PER_HOUR = 3` is deliberately tight. Combined with
government-gateway greylisting (5–15 min first-delivery delay), a user who
requests, waits, and requests again could plausibly hit 3/hour if their mail is
slow. The 20-minute code TTL exists to reduce the urge to spam "resend". If
support sees repeated lock-outs, raise the constant (a normal PR through
`dev → staging → main`) rather than widening anything else.

---

## 5. Deliverability to `@bomba.gov.my` / `@abpm.gov.my` — before you announce

~38 of 154 accounts are government addresses. Their gateways are strict about a
brand-new sending domain.

- **Greylisting**: many defer the first message from an unknown sender with a
  temp failure and only accept it on the retry, ~5–15 min later. Normal, not a
  misconfiguration — and the reason the code TTL is 20 min, not 10.
- **Authentication is mandatory** there: SPF + DKIM + **DMARC** (all four DNS
  records are in place and verified). `p=none` is correct — don't escalate.
- **Reputation builds over days/weeks** of low-volume, low-complaint sending.
  Early messages may be delayed even when perfectly authenticated.

**Test each major domain with a real mailbox before launch** — `@bomba.gov.my`,
`@abpm.gov.my`, `@gmail.com`, `@yahoo.com` cover ~120 of 154. Watch the Resend
delivery events. If `bomba.gov.my` rejects: ask their IT to allowlist
`send.abpmtrainer.my` (weeks of lead time — ask early); or switch the provider in
`src/utils/email.ts` to Brevo; or fall back to admin-set passwords for those
users.

---

## 6. Defects found and fixed this cycle

| PR | Symptom | Cause | Fix |
|---|---|---|---|
| #9 `fix/pwreset-ticket-cookie-path` | Step 3 always failed with "Invalid or expired code" despite a valid ticket row in D1 | Ticket cookie was scoped `path=/forgot-password`; the three steps are `createServerFn` calls the browser POSTs to `/_serverFn/…`, so the cookie was never sent back on step 3 | `TICKET_COOKIE_PATH = '/'` (cookie is still httpOnly + secure + sameSite=lax + single-use, SHA-256-only in D1) |
| #11 `fix/pwreset-email-waituntil` | Domain verified, secrets set, OTP row written — but **zero `POST /emails` in Resend**; no email ever sent | `void sendEmail(...)` left the `fetch` to Resend untracked; the Workers runtime cancels in-flight I/O when the handler returns | `waitUntil(sendEmail(...))` from `cloudflare:workers` — keeps the isolate alive for the send without adding latency to the response |

Both were missed by the 34-test suite because its stubs don't model browser
cookie-path scoping or Worker I/O cancellation. Regression assertions were added
in each PR (cookie `path === '/'`; `waitUntil` passthrough in the stub).
