# What this costs

Pricing verified against the providers' own pages on **2026-09-07**. Exchange rate
used: **USD 1 ≈ MYR 4.05** (USD/MYR was 4.045 on 7 Sep 2026).

**Short answer: RM 0 per month.** Everything the password-reset feature needs sits
inside free tiers you're already on, and it isn't close to any limit. The only
money involved is the `abpmtrainer.my` domain renewal you already pay Exabytes.

---

## 1. Recurring costs at your actual scale

### Realistic volume

154 users, forgot-password only. A completed reset sends **2 emails** (the code,
then the "your password was changed" notification); an abandoned one sends 1.

Password resets typically run 1–5% of users per month. For 154 users that's
roughly **2–8 resets a month**, or **5–20 emails a month**. Even a pessimistic
15 resets/month is ~30 emails.

### The bill

| Item | Plan | Monthly cost | Notes |
|---|---|---|---|
| **Resend** | Free | **$0 / RM 0** | 3,000 emails/mo, 100/day. You'll use ~0.5% of it. |
| **Cloudflare Workers** | Free | **$0 / RM 0** | 100,000 requests/day. |
| **Cloudflare D1** | Free | **$0 / RM 0** | 5M rows read/day, 100k written/day, 5 GB storage. |
| **Cloudflare DNS** | Free | **$0 / RM 0** | Free on every Cloudflare plan, including no plan. |
| **Cloudflare Email Routing** | Free | **$0 / RM 0** | Only if you later want a replyable address. Free on all plans. |
| **Workers Builds** (CI/deploy) | Free | **$0 / RM 0** | Already how you deploy. |
| **TOTAL — new recurring cost** | | **$0 / RM 0** | |

### Already paying, unchanged by this work

| Item | Cost | Notes |
|---|---|---|
| `abpmtrainer.my` renewal (Exabytes) | ~**RM 60–90/year** | I could not confirm Exabytes' exact `.my` renewal rate — their published prices are promotional new-registration rates and renewals revert to standard. **Check your Exabytes invoice.** This is unchanged by the reset feature; you'd pay it anyway. |

**Annualised: RM 0 in new spend.**

---

## 2. Where the free tiers would actually break

Important framing: **the rest of the app already runs on this Cloudflare account.**
The OTP flow is *marginal* load on top of existing usage, not the whole budget. The
numbers below are what the OTP feature alone consumes — your dashboards, schedules
and dormitory pages are what will actually move the needle, if anything does.

| Limit | Free allowance | What the OTP flow uses | Headroom |
|---|---|---|---|
| **Resend — monthly** | 3,000 emails/mo | ~5–30/mo | Would need **~1,500 completed resets/month**. At a 5%/month reset rate that's ~**30,000 users**. You have 154. |
| **Resend — daily** | 100 emails/day | ~1–2/day | **50 completed resets in one calendar day.** This is the *only* limit you could plausibly touch — see below. |
| **Workers requests** | 100,000/day | ~4 requests per reset → ~40/day | The whole app would have to hit 100k/day first. The OTP flow is ~0.04% of the budget. |
| **D1 rows written** | 100,000/day | ~10–15 rows per reset (insert + index + throttle + session deletes) → ~150/day | ~0.15%. The tightest D1 limit generally, but not because of this feature. |
| **D1 rows read** | 5,000,000/day | Single-digit rows per query — every lookup is on an index | Negligible. |
| **D1 storage** | 5 GB total | Two new tables, a few KB. Your whole seed file is 316 KB of SQL | Effectively unlimited at this scale. |

### The one limit you could realistically hit

**Resend's 100/day cap = 50 completed resets in a day.** Normal usage will never
approach it. Two scenarios would:

1. **A forced org-wide reset.** If you ever made all 154 trainers reset at once,
   that's ~308 emails. Under the 3,000 monthly cap comfortably, but it would need
   spreading over **at least 4 days** to stay under 100/day. Plan a phased rollout
   rather than one announcement, or upgrade for a month.
2. **A sustained attack.** The rate limits (3/hour per email, 10/hour per IP) are
   specifically designed to stop this reaching the mail provider at all.

Note that **throttled requests never send email**, so the rate limiting doubles as
cost control — an attacker cannot burn your quota.

---

## 3. What upgrades cost, if you ever cross a line

