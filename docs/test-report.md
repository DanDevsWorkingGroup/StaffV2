# Password reset — full module test report

Run on 2026-09-07 against the code as committed.

**Headline: no defects found.** 49 automated checks pass, including 23 adversarial
probes written specifically to break the module. No security issue, no crash, no
data-integrity problem surfaced. The enhancement list below is genuinely optional
with **one exception** (§3.1).

---

## 1. What was run

| Check | Result |
|---|---|
| `npm test` (postgrest suite) | **27 passed, 0 failed** |
| `npm test` (password-reset suite) | **26 passed, 0 failed** |
| `tsc --noEmit` | **clean, exit 0** |
| Adversarial probes (3 batches, not committed) | **23 passed, 0 failed** |
| Prettier | see §1.1 — not a real finding |
| `npm run build` | **BLOCKED** — see §2 |
| `wrangler dev` / miniflare end-to-end | **BLOCKED** — see §2 |

### 1.1 Prettier

`prettier --check` flags **all 53 source files**, including every pre-existing one
(`db.ts`, `postgrest.ts`, `rbac.ts`, `Login.tsx`…). There is no Prettier config in
the repo and CI does not run it, so this is Prettier's defaults disagreeing with
the project's house style — not a regression from the new code. **No action
needed.** If you ever want it enforced, add a config and reformat everything in one
commit, separately from this feature.

---

## 2. What could NOT be tested from here, and why

Being explicit rather than glossing:

**`node_modules` in this workspace was installed on Windows.** It contains only
Windows-native binaries:

```
node_modules/@cloudflare/workerd-windows-64     ← no workerd-linux-64
node_modules/@rollup/rollup-win32-x64-gnu       ← no rollup-linux-x64-gnu
node_modules/@rollup/rollup-win32-x64-msvc
```

Consequently, from the Linux side:

| Blocked | Cause |
|---|---|
| `npm run build` (Vite/Rollup) | `Cannot find module '@rollup/rollup-linux-x64-gnu'` |
| `wrangler dev`, `wrangler d1 --local`, miniflare | `workerd` has no Linux binary |
| True HTTP end-to-end through the Worker runtime | depends on the above |

**What this means in practice:** the OTP logic, D1 queries, hashing, throttling,
session invalidation and email templates are all fully exercised (against **real
SQLite** via `node:sqlite`, using the **real production schema**, including the new
`0006` migration). What is *not* exercised is the TanStack Start server-function
transport, cookie handling in the actual Workers runtime, and the React render.

**Two things you should do on your machine**, since CI runs `npm run build` and
will fail the pipeline if either is wrong:

1. `npm run build` — confirms the new route and component compile and bundle.
2. `npm run dev`, then click through `/forgot-password` once.

Neither is expected to fail — `tsc --noEmit` passing covers most of what would
break — but neither has been proven here.

*(A Linux `npm install` would unblock this, but that would rewrite your
`node_modules`, so I did not do it.)*

---

## 3. Adversarial probe results

All passed. Grouped by what was attacked.

### Code lifecycle

| Probe | Result |
|---|---|
| Expired code rejected | ✅ |
| Code expiring exactly *now* (`expires_at == now`) treated as expired | ✅ |
| Consumed code rejected after a completed reset | ✅ |
| Superseded code (new request issued) rejected; only one row survives | ✅ |
| 5 wrong guesses then the **correct** code → refused, row deleted | ✅ |
| **Concurrent verify of the same correct code → exactly one winner** | ✅ the guarded `UPDATE` closes the race as designed |
| Rotating `OTP_PEPPER` invalidates outstanding codes | ✅ |

### Ticket handling

| Probe | Result |
|---|---|
| Ticket reuse after completion | ✅ rejected |
| Forged random ticket cookie | ✅ rejected, **password verifiably unchanged** |
| Expired ticket | ✅ rejected |
| Missing cookie | ✅ rejected |
| Requesting a new code invalidates an outstanding ticket | ✅ |

### Input abuse

| Probe | Result |
|---|---|
| Unknown email | ✅ uniform `{ok:true}` |
| Malformed: `notanemail`, `@`, `"   "`, `""`, `a@`, `@b` | ✅ all return `{ok:true}`, none throw |
| `null` / `undefined` email | ✅ no throw |
| 100 KB email, 100 KB code | ✅ no throw, rejected cleanly |
| Unicode email (`测试@例子.中国`) | ✅ handled |
| Emoji password (`🔥🔥🔥pässwörd-ünïcode`) | ✅ set and verified correctly |
| Arabic-Indic digits (`٧٧٧٧٧٧`) as code | ✅ rejected (JS `\d` is ASCII-only — correct here) |
| SQL injection in email (`' OR 1=1; DROP TABLE users;--@x.com`) | ✅ parameterised, `users` intact |
| 10,000-character password | ✅ accepted and verifiable (PBKDF2 has no 72-byte bcrypt limit) |
| Verifying user A's code while submitting user B's email | ✅ rejected — codes are bound to their address |

