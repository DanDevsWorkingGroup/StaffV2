# How password reset works — both mechanisms

Companion to [`password-reset-setup.md`](password-reset-setup.md), which is the
do-this-then-that checklist. This document is the *why*.

Two independent mechanisms have to work:

- **Part 1 — email delivery.** Getting a message from the Worker into a
  `bomba.gov.my` inbox. Mostly DNS and other people's spam filters.
- **Part 2 — the OTP protocol.** What the code is, where it's stored, and every
  defence in the flow.

They fail in completely different ways, so they're explained separately, then the
combined requirements checklist is in Part 3.

---
---

# PART 1 — Email delivery

## 1.1 The end-to-end path

Seven hops. Each can fail differently.

```
[1] Trainer's browser
      submits their email address on /forgot-password
       │
       ▼
[2] Cloudflare Worker (your app)
      rate-limits, looks up the user, generates a 6-digit code,
      stores an HMAC of it in D1, then calls sendEmail()
       │  HTTPS POST
       ▼
[3] Resend HTTP API  (api.resend.com)
      authenticates YOU via RESEND_API_KEY
      checks the From address is a domain you've verified
       │
       ▼
[4] Resend's sending infrastructure
      signs the message with DKIM using your domain's private key
      sets the Return-Path to its own bounce address on send.abpmtrainer.my
       │  SMTP over the public internet
       ▼
[5] Recipient's mail gateway  (bomba.gov.my)
      may greylist: "try again later" — first attempt deferred
      checks SPF, DKIM, DMARC against YOUR DNS records
      checks IP/domain reputation
       │
       ▼
[6] Recipient's spam filter
      content and reputation scoring → Inbox or Junk
       │
       ▼
[7] Trainer reads the code, types it back into the still-open page
```

### What fails at each hop, and how you'd know

| Hop | Failure | How it looks | Where you see it |
|---|---|---|---|
| 2 | `RESEND_API_KEY` not set | Nothing sent, flow otherwise works | Worker logs: `[email] no RESEND_API_KEY configured` |
| 3 | Bad/revoked API key | 401 from Resend | Worker logs: `Email provider returned 401` |
| 3 | Domain not verified, or `From` doesn't match a verified domain | 403 | Worker logs: `Email provider returned 403` |
| 4 | DKIM record missing/wrong in DNS | Sends but **unsigned** | Resend shows sent; recipient may junk it |
| 5 | Greylisting | Delivery delayed 5–15 min (normal, not a fault) | Resend logs: gap between "sent" and "delivered" |
| 5 | SPF/DKIM/DMARC fail | Hard rejection at the gateway | Resend logs: `bounced`, 5xx reason |
| 6 | Poor domain reputation | Delivered, but to Junk | **Nothing in any log** — only a human checking the mailbox |
| 7 | Code expired in transit | User says "the code doesn't work" | Nothing logged; this is why the TTL is 20 min |

**The important asymmetry:** hops 2–5 leave evidence. Hop 6 does not. A message can
be accepted, logged as `delivered`, and sit in Junk forever. Hence the insistence
on testing with a real `bomba.gov.my` mailbox rather than trusting the dashboard.

## 1.2 SPF, DKIM, DMARC — what each actually does

The underlying problem: **SMTP has no built-in authentication.** Any server on the
internet can connect to `bomba.gov.my`'s gateway and claim to be sending
`from: no-reply@abpmtrainer.my`. Nothing in the protocol stops it. All three
mechanisms are bolted-on layers letting a *domain owner* publish, in DNS, rules
about who may send on their behalf. DNS is the trust anchor because only the domain
owner can write to it.

The receiving gateway does all the checking. You aren't sending it anything extra;
you're publishing records it goes and looks up.

### The distinction everyone gets wrong: two different "from" addresses

Every email has **two** sender addresses, usually different:

| | Envelope sender (Return-Path / `MAIL FROM`) | Header `From:` |
|---|---|---|
| Who sees it | Mail servers only | The human, in their mail client |
| Analogy | Return address on the outside of the envelope | Letterhead on the paper inside |
| For us | `bounces@send.abpmtrainer.my` (Resend's) | `no-reply@abpmtrainer.my` (yours) |
| Checked by | **SPF** | **DKIM** (`d=`) and **DMARC alignment** |

**This is why Resend needs a `send.` subdomain.** SPF validates the *envelope*
sender's domain, and Resend puts bounce handling on `send.abpmtrainer.my` so
bounces return to Resend (visible in your dashboard) rather than to a mailbox you
don't have. So the SPF record lives on `send.abpmtrainer.my`, not the apex —
because that's the domain in the envelope. The `From:` your trainers see is still
plain `no-reply@abpmtrainer.my`.

People add Resend's SPF to the apex, see "pass" in a test tool, and can't work out
why real gateways are still unhappy. Put it where the dashboard says.

### SPF — "is this server allowed to send for this domain?"

A TXT record listing permitted servers. The gateway takes the envelope sender's
domain, looks up its SPF, checks whether the connecting IP is listed.

```
send.abpmtrainer.my    TXT    v=spf1 include:amazonses.com ~all
```

`include:amazonses.com` = "also trust everything Amazon SES lists" (Resend sends
through SES). `~all` = "anything else, treat as suspicious" (softfail).

**SPF's weakness:** it breaks on forwarding — a forwarding server's IP isn't on
your list. Hence DKIM.

**The one-record rule:** a domain may have exactly **one** SPF record. Two `v=spf1`
TXT records on the same name is a permanent error that breaks authentication for
*both*. If you add mail hosting later, merge into one line — never add a second.

### DKIM — "was this authorised, and unmodified?"

A cryptographic signature. Resend holds a private key; you publish the matching
public key in DNS. Resend signs each message; the gateway fetches your key and
verifies.

```
resend._domainkey.abpmtrainer.my    TXT    p=MIGfMA0GCSqGSIb3DQEB...
```

`resend` is the *selector*, letting several providers each hold their own key under
one domain without colliding.

DKIM proves two things: the message was authorised by a key-holder, and the signed
headers and body were **not altered in transit**. Unlike SPF it survives forwarding,
because the signature travels with the message.

The signature carries a `d=` tag naming the signing domain — `d=abpmtrainer.my`,
which matters next.

### DMARC — "and what should I do if those fail?"

SPF and DKIM each answer a narrow question, and neither is tied to the `From:`
address the human sees. Without DMARC, an attacker could pass SPF for *their own*
domain while displaying `From: no-reply@abpmtrainer.my`.

DMARC adds **alignment**: a passing SPF or DKIM result must belong to a domain
matching the visible `From:` domain.

```
_dmarc.abpmtrainer.my    TXT    v=DMARC1; p=none; rua=mailto:dmarc@abpmtrainer.my
```

- `p=none` — monitor only, reject nothing. The right starting policy.
- `rua=` — where aggregate reports go.

Under DMARC's **default relaxed alignment**, our setup gives:

- **DKIM aligns** — signing domain `abpmtrainer.my` exactly matches the `From:`
  domain. ✅
- **SPF aligns** — envelope domain `send.abpmtrainer.my` shares the organisational
  domain `abpmtrainer.my` with the `From:`. ✅

> **Do not set `aspf=s` (strict SPF alignment).** Under strict,
> `send.abpmtrainer.my` would no longer count as matching `abpmtrainer.my`, and SPF
> alignment would fail. Leave alignment at the default.

### Why all three when DKIM nearly suffices

Because the receiver decides, not you, and different receivers weigh them
differently. Government gateways are the strictest tier: some reject
unauthenticated mail outright rather than junking it, and increasingly treat a
**missing DMARC record as a negative signal in itself** — the domain hasn't stated
a policy, so it looks unmanaged. Resend requires only SPF + DKIM. Add DMARC anyway;
it costs one TXT record.

## 1.3 Why Cloudflare nameservers change where records go

DNS has two roles that are easy to conflate:

- **Registrar** — who you bought the domain from and pay renewals to. Presumably
  Exabytes.
- **Authoritative nameserver** — the servers that actually *answer* queries for the
  domain.

You can buy from one and host DNS at another. That's your case:

```
$ dig abpmtrainer.my NS +short
rocco.ns.cloudflare.com.
oaklyn.ns.cloudflare.com.
```

The `.my` registry delegates `abpmtrainer.my` to Cloudflare. When `bomba.gov.my`'s
gateway looks up `resend._domainkey.abpmtrainer.my`, the query walks root → `.my` →
**Cloudflare** → answer. Exabytes is never consulted.

**So records added in Exabytes' cPanel Zone Editor go into a zone file nobody
queries.** cPanel saves them and shows them back to you. No error. Resend just
stays "pending verification" and you lose a day.

### Confirming delegation yourself

```sh
dig abpmtrainer.my NS +short          # macOS / Linux
nslookup -type=NS abpmtrainer.my      # Windows
```

Ends in `.ns.cloudflare.com` → **Cloudflare dashboard**. Points at Exabytes → cPanel
Zone Editor.

To bypass caching and ask the authoritative server directly:

```sh
dig @rocco.ns.cloudflare.com abpmtrainer.my TXT +short
```

If a record shows there but not via plain `dig`, it's correct and you're waiting on
cache expiry.

---
---

# PART 2 — The OTP mechanism

Implemented in `src/utils/passwordReset.ts`. Three steps, and the interesting
design question is what carries state *between* them.

## 2.1 The full lifecycle

### Step 1 — request a code (`requestPasswordResetOtp`)

User submits an email on `/forgot-password`.

1. Sweep expired rows from `password_reset_otps`.
2. Burst-guard on the Workers rate-limit binding (per IP, per email).
3. Consume the durable D1 throttle: **3/hour per email**, **10/hour per IP**.
4. Look up the user by `lower(email)`.
5. Check the 60-second resend cooldown against their most recent live code.
6. **Generate a 6-digit code and HMAC it — on every path, even when no account
   exists.**
7. Only if an account exists *and* nothing blocked: delete any other unconsumed
   rows for that user, insert the new row, and fire the email without awaiting it.
8. Return `{ ok: true }` — always, after a fixed 400 ms floor.

**In D1 afterwards:**

```
password_reset_otps:
  id, user_id, email_lower,
  code_hash        = HMAC-SHA256(OTP_PEPPER, code)     ← never the code
  attempts         = 0
  created_at, expires_at (+20 min)
  verified_at      = NULL
  consumed_at      = NULL
  ticket_hash      = NULL
  request_ip
```

**Client holds:** nothing. No cookie yet. Just the email in a React state variable
so step 2 can post it again.

### Step 2 — verify the code (`verifyPasswordResetOtp`)

1. Burst-guard per IP.
2. Select the newest row for that `email_lower` that is unconsumed, unverified, and
   unexpired.
3. **HMAC the submitted code whether or not a row was found.**
4. Reject if: no row, blocked, or not exactly 6 digits.
5. If `attempts >= 5`, **delete the row** and reject.
6. Constant-time compare of the two HMAC digests.
7. On mismatch: `attempts = attempts + 1`, reject.
8. On match: mint a **ticket** — 32 random bytes, base64url — and store only its
   SHA-256, via a guarded `UPDATE`.

**In D1 afterwards:**

```
  verified_at       = now          ← row can never be re-verified
  ticket_hash       = SHA-256(ticket)
  ticket_expires_at = now + 10 min
```

**Client holds:** cookie `abpm_pwreset` = the raw ticket.
`httpOnly, secure, sameSite=lax, path=/forgot-password, maxAge=600`.

The cookie contains **only the random token** — no user id, no email, no code, no
signature. It's a lookup handle, meaningless without the matching database row.
Exactly the design already used for `sessions.id`.

### Step 3 — set the new password (`completePasswordReset`)

The client posts **only** `{ password, confirmPassword }`. No email, no code, no
user id.

1. Validate length ≥ 10 and confirmation match.
2. Read the ticket cookie, SHA-256 it, look up the row by `ticket_hash` where
   unconsumed, verified, and `ticket_expires_at > now`.
3. Load the user; refuse if the new password equals the current one.
4. `setUserPassword()` — fresh PBKDF2-SHA256 hash (this also upgrades any account
   still on a legacy bcrypt hash).
5. `invalidateAllSessions()` — `DELETE FROM sessions WHERE user_id = ?`.
6. Stamp `consumed_at`, null the `ticket_hash`, delete any other live codes.
7. Clear both cookies; send the "your password was changed" notification.
8. Redirect to `/login`. **No auto-login.**

### Why a ticket cookie instead of re-accepting the OTP at step 3

Four reasons, in rough order of importance:

1. **The code stops travelling.** It's transmitted exactly once, at step 2. A
   design that re-posts it at step 3 puts it on the wire again, into another form,
   and into browser history/autofill.
2. **Single-use becomes enforceable.** `verified_at` is set the instant the code is
   verified, so the code is dead even though the reset hasn't happened yet. If step
   3 re-accepted the code, "used" and "verified" couldn't be distinguished and a
   replay window would exist between the two steps.
3. **Step 3 carries no identity from the client.** Because the ticket is the only
   input, there's no email field to tamper with — you cannot verify your *own* code
   and then submit someone else's address.
4. **Different lifetimes.** The code needs 20 minutes to survive mail delays; the
   ticket only needs 10, since the user is actively on the page. Separate secrets
   allow separate windows.

## 2.2 Code generation, and why an HMAC

### Generation

```ts
const space = 10 ** 6                            // 1,000,000
const limit = Math.floor(0xffffffff / space) * space
do { crypto.getRandomValues(buffer) } while (buffer[0] >= limit)
return String(buffer[0] % space).padStart(6, '0')
```

- **`crypto.getRandomValues`** — the platform CSPRNG, not `Math.random()`, which is
  seeded predictably and would let an attacker who observes a few codes derive the
  rest.
- **Rejection sampling.** `draw % 1000000` on a raw 32-bit value is *biased*:
  2³² isn't a multiple of 10⁶, so low codes come up slightly more often. Small, but
  it shrinks the effective search space for free. Discarding draws above the largest
  clean multiple removes it.
- **6 digits** — the familiar format. The security comes from the attempt cap, not
  the length (arithmetic in §2.4).

### Why HMAC with a pepper, not the code and not a plain hash

**Storing the code in plaintext** is obviously wrong: anyone reading the database —
a leaked backup, a SQL injection elsewhere, a curious operator — resets any account
at will.

**Storing a plain SHA-256 is barely better, and this is the non-obvious part.**
Password hashing intuition says "hash it and you're fine", but that intuition
assumes an unpredictable input. A 6-digit code has only **one million** possible
values. A commodity CPU computes on the order of 10⁸–10⁹ SHA-256 operations per
second, so an attacker holding the table can hash all one million candidates and
match them against every stored digest in **a few milliseconds**. Sub-second,
without specialised hardware. A plain hash of a 6-digit code is decoration.

This is precisely why `sessions.id` *can* safely be a bare SHA-256: its input is
32 random bytes — 2²⁵⁶ possibilities, not 10⁶.

**The fix is a keyed hash:**

```
code_hash = HMAC-SHA256(OTP_PEPPER, code)
```

`OTP_PEPPER` is a Worker secret. It is **not in the database**. An attacker holding
a complete D1 dump cannot precompute anything, because every candidate digest
depends on a 256-bit key they don't have. The exhaustible search collapses from
10⁶ (milliseconds) to 2²⁵⁶ (never).

The pepper is deliberately *not* a per-row salt: salts defeat precomputed rainbow
tables but are stored alongside the data, so they don't help when the whole search
space is a million values. Only a secret held outside the database does.

## 2.3 Every defence, and the attack it stops

| Defence | Attack it stops |
|---|---|
| **HMAC + pepper** (`hmacOtp`) | Reading live codes out of a stolen database dump. |
| **5-attempt cap** (`attempts >= 5` → delete row) | Online brute force. This is the primary bound on guessing, not the code length. |
| **Guarded `UPDATE ... WHERE verified_at IS NULL AND consumed_at IS NULL`** | Replay, and the race where two concurrent requests both verify the same code. The check and the claim are one atomic statement — a second request changes zero rows and gets nothing. |
| **Constant-time compare** (`timingSafeEqual`, XOR-accumulate, no early return) | Timing side-channel that leaks how many leading digits were right, turning 10⁶ guesses into ~60. Applied to the *digests*, never the codes. |
| **Uniform `{ ok: true }` + HTTP 200 on step 1** | User enumeration — discovering which of the 154 addresses are registered, which is reconnaissance for phishing. |
| **Fixed 400 ms timing floor** (`withFloor`) | The same enumeration via a stopwatch. The "account exists" path does an HMAC, two D1 writes and an HTTPS call; the "no account" path does almost none of it. Without a floor the difference is trivially measurable. |
| **Not awaiting `sendEmail()`** | The same again — otherwise response time tracks Resend's latency, which only happens for real accounts. |
| **Generating + HMAC-ing the code even when no account exists** | Same. Never return early on "user not found"; set a flag and walk the identical path. |
| **Throttle counters tick for unknown addresses too** | The subtle version: if unknown addresses skipped the counter, "throttled" vs "not throttled" becomes an oracle. That's why the throttle key is `email_lower`, not `user_id` — there's no user row to key on for an address that doesn't exist. |
| **Silent throttling** (still returns `{ ok: true }`, never 429) | A 429 would itself be the signal. "This address got rate-limited" implies the address is worth rate-limiting. |
| **3/hour per email** | Mailbox flooding of one trainer, and it caps guesses-per-hour at 15. |
| **10/hour per IP** | One host farming many addresses for enumeration or spam. |
| **Both, not either** | They stop different things. Per-email alone lets one host hit 154 addresses; per-IP alone lets a botnet hammer one address. Per-IP is also unreliable on its own — Malaysian mobile carriers NAT many users behind one address (Cloudflare's own docs warn against IP-keyed limits as a primary control), so it can't be the only layer. |
| **Two throttle layers** (Workers binding + D1 table) | The binding is fast but per-datacentre and eventually consistent — a distributed attacker gets a fresh allowance in each Cloudflare location. D1 is strongly consistent and globally authoritative. The binding blunts bursts; D1 enforces the real cap. |
| **20-minute expiry** | Bounds the window in which a code sitting in a shared or forwarded inbox is useful. Long enough to survive `.gov.my` greylisting. |
| **10-minute ticket, `path=/forgot-password`, httpOnly** | Limits an abandoned half-finished reset, and keeps the ticket out of JavaScript and off unrelated paths. |
| **One live code per user** | Issuing a new code deletes the old ones, so an attacker can't accumulate several valid codes and get 5 attempts against each. |
| **Session invalidation on completion** | The real point of a reset when an account is *already* compromised: an attacker holding a stolen session cookie keeps access indefinitely otherwise, since sessions here last 30 days and don't re-check the password. |
| **No auto-login after reset** | Makes "signed out everywhere" literally true, and means a reset completed by someone else doesn't hand them a live session. |
| **Password-change notification email** | Detection. It's how a user learns somebody else reset their password. |
| **Refusing to reuse the current password** | Stops a "reset" that changes nothing while looking successful. |

## 2.4 Threat model — the arithmetic

### Can an attacker guess a code?

One code, 5 attempts against 10⁶ possibilities:

```
5 / 1,000,000  =  0.0005%   =  1 in 200,000
```

Per hour, since the throttle allows 3 codes per email:

```
3 codes × 5 attempts = 15 guesses/hour
15 / 1,000,000 = 0.0015% per hour
```

Sustained, for a 50% chance of breaking into **one specific account**:

```
≈ 693,000 guesses needed  ÷  15/hour  ≈  46,000 hours  ≈  5.3 years
```

— of continuous, maximum-rate attack against one trainer, generating three emails
an hour to their inbox the whole time. It would be noticed on day one.

Note what's doing the work: **the 5-attempt cap, not the 6 digits.** Remove the cap
and 10⁶ falls in minutes. That's why the cap is enforced on the database row rather
than in a session — discarding cookies between guesses doesn't reset it.

### Attacker with the D1 database but not the pepper

- **Cannot read live codes.** Every `code_hash` is an HMAC under a 256-bit key
  they don't hold. No precomputation is possible.
- **Cannot forge a reset ticket.** `ticket_hash` is a SHA-256 of 32 random bytes;
  they'd need the preimage.
- **Cannot recover passwords.** `password_hash` is PBKDF2-SHA256 at 100k iterations
  with a per-user salt.
- **Cannot hijack sessions.** `sessions.id` stores only a SHA-256 of the cookie
  token.
- **Can** read every user's email address, and see who has recently requested a
  reset and from which IP. Real, but reconnaissance, not access.

### Attacker who can read the user's mailbox

**They win.** They request a code, read it, and reset the password. No amount of
server-side hardening changes this — it's inherent to every email-based reset, and
the same is true of Google's and your bank's.

What the design does instead is make it *noisy and non-persistent*: the
notification email lands in the same mailbox, and the real user is abruptly signed
out on every device, which they will notice.

## 2.5 Honest limitations

Things this design does **not** protect against, stated plainly:

1. **Mailbox compromise = account compromise.** As above. The only real fix is a
   second factor that isn't email, which this system doesn't have. If ADMIN
   accounts warrant more, that's a separate conversation.
2. **A compromised `OTP_PEPPER` *plus* database read access.** Either alone is
   survivable; together they aren't. With the pepper, an attacker holding the table
   brute-forces the 10⁶ space in milliseconds and reads live codes. Treat the
   pepper as production-critical, and note that rotating it invalidates all
   outstanding codes (a 20-minute blast radius — cheap to do).
3. **Full Worker compromise.** Anyone who can run code in the Worker has the D1
   binding and every secret. Nothing here is defence-in-depth against that.
4. **Distributed attacks partially evade the IP limit.** A botnet with many IPs
   sidesteps the 10/hour per-IP cap. The 3/hour **per-email** cap still holds, so a
   *targeted* attack stays bounded — but broad enumeration across many addresses
   gets cheaper.
5. **The timing floor is a mitigation, not a proof.** 400 ms comfortably exceeds
   the real work, but it's not a formal constant-time guarantee. An attacker with a
   great many samples and a quiet network might still find a statistical
   difference. It raises the cost by orders of magnitude; it doesn't reduce it to
   zero.
6. **A failed send is invisible to the user.** By design — telling them "we
   couldn't send" would leak that the address exists. The cost is that a genuine
   Resend outage looks identical to "you typed the wrong address": the user waits
   for a mail that never arrives. Detection is your job, via Worker logs and the
   Resend dashboard.
7. **`password_reset_throttle` rows are never cleaned up.** Expired
   `password_reset_otps` rows are swept on each request, but throttle rows are not
   — the table accumulates one row per distinct email hash and IP hash seen, ever.
   At this scale that's kilobytes a year and harmless, but it is unbounded growth.
   If it ever matters, add
   `DELETE FROM password_reset_throttle WHERE window_start < <24h ago>` to the same
   opportunistic sweep.
8. **No CAPTCHA or proof-of-work.** Rate limits are the only cost imposed on an
   attacker. Adding Cloudflare Turnstile would be the natural next step if abuse
   appears; it's free and would sit in front of step 1.
9. **Reset grants full account access.** There's no step-up for ADMIN accounts —
   an ADMIN password reset works exactly like a trainer's.
10. **Greylisting can still outrun the 20-minute window.** Unlikely but possible on
    an unusually slow gateway. If `.gov.my` testing shows delays beyond that, raise
    `CODE_TTL_MS` in `src/utils/passwordReset.ts`; the arithmetic in §2.4 barely
    moves, because the cap does the work.

---
---

# PART 3 — Combined requirements checklist

Grouped by owner, in dependency order. **Blocking** = later items can't proceed
until it's done.

## Already done (in the repo)

| # | Item | State |
|---|---|---|
| 0.1 | Migration `0006_password_reset_otps.sql` written | ✅ |
| 0.2 | OTP logic, server functions, UI, rate limiting, session invalidation | ✅ |
| 0.3 | `sendEmail()` adapter (Resend; degrades to a logged no-op with no key) | ✅ |
| 0.4 | 26 unit tests passing, `tsc --noEmit` clean | ✅ |

## Dan — decisions

| # | Item | Blocking? | Depends on | Notes |
|---|---|---|---|---|
| 1.1 | **Confirm the from-address.** `no-reply@abpmtrainer.my` recommended | **Blocking** for 3.4 | — | Needs no mailbox — setup doc §2d. Reversible later (one secret). |

## Dan — Resend and DNS

| # | Item | Blocking? | Depends on | Time |
|---|---|---|---|---|
| 2.1 | Create Resend account | **Blocking** | — | 5 min |
| 2.2 | Add `abpmtrainer.my` in Resend; it generates your records | **Blocking** | 2.1 | 2 min |
| 2.3 | **Confirm delegation** — `dig abpmtrainer.my NS +short` | **Blocking** | — | 1 min. Currently Cloudflare. Skipping this is how records end up in the wrong place. |
| 2.4 | Check for an existing SPF — `dig abpmtrainer.my TXT +short \| grep spf` | **Blocking** | 2.3 | 1 min. Currently **none**. If one appears, merge — never add a second. |
| 2.5 | **MX** on `send` → Resend's bounce host, priority 10 | **Blocking** | 2.2, 2.3 | |
| 2.6 | **SPF TXT** on `send` → `v=spf1 include:amazonses.com ~all` | **Blocking** | 2.2, 2.3 | |
| 2.7 | **DKIM TXT** on `resend._domainkey` → the long `p=...` key | **Blocking** | 2.2, 2.3 | The record that must be exact. |
| 2.8 | **DMARC TXT** on `_dmarc` → `v=DMARC1; p=none; rua=...` | Not blocking, **strongly recommended** | 2.3 | Matters for `.gov.my`. |
| 2.9 | Wait for Resend to show **Verified** | **Blocking** | 2.5–2.7 | **~15 min** typical; **72 h** worst case |

> **Timing:** Cloudflare's default TTL is ~5 minutes, so propagation is usually
> minutes. The 72-hour figure is the pessimistic ceiling for globally-cached
> records. Not verified after ~1 hour? Re-check 2.3 first.

## Dan — deployment

| # | Item | Blocking? | Depends on | Notes |
|---|---|---|---|---|
| 3.1 | Apply migration to remote D1 (`wrangler d1 execute abpm-trainer --remote --file=migrations/0006_password_reset_otps.sql`) | **Blocking** | — | Additive only. Do this **before** deploying the code, or the flow errors on first use. |
| 3.2 | `wrangler secret put OTP_PEPPER` (`openssl rand -base64 32`) | **Blocking** | — | Without it the code runs on an insecure dev pepper and logs an error. |
| 3.3 | `wrangler secret put RESEND_API_KEY` | **Blocking** | 2.1 | |
| 3.4 | `wrangler secret put EMAIL_FROM` | **Blocking** | 1.1 | |
| 3.5 | `npm run cf-typegen` | Not blocking | 3.2–3.4 | Keeps typecheck green. |
| 3.6 | **`npm run build` locally** | **Blocking** | — | Not verified in this workspace — its `node_modules` holds Windows binaries, so rollup's Linux native module is absent. Run once before pushing. |
| 3.7 | Push to `main` — Workers Builds deploys | **Blocking** | 3.1–3.6 | |

## Dan — verification

| # | Item | Blocking? | Depends on |
|---|---|---|---|
| 4.1 | Real code to a **Gmail** address; confirm inbox, not junk | **Blocking for launch** | 2.9, 3.7 |
| 4.2 | Same for **Yahoo** | Recommended | 4.1 |
| 4.3 | Same for a real **`@bomba.gov.my`** mailbox | **Blocking for launch** | 4.1 |
| 4.4 | Same for **`@abpm.gov.my`** | Recommended | 4.1 |
| 4.5 | Check Resend delivery logs — `delivered` vs `bounced`, and the delay | **Blocking for launch** | 4.1–4.4 |

4.1 + 4.3 cover roughly 123 of the 154 accounts. **Do these before announcing**,
not after: if `bomba.gov.my` rejects or heavily filters, the fix (asking their IT
to allowlist `send.abpmtrainer.my`) can take weeks.

## Critical path

```
1.1 ──────────────────────────────┐
2.1 → 2.2 ┐                       ├→ 3.2/3.3/3.4 → 3.6 → 3.7 → 4.1 → 4.3 → launch
2.3 → 2.4 ┴→ 2.5/2.6/2.7 → 2.9 ───┘
3.1 ──────────────────────────────┘
```

Long poles: **2.9** (verification wait) and **4.3** (finding a real `bomba.gov.my`
mailbox). Start chasing that mailbox now — it's the item most likely to stall.

---

# PART 4 — What can still silently fail

All of this can happen with correct records, a verified domain, and deployed code.
None of it throws an error.

| # | Silent failure | Why | How to detect |
|---|---|---|---|
| 1 | **Delivered to Junk** | New domain, no sending reputation | Only by checking a real mailbox. Resend logs say `delivered`. **The big one.** |
| 2 | **Greylisting outruns the expiry** | Gateway defers 5–15 min | Users report "the code doesn't work". Raise `CODE_TTL_MS` if `.gov.my` testing shows it. |
| 3 | **Records added at Exabytes, not Cloudflare** | Wrong DNS host | Never verifies. `dig` the record — no answer means it isn't live. |
| 4 | **A second SPF record appears later** | Mail hosting added to the domain | Breaks auth for *both*. `dig abpmtrainer.my TXT +short \| grep -c spf1` must be `0` or `1`, never `2`. |
| 5 | **DKIM key truncated on paste** | 255-char TXT limits, or an editor wrapping | Won't verify, or verifies then fails signing. Compare `dig resend._domainkey.abpmtrainer.my TXT +short` to the dashboard, character for character. |
| 6 | **CNAME accidentally proxied (orange cloud)** | Cloudflare's default for new CNAMEs | Verification fails. Set "DNS only" (grey). |
| 7 | **API key revoked or rotated** | Housekeeping | Every send 401s. Worker logs: `Email provider returned 401`. Users see the normal screen and no mail. |
| 8 | **Free-tier daily cap hit (100/day)** | Realistically only under attack | Resend dashboard shows quota; rate limits should prevent it. |
| 9 | **`OTP_PEPPER` unset in production** | Forgotten secret | Flow works — silently, on an insecure dev pepper. Worker logs: `OTP_PEPPER is not set`. **Grep for this after first deploy.** |
| 10 | **Migration not applied to remote D1** | 3.1 skipped | First reset errors on a missing table. Worker logs show the SQL error; user sees a generic failure. |

## The one habit that catches most of this

After deploying, trigger one reset for **your own** address, then read the Worker
logs in the Cloudflare dashboard (`observability` is already enabled). In under a
minute that confirms secrets are present (no `OTP_PEPPER` warning, no
`[email] no RESEND_API_KEY`), the migration applied (no SQL error), and Resend
accepted the message (no `Email provider returned ...`).

Then open the actual mailbox — that's the only way to check items 1 and 2, which no
log can tell you.

---

## Sources

- [Cloudflare Email Service — pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (per-location, eventually consistent; IP-keying caveat)
- [Resend — what if my domain is not verifying?](https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying)
- [Exabytes MY — Manage your DNS from cPanel](https://support.exabytes.com.my/en/support/solutions/articles/14000110468-manage-your-dns-from-cpanel)

DNS facts about `abpmtrainer.my` were read from the authoritative nameservers on
2026-09-07.