| Upgrade | Cost | What triggers it |
|---|---|---|
| **Workers Paid** | **$5/mo ≈ RM 20** | >100k requests/day, >5M D1 rows read/day, >100k D1 rows written/day, or >5 GB D1 storage. Also the gate for Cloudflare's own Email Sending, if you ever wanted to drop Resend. Includes 10M requests/mo, 25 **billion** D1 rows read/mo, 50M rows written/mo. |
| **Resend Pro** | **$20/mo ≈ RM 81** | >3,000 emails/mo, or repeatedly hitting 100/day. Gives 50,000 emails/mo, **no daily limit**, 10 domains. Overage $0.90 per extra 1,000. |
| **Resend Scale** | $90/mo ≈ RM 365 | 100,000 emails/mo. Irrelevant at your scale — listed only for completeness. |

For context: at 154 users you would need to grow roughly **200×** before Resend Pro
becomes necessary for this feature.

If you only need to clear the daily cap once — for a phased rollout, say — Resend
Pro is month-to-month. One month at $20 (RM 81), then downgrade.

---

## 4. Hidden and one-off costs

Checked specifically, because these are the ones people get surprised by:

| Thing | Cost | Detail |
|---|---|---|
| **Custom sending domain on Resend Free** | **Free** | The Free plan includes **3 custom domains**. You need one. *(Correction: I earlier said "1 domain" based on a secondary source — Resend's own pricing page says 3.)* You do **not** need a paid plan to send from `abpmtrainer.my`. |
| **DKIM / SPF / DMARC records** | **Free** | They're just DNS entries. Cloudflare DNS is free. |
| **DMARC aggregate reports (`rua=`)** | **Free** | Receivers send XML reports to the address you nominate — no charge from anyone. You need *somewhere* for them to land; Cloudflare Email Routing (free) can forward them. Third-party DMARC *dashboards* cost money but are entirely optional, and unnecessary at `p=none`. |
| **Cloudflare Email Routing** (for a replyable `support@`) | **Free** | Free on all plans, including Workers Free — it's inbound-only. Unlimited inbound. |
| **A mailbox for `no-reply@`** | **Free — not needed** | No mailbox required. Resend authenticates via DKIM on the domain. **Do not buy email hosting for this.** |
| **Cloudflare DNS hosting** | **Free** | Already in place. |
| **`OTP_PEPPER` / secrets** | **Free** | `openssl rand -base64 32`; Worker secrets aren't metered. |
| **The D1 migration** | **Free** | Two small tables. Migration queries do count as billable rows in principle, but this is a handful of DDL statements. |
| **`.gov.my` deliverability / allowlisting** | **No money** | If `bomba.gov.my` filters your mail, the fix is asking their IT to allowlist `send.abpmtrainer.my`. That costs **time and bureaucracy, potentially weeks** — not ringgit. |
| **Dedicated IP** | $30/mo — **not needed** | Only relevant above 3,000 emails/day on Scale. Ignore. |

### Nothing here is a trial

Both free tiers are permanent, not time-limited: Resend's Free plan requires no
card, and Cloudflare's docs state D1 will always have a free plan. This isn't a
"free for 12 months then it bites" situation.

---

## 5. Cost in time

Money is the easy part. Time is the real cost.

| Task | Hands-on time | Elapsed |
|---|---|---|
| Resend signup + add domain | 10 min | 10 min |
| Add 4 DNS records in Cloudflare | 15 min | 15 min |
| **Wait for Resend verification** | 0 | **~15 min typical, up to 72 h** |
| Apply migration to remote D1 | 5 min | 5 min |
| Three `wrangler secret put` + `cf-typegen` | 10 min | 10 min |
| `npm run build` locally | 5 min | + build time |
| Push and deploy | 5 min | ~5 min (Workers Builds) |
| Test to Gmail + Yahoo | 20 min | 20 min |
| **Test to a real `@bomba.gov.my` mailbox** | 20 min | **unknown — hours to weeks** |
| **Total** | **~1.5 hours** | **half a day, if the gov mailbox is available** |

### The two things that actually cost time

1. **Getting access to a real `@bomba.gov.my` mailbox to test with.** This is the
   critical-path item and the one most likely to stall. Start asking now.
2. **If that gateway rejects or junks your mail**, arranging an allowlist with
   their IT. Free, but slow. Discovering this *after* launch is what turns a
   half-day into a fortnight.

---

## Sources

- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) — Free: 100k req/day; Paid: $5/mo
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) — Free: 5M rows read/day, 100k written/day, 5 GB
- [Cloudflare Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/) — Email Routing free on all plans
- [Resend pricing](https://resend.com/pricing) — Free: 3,000/mo, 100/day, 3 domains; Pro: $20/mo, 50,000/mo
- [Exabytes — .MY domain registration](https://www.exabytes.my/domains/mydomain) (renewal rate not published; check your invoice)
- [Trading Economics — USD/MYR](https://tradingeconomics.com/malaysia/currency) — 4.045 on 2026-09-07