### Password rules

| Probe | Result |
|---|---|
| Reuse of current password | ✅ refused |
| Reuse of current password on a **legacy bcrypt** account | ✅ refused |
| Under 10 characters | ✅ refused, **and nothing written** — sessions survive |
| Mismatched confirmation | ✅ refused |
| Legacy bcrypt account upgraded to PBKDF2 by the reset | ✅ |

### Failure modes

| Probe | Result |
|---|---|
| Resend returns HTTP 500 mid-flow | ✅ user still gets `{ok:true}`; **code row still written**, so the code stays usable if the mail lands later |
| `fetch` throws (network down) | ✅ no crash |
| D1 table missing on step 1 | ✅ error swallowed, still `{ok:true}` — a 500 here would only occur for real accounts and would itself leak |
| D1 table missing on step 2 | ✅ generic failure, no crash |

### Rate limiting — measured, not assumed

| Probe | Measured |
|---|---|
| 10 requests for one address from **10 distinct IPs** | **3 emails sent** — per-email hourly cap holds against IP rotation |
| One IP requesting **20 distinct addresses** | **10 emails sent** — per-IP cap holds |
| Two rapid requests within 60 s | **1 email sent** — resend cooldown works (see §4.2) |

### Timing symmetry — measured

The anti-enumeration property most likely to regress silently, so it was measured
rather than assumed:

```
Step 1:  known account   400.9 ms   |  unknown account   400.9 ms  |  delta 0.0 ms
Step 2:  wrong code      400.8 ms   |  no pending reset  401.0 ms  |  delta 0.2 ms
```

The 400 ms floor is applied on every path and the difference is unmeasurable.

---

## 4. Enhancements

Honest severity. Most of this module needs nothing.

### 4.1 Before launch — one item

**① No recovery path for users whose email is unreachable.** *(Severity: medium —
operational, not security)*

The seed contains addresses that are not live mailboxes — there is a literal
`@MUHAMMAD` in `0002_seed.sql`, and some of the 154 may be stale or mistyped. Those
users **cannot reset their password at all**, and there is no admin-side fallback.

Confirmed by audit: `AddTrainerModal`
(`src/routes/_authed/trainer-overview/index.tsx:1218`) can set a password, but
**only at creation time** — it calls `auth.admin.createUser`. The edit flows
(`trainer-overview/edit.$id.tsx`, `$id.tsx`) contain **no password field at all**.
So there is no way for an ADMIN to set a password on an *existing* account short of
manual SQL.

This is the only finding I'd call blocking, because it's a permanent lockout with
no workaround short of manual SQL. Two options:

- **Minimum:** an ADMIN-only "set password for user" server function, reusing
  `setUserPassword()` + `invalidateAllSessions()` (both already exist and are
  tested). Maybe 40 lines plus a small UI.
- **Cheaper stopgap:** audit the 154 addresses now, fix the broken ones, and accept
  manual SQL for the rest.

Also here, though not a code issue: **run `npm run build` and click through the flow
locally** (§2).

### 4.2 Worth doing soon

**② No feedback when the resend cooldown blocks you.** *(UX — likely support
tickets on day one)*

Measured above: a second request within 60 s silently sends nothing while telling
the user "we've sent a code". Someone who doesn't see the mail will press resend,
get the same reassuring message, and receive nothing.

Clean fix that leaks nothing: disable the resend control client-side for 60 s with a
visible countdown. Because it's driven by the client's own clock and not a server
response, it reveals nothing about whether the account exists.

**③ No show/hide toggle on the new-password fields.** *(UX / consistency)*

Full repo audit — there are exactly **three** password inputs in the whole app:

| # | Location | Screen | Toggle? | Implementation |
|---|---|---|---|---|
| 1 | `src/components/Auth.tsx:46` | Login | ✅ | `useState` + inline **SVG** eye / eye-off, dark theme |
| 2 | `src/routes/_authed/trainer-overview/index.tsx:1340` (`AddTrainerModal`) | Admin → add trainer | ✅ | `useState` + **emoji** 👁️/🔒, light theme, `w-11` touch target |
| 3–4 | `src/components/ForgotPassword.tsx:203, 218` | Password reset | ❌ | none |

So it isn't only the login page — the admin "Add Trainer" modal has one too. The
reset screen is the **only** one missing it, and it's the worst place to miss it:
users type a ≥10-character password **twice, blind**, often on a phone.

**The two existing toggles are copy-pasted, not shared, and they diverge:**

- Different icons — inline SVG vs emoji.
- **Opposite conventions.** `Auth.tsx` shows a *crossed-out* eye while the password
  is visible (meaning "click to hide"); the trainer modal shows an *open* eye 👁️
  while visible. Same gesture, contradictory affordance.
- Different themes (dark card vs light modal) and different hit-target sizing.

Both do correctly toggle `aria-label` between "Show password" / "Hide password".

