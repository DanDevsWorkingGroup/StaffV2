# Password reset — setup steps for Dan

> **Want to understand how it works rather than just what to click?**
> [`how-it-works.md`](how-it-works.md) explains both mechanisms — email delivery
> (SPF/DKIM/DMARC, why the `send.` subdomain) and the OTP protocol itself (what's
> stored, every defence, the threat model, and the honest limitations).
>
> **What does it cost?** [`costs.md`](costs.md) — short answer, RM 0/month on top
> of the domain renewal you already pay.

The code is written and tested. These are the parts that need account and DNS
access, which only you have. Nothing in the flow will actually deliver mail until
steps 2 and 3 are done.

Until then the feature **degrades cleanly rather than breaking**: `sendEmail()`
logs `[email] no RESEND_API_KEY configured — would have sent "..."` and returns
false, and every other part of the flow (codes, throttling, verification,
password change, session invalidation) works. That is how the test suite runs.

---

## 1. Apply the migration

```sh
npx wrangler d1 execute abpm-trainer --local  --file=migrations/0006_password_reset_otps.sql
npx wrangler d1 execute abpm-trainer --remote --file=migrations/0006_password_reset_otps.sql
```

Creates `password_reset_otps` and `password_reset_throttle`. It only adds tables —
nothing existing is touched.

---

## 2. Resend account and sending domain