**Is a shared `PasswordInput` worth extracting?** Marginally yes — but for
*consistency*, not DRY. Four inputs across three files is below the threshold where
duplication really hurts, and the two themes mean the component needs a
`className`/variant prop, so it isn't free. The stronger argument is that the two
existing toggles are already visibly inconsistent with each other, and a third
hand-rolled copy would make that worse. Rough shape: a ~40-line component taking
`name`, `id`, `label`, `autoComplete` and a theme variant, replacing all four call
sites.

If you only want the quick win: copy the SVG version from `Auth.tsx` into
`ForgotPassword.tsx` (closest theme match — both are the dark card) and leave the
refactor for later.

**④ `password_reset_throttle` is never swept.** *(Known; now quantified)*

Measured: 50 distinct (email, IP) pairs produced **100 rows, none ever deleted**.
Expired `password_reset_otps` rows *are* swept; throttle rows are not. At your scale
this is kilobytes a year and harmless, but it's unbounded. One line in the existing
opportunistic sweep fixes it:

```sql
DELETE FROM password_reset_throttle WHERE window_start < <24h ago>
```

**⑤ Decide the email language.** *(Open question, now with evidence)*

I checked: Malay strings appear **only** in `user-guide.tsx` — every other screen in
the app is English. So the English-only reset UI is *consistent with the rest of the
app*, and I'd leave the UI alone. The **email** is the real question, since the
dwi-bahasa user guide suggests trainers expect BM. A bilingual email (BM above,
English below) is the low-risk answer and costs one template edit.

**⑥ Dead "Change Password" button on the profile page.** *(new — found during the
password-input audit)*

`src/routes/_authed/profile/index.tsx:254` renders a styled **"Change Password"**
button inside an "Account Security" card, with hover states — and **no `onClick`,
no handler, no form**. It is visible to every logged-in user and does nothing when
clicked. Exactly the same dead-link pattern as the old `href="#"` forgot-password
link that this work replaced.

Not a security issue, but users will find it. Options: point it at
`/forgot-password` (works today, though it makes a logged-in user go through email),
wire it to a real change-password flow (out of the agreed scope), or hide it until
one exists.

**⑦ Minor a11y gaps.**
- No `autoFocus` on the code input at step 2, or the password field at step 3 —
  every user has to click before typing.
- Step transitions aren't announced. The error message has `role="alert"` (good),
  but moving email → code → password is silent for screen-reader users. An
  `aria-live="polite"` region announcing the new heading would fix it.
- Labels, `htmlFor`/`id` pairing, `inputMode="numeric"`, `autoComplete="one-time-code"`
  and `autoComplete="new-password"` are all already correct.

### 4.3 Nice to have

**⑧ 6 → 8 digits.** One constant (`CODE_DIGITS`). Takes the per-code guess odds from
5-in-a-million to 5-in-a-hundred-million. The 5-attempt cap already makes 6 digits
safe, so this is margin, not a fix. Costs users two more keystrokes.

**⑨ No CAPTCHA / Turnstile.** Rate limits are the only cost imposed on an attacker.
Cloudflare Turnstile is free and would sit in front of step 1. Worth adding only if
abuse actually appears.

**⑩ No step-up for ADMIN accounts.** An ADMIN reset works exactly like a trainer's.
Given ADMINs can assign roles, you may eventually want something stronger — but
that's a broader auth decision, not a defect in this module.

**⑪ Password strength meter** on step 3. The 10-character minimum is enforced
server-side and tested; a meter is pure polish.

**⑫ `{6}-digit code` in `ForgotPassword.tsx:88`** is an odd literal interpolation.
Renders correctly ("a 6-digit code"); just untidy. Cosmetic.

### 4.4 Things I checked that are fine — no action

- **Mobile layout.** The new screen matches `Auth.tsx` exactly and additionally adds
  `overflow-y-auto`, which `Auth.tsx` lacks — so it's marginally *better* on short
  viewports. The `components/mobile/` kit is used only by the four data-list pages;
  the login screens don't use it either, so not using it here is consistent.
- **Error message wording.** The single generic string
  *"Invalid or expired code. Please request a new one."* is deliberately
  indistinguishable across all step-2 failure reasons — that's the anti-enumeration
  property, and it should not be made more helpful.
- **i18n consistency.** English-only matches every screen except the user guide.
- **Session invalidation blast radius.** Verified: only the target user's sessions
  are deleted; other users' sessions survive.
- **Legacy bcrypt accounts.** Reset upgrades them to PBKDF2 and correctly refuses
  password reuse against the old bcrypt hash.

---

## 5. Summary

Nothing in the module is broken, and nothing found is a security defect. The
concurrency race, the timing oracle, the enumeration vectors and the ticket forgery
paths were all probed directly and all held.

If you do only one thing: **decide the fallback for users with unreachable email
addresses (①)** — that's a real lockout affecting real rows in your seed data.

If you do three: add ①, the resend countdown (②), and the show/hide password toggle
(③). Together that's maybe half a day and covers every user-visible rough edge.

Everything else can wait indefinitely without risk.