Resend works fine on the **Workers Free** plan: sending is a plain outbound
`fetch()` to `api.resend.com`, which Workers Free allows. Nothing about it needs
Workers Paid. (Cloudflare's own Email Service *would* have needed Paid, which is
why it's out.)

Free tier: **3,000 emails/month, 100/day, 3 custom domains** — far above what 154
accounts will ever use. Costs nothing; see [`costs.md`](costs.md) for the full
breakdown.

1. Create an account at [resend.com](https://resend.com).
2. Add **`abpmtrainer.my`** as a domain.
3. Resend generates the DNS records below. **Copy the exact values from the
   dashboard** — the DKIM key and the SES region in the MX host are unique to your
   domain, so the values here are shape-only examples.

### 2a. Where the DNS records actually go — check this first

> **`abpmtrainer.my` is on Cloudflare DNS, not Exabytes.** Checked against the
> authoritative nameservers on 2026-09-07:
>
> ```
> $ dig abpmtrainer.my NS +short
> rocco.ns.cloudflare.com.
> oaklyn.ns.cloudflare.com.
> ```
>
> **Add the records in the Cloudflare dashboard.** Records added in the Exabytes
> cPanel Zone Editor will be written to a zone file that nothing on the internet
> reads, and will silently do nothing — no error, no warning, and Resend will just
> sit at "pending verification" indefinitely. This is the single most common way
> this setup goes wrong.

Exabytes is presumably still the **registrar** (where the domain was bought and
where the nameservers are pointed *from*), and may host other things for you. That
is a separate role from being the authoritative DNS host, which Cloudflare is.

**Confirm for yourself before you start** — delegation can change:

```sh
# Which nameservers is the domain delegated to?
dig abpmtrainer.my NS +short
# Windows, no dig:
nslookup -type=NS abpmtrainer.my
```

- Answers ending `.ns.cloudflare.com` → use the **Cloudflare** path (§2b). This is
  the current state.
- Answers pointing at Exabytes (e.g. `ns1.exabytes.com.my`, `dns1.exabytes.net`)
  → use the **Exabytes cPanel** path (§2c).
- Something else entirely → whoever those nameservers belong to is your DNS host.

### Existing SPF: there isn't one — no merge needed

Also checked authoritatively:

```
$ dig @rocco.ns.cloudflare.com abpmtrainer.my TXT +short    # (no output)
$ dig @rocco.ns.cloudflare.com abpmtrainer.my MX  +short    # (no output)
```

The domain currently has **no TXT records at all and no MX records**. So:

- **There is no existing SPF record to merge with.** Good — this is the failure
  mode to watch for, because a domain may only have **one** SPF TXT record. Two
  `v=spf1` records on the same name is a permanent error (`permerror`) and breaks
  authentication for *both*, which typically means all your mail starts failing.
  If Exabytes had provisioned mail hosting on this domain there would almost
  certainly be one already, looking something like
  `v=spf1 +a +mx +ip4:175.106.x.x ~all`.
- **If that ever changes** — if you add Exabytes or Google Workspace mail to this
  domain later — do not add a second SPF record. Merge the mechanisms into one:
  `v=spf1 +a +mx include:amazonses.com ~all`. Only one `v=spf1` line, one `~all`,
  at the end.
- Re-check before you add anything, in case something has been provisioned since:
  `dig abpmtrainer.my TXT +short | grep spf`

Note that Resend's SPF record goes on the **`send.` subdomain**, not the apex, so
even if an apex SPF appears later the two do not collide.

### 2b. Adding the records in Cloudflare (the path you need)

Cloudflare DNS is free and unrelated to the Workers plan, so nothing here costs
anything.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → select **abpmtrainer.my** →
   **DNS** → **Records**.
2. **Add record** for each row Resend shows you.

| # | Type | Name (type exactly this) | Content | Purpose |
|---|------|--------------------------|---------|---------|
| 1 | MX | `send` | `feedback-smtp.<region>.amazonses.com`, priority `10` | Return-Path / bounces |
| 2 | TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF |
| 3 | TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEB...` (long) | DKIM |
| 4 | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@abpmtrainer.my` | DMARC |

Records 1–3 are Resend's. **Record 4 is not required by Resend — add it anyway**,
see §5. Values 1–3 must be **copied from the Resend dashboard**; the DKIM key and
the SES region are unique to your domain.

**Cloudflare-specific gotchas:**

- **Name field: use the bare subdomain.** Cloudflare auto-appends the zone, so
  `send` becomes `send.abpmtrainer.my`. Cloudflare is smart enough to *also* accept
  the full `send.abpmtrainer.my` without doubling it, but bare is safer. `@` means
  the apex. **No trailing dot** in the Name field.
- **Trailing dot in MX content:** not needed. `feedback-smtp.<region>.amazonses.com`
  is fine as-is.
- **Do not wrap TXT values in quotes.** Cloudflare adds them. Typing
  `"v=spf1 ..."` yields a record containing literal quote characters, which fails.
- **Long DKIM keys are fine.** DNS TXT strings are capped at 255 characters each,
  but Cloudflare splits longer values across chunks automatically. Paste the whole
  key as one line; do **not** split it manually or add quotes between parts.
- **Proxy status must be "DNS only" (grey cloud)** for anything mail-related. MX
  and TXT records don't offer a proxy toggle at all, so this only bites if Resend
  gives you **CNAME** records (see the note below) — a proxied (orange cloud) CNAME
  returns Cloudflare's IPs instead of the real target and verification will fail.
- Your apex `A` records are currently proxied (`104.21.33.54`, `172.67.189.12` are
  Cloudflare IPs). Leave those alone — they're the website, unrelated to mail.

> Resend has been migrating newer domains to **CNAME**-based records instead of the
> MX/TXT set above. Whatever the dashboard shows for your domain is what's correct.
> If you get CNAMEs, the grey-cloud rule above is the one that matters.

Verification usually completes within ~15 minutes of the records going live; allow
up to 72 hours for full propagation. Check your work from outside Cloudflare:

```sh
dig send.abpmtrainer.my TXT +short
dig resend._domainkey.abpmtrainer.my TXT +short
dig _dmarc.abpmtrainer.my TXT +short
```

### 2c. Fallback: adding the records in Exabytes cPanel

**Only relevant if `dig NS` comes back pointing at Exabytes** — it currently does
not, so you should not need this. Kept here in case the domain is moved back.

Exabytes manages DNS through cPanel's Zone Editor:

1. Log in to your Exabytes client area → **Hosting** → **Manage** → **cPanel**
   (or go to cPanel directly, usually `https://abpmtrainer.my:2083`).
2. Under **Domains**, open **Zone Editor**.
3. Click **Manage** next to `abpmtrainer.my`.
4. **+ Add Record**, set **Type**, fill in **Name** and **Record**, then **Add Record**.

**Exabytes / cPanel gotchas — these differ from Cloudflare:**

- **cPanel auto-appends the domain to the Name field, and does it aggressively.**
  Typing `send.abpmtrainer.my` produces `send.abpmtrainer.my.abpmtrainer.my`. This
  is the classic cPanel mistake. Either type the bare label `send`, or type the
  FQDN **with a trailing dot**: `send.abpmtrainer.my.` — the trailing dot means
  "absolute, don't append".
- **Trailing dots matter in values too.** For the MX record, cPanel wants
  `feedback-smtp.<region>.amazonses.com.` with the dot. Without it, some cPanel
  versions append the zone and you end up pointing at
  `feedback-smtp.<region>.amazonses.com.abpmtrainer.my`.
- **Long DKIM keys may need manual splitting.** Older cPanel Zone Editors reject
  TXT values over 255 characters outright. If the DKIM key is rejected, split it
  into quoted 255-character chunks on one line:
  `"p=MIGfMA0GCS...first255" "...remainder"` — DNS concatenates adjacent strings.
  Newer cPanel versions handle this for you; try pasting whole first.
- **Zone Editor edits the local zone only.** If the nameservers point elsewhere
  (which today they do), everything you add here is inert. Re-read §2a.
- **Check for an existing SPF record first.** If Exabytes provisioned mail hosting,
  there will already be a `v=spf1 ...` TXT on the apex. Do not add a second —
  merge, per the SPF section above.
- If you only have client-area access and not cPanel, Exabytes also exposes a DNS
  manager there; the same Name/trailing-dot rules apply.

### 2d. From-address — you do not need a mailbox

The code sends as whatever `EMAIL_FROM` you set. Suggested:

```
ABPM Trainer System <no-reply@abpmtrainer.my>
```

**`no-reply@abpmtrainer.my` does not need to exist as a mailbox.** This is worth
being explicit about, because it's a common and expensive misunderstanding:

- Resend proves it may send as your domain via **DKIM** — a cryptographic
  signature validated against the public key in your DNS — plus SPF on the
  Return-Path. Receiving servers check the *domain's* DNS records. Nothing
  anywhere queries whether a mail account named `no-reply` exists.
- The domain currently has **no MX records at all**, which means no mail hosting
  and no mailboxes — and sending will still work perfectly once DKIM/SPF are in
  place. MX records govern *inbound* mail only.
- **So you do not need to buy email hosting from Exabytes, or provision any
  mailbox, just to send these OTPs.** Adding the DNS records is the entire job.

**Bounces still work regardless.** Resend sets the Return-Path to its own
infrastructure (that's what the `send.` MX record is for), so bounces and
complaints go back to Resend and show up in your dashboard's delivery logs. That
is how you'll diagnose the `bomba.gov.my` deliverability question in §5. You do
not need a mailbox to receive bounces.

**What changes if you want a replyable address.** If you'd rather trainers could
reply to something — `support@abpmtrainer.my` instead of `no-reply@` — then you
need somewhere for inbound mail to land, which means MX records on the apex and a
mailbox behind them. Two options:

- **Cloudflare Email Routing** — free on any plan, including Workers Free, since
  routing is inbound-only. It adds its own MX records to the apex and forwards
  `support@abpmtrainer.my` to a personal address you verify. Cheapest path by far,
  and it's already in the same dashboard you'll be in for §2b.
- **Exabytes mail hosting** — a real mailbox, paid. Only worth it if you want a
  proper shared inbox rather than forwarding.

Either way, adding apex MX records means an apex SPF record becomes relevant, so
re-read the SPF merge warning above before you do it.

**Confirm which you want before setting `EMAIL_FROM`.** My recommendation is
`no-reply@` to start — it needs nothing beyond the records you're already adding,
and the reset email tells users to contact their administrator if something's
wrong. You can switch later by changing one secret.

---

## 3. Worker secrets

Three values. None of these go in `.env` — Vite inlines `VITE_*` variables into
the **client** bundle, and `.env` is a build-time file, not a Worker secret store.

```sh
# HMAC key for the stored OTP digests. Generate 32 random bytes:
#   openssl rand -base64 32
npx wrangler secret put OTP_PEPPER

# From the Resend dashboard (API Keys -> Create, "Sending access" is enough)
npx wrangler secret put RESEND_API_KEY

# The from-address, e.g. ABPM Trainer System <no-reply@abpmtrainer.my>
npx wrangler secret put EMAIL_FROM
```

Then regenerate the Worker type definitions so `npm run typecheck` stays green:

```sh
npm run cf-typegen
```

### Why `OTP_PEPPER` matters

The database stores `HMAC-SHA256(OTP_PEPPER, code)`, not the code and not a plain
SHA-256 of it. A 6-digit code has only about 20 bits of entropy, so a plain digest
of one can be reversed by precomputing all one million values in seconds. The
pepper — which lives only in the Worker, never in D1 — is what makes a stolen
database snapshot useless for reading live codes.

Rotating it invalidates every outstanding code. That's a 20-minute blast radius,
so rotate freely, just deliberately.

### Local development

Put the same three values in a `.dev.vars` file at the repo root for
`wrangler dev`. **`.dev.vars` is not in `.gitignore` yet — add it before you
create the file.** Or just leave them unset locally: the flow works without them,
codes simply aren't emailed (read them from the `password_reset_otps` table, or
add a temporary log line while developing).

---

## 4. Deploy

Push to `main` — Workers Builds picks it up automatically. Secrets set with
`wrangler secret put` persist across deploys, so this is a one-time setup.

---

## 5. Deliverability to `@bomba.gov.my` — read this before launch

About 29 of the 154 accounts are `@bomba.gov.my` and 9 are `@abpm.gov.my`.
Government mail gateways are materially stricter than Gmail, and a brand-new
sending domain is exactly the profile they're suspicious of. Three things will
bite if you don't plan for them:

**Greylisting.** Many government gateways defer the first delivery attempt from an
unrecognised sender with a temporary failure, and only accept the message when the
sender retries — typically 5–15 minutes later, sometimes more. This is normal and
not a misconfiguration.

> This is why the OTP expiry is **20 minutes, not the conventional 10**. A
> 10-minute code would routinely expire in transit to a `bomba.gov.my` address,
> and the user's instinct — request another code — hits the same greylist and the
> same delay, so they'd never succeed. The security cost of doubling the window is
> close to zero: brute-force resistance comes from the 5-attempt cap, not the
> expiry, so the odds stay at 5 in 1,000,000 per code either way.

**Authentication is not optional.** Some government gateways reject unauthenticated
mail outright rather than filing it as spam. SPF and DKIM (records 1–3) are the
minimum. **Add the DMARC record (4) as well**, even though Resend doesn't require
it: an aligned DMARC policy is increasingly what strict receivers check first, and
its absence is itself treated as a negative signal. Start at `p=none` so nothing
is rejected while you watch, and leave it there — you don't need to escalate to
`quarantine` or `reject` for this use case.

**Reputation takes time to build.** A domain that has never sent mail has no
sending history, so early messages get more scrutiny and may be delayed or
filtered even when perfectly authenticated. This improves over days to weeks of
low-volume, low-complaint sending. There's no way to skip it.

### Test early, not at launch

Once the DNS records verify, **before you announce the feature**:

1. Send a real reset code to a real `@bomba.gov.my` mailbox you control or can
   borrow. Note how long it takes to arrive and whether it lands in the inbox or
   in junk.
2. Do the same for `@abpm.gov.my`, `@gmail.com` and `@yahoo.com` — those three
   cover ~110 of the 154 accounts.
3. Check the Resend dashboard's delivery logs for each. A `delivered` event with a
   long gap between send and delivery is greylisting working as expected. A
   `bounced` event with a 5xx reason is a real problem — usually an SPF/DKIM
   record that hasn't propagated, or the gateway rejecting the domain.

If `bomba.gov.my` turns out to reject or heavily filter mail from the domain, the
options are, roughly in order of effort: ask their IT to allowlist
`send.abpmtrainer.my`; switch the provider in `src/utils/email.ts` to Brevo (300
emails/day free) in case its sending IPs have better standing with that gateway;
or fall back to an admin-driven reset for those users. The first is most likely to
work, and is worth asking about early since it may take weeks to arrange.

---

## 6. What to verify after deploying

- The "Forgot your password?" link on `/login` goes to `/forgot-password`.
- Entering a **registered** address and an **unregistered** one produce visibly
  identical results — same screen, same wording, same delay. That's deliberate.
- A code arrives, works once, and is refused on a second use.
- After a reset, any other device that was logged in as that user is signed out.
- Five wrong guesses lock the code out, and the sixth attempt fails even if
  correct.

`npm test` covers all of the above against real SQLite (26 tests).

---

## Sources

DNS facts about `abpmtrainer.my` in §2a were read live from the authoritative
nameservers on 2026-09-07 (`dig @rocco.ns.cloudflare.com`), not from a registrar
panel — re-run the commands shown if anything looks stale.

- [Exabytes MY — How to add a TXT record in cPanel](https://support.exabytes.com.my/en/support/solutions/articles/14000110481-how-to-add-txt-record-in-cpanel)
- [Exabytes MY — Manage your DNS from cPanel](https://support.exabytes.com.my/en/support/solutions/articles/14000110468-manage-your-dns-from-cpanel)
- [Exabytes — How to edit DNS records in cPanel](https://support.exabytes.com/en/support/solutions/articles/14000110392-how-to-edit-dns-records-in-cpanel)
- [Cloudflare Email Service — pricing](https://developers.cloudflare.com/email-service/platform/pricing/) (why Email Sending is out on Workers Free)
- [Resend — what if my domain is not verifying?](https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying)
