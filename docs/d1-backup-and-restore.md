# D1 backup and point-in-time recovery

Verified against Cloudflare's docs on 2026-09-07. **Dan is on the Workers Free
plan**, which changes one number materially — see §2.

---

## 1. Yes — D1 has point-in-time recovery, and it is already on

It is called **Time Travel**.

- **Always on.** Nothing to enable, no configuration.
- **No extra cost.** Database history and restores are free on all plans.
- **Automatic.** Cloudflare creates *bookmarks* on your behalf; there is no
  scheduled or manual backup to remember.
- **Any minute** within the retention window, not just at fixed snapshots.

It replaces the old snapshot-based backup API, which now only applies to legacy
`alpha` databases.

### Check your databases qualify first

Time Travel needs a database on D1's production storage backend:

```sh
npx wrangler d1 info abpm-trainer-dev
npx wrangler d1 info abpm-trainer
```

Look at the `version` field. **`version: production`** → Time Travel works.
`version: alpha` → only the old snapshot API, and you should migrate.

I could not run this — it needs your Cloudflare credentials. Given these
databases were created recently during the Supabase migration, `production` is
almost certain, but confirm before relying on it.

---

## 2. ⚠️ Retention on the Free plan is 7 days, not 30

This is the single most important number here, and most write-ups quote only the
30-day figure.

| | Workers Free | Workers Paid |
|---|---|---|
| **Time Travel retention** | **7 days** | 30 days |
| Max database size | 500 MB | 10 GB |
| Databases per account | 10 | 50,000 |
| Max storage per account | 5 GB | 1 TB |
| Restore operations | 10 per 10 min per database | same |

**What this means for you:** a mistake made on a Friday and noticed the following
Monday week is *outside* the window and unrecoverable by Time Travel. That is the
argument for also taking an explicit `d1 export` before anything risky — see §5.

Upgrading to Workers Paid ($5/mo) extends this to 30 days, and is the cheapest
insurance available for the production database that holds real records for 154
people.

---

## 3. The commands

### Find the current bookmark

```sh
npx wrangler d1 time-travel info abpm-trainer-dev
```

```
⚠️ The current bookmark is '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683'
⚡️ To restore to this specific bookmark, run:
 `wrangler d1 time-travel restore abpm-trainer-dev --bookmark=00000085-...`
```

### Find the bookmark for a past moment

```sh
npx wrangler d1 time-travel info abpm-trainer-dev \
  --timestamp="2026-09-07T14:30:00+08:00"
```

Accepts a Unix timestamp (`date +%s`) or an RFC3339 / JavaScript date-time string.
Include the timezone — you are UTC+8, so `+08:00`, or Cloudflare will read it as UTC.

> There is **no "list all bookmarks" command.** Time Travel is continuous, not a
> list of discrete snapshots — you ask "what was the bookmark at time T" and it
> deterministically converts. The same timestamp always maps to the same bookmark.

### Restore

```sh
# By timestamp
npx wrangler d1 time-travel restore abpm-trainer-dev \
  --timestamp="2026-09-07T14:30:00+08:00"

# Or by an exact bookmark
npx wrangler d1 time-travel restore abpm-trainer-dev \
  --bookmark=00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683
```

### Export to a `.sql` file

```sh
# Everything
npx wrangler d1 export abpm-trainer-dev --remote --output=./backup-dev.sql

# Schema only
npx wrangler d1 export abpm-trainer-dev --remote --no-data --output=./schema.sql

# One table's data
npx wrangler d1 export abpm-trainer-dev --remote --table=users --output=./users.sql
```

---

## 4. Restore is IN-PLACE and DESTRUCTIVE

Cloudflare's own wording: restoring *"is a destructive operation, and overwrites
the database in place."*

- It does **not** create a new database. There is no fork or clone — Cloudflare
  lists that as a future feature.
- **In-flight queries and transactions are cancelled** and return errors to
  clients. On production that is a brief outage.
- It prompts for confirmation interactively.

### But it is reversible

A restore **does not delete bookmarks**, including ones newer than the point you
restored to. So a restore is undoable:

1. The restore command prints the *previous* bookmark. **Copy it.** It is your
   undo handle.
2. To undo: `npx wrangler d1 time-travel restore <db> --bookmark=<that bookmark>`

So the failure mode is not "I destroyed the database" but "I moved it to the
wrong point in time" — recoverable, as long as you kept the output. Capture the
terminal output of any restore.

Rate limit: **10 restores per 10 minutes per database.** Not a constraint in
normal use, but enough to stop a panicked loop.

---

## 5. Does Time Travel cover schema changes?

**Yes — explicitly.** Cloudflare's docs give this as a primary use case: restore
*"prior to a failed migration or schema change"*.

Time Travel operates at the storage layer, so a `CREATE TABLE`, `ALTER TABLE` or
`DROP TABLE` is rolled back exactly like a `DELETE` or `UPDATE`. That is precisely
what you need for migration `0006`.

One consequence worth being clear about: a restore reverts **schema and data
together**. You cannot roll back the schema while keeping data written afterwards.
Restoring to before `0006` also discards every row written since that moment.

---

## 6. Recommended routine for applying migration 0006

`0006_password_reset_otps.sql` is low-risk by construction — it only runs
`CREATE TABLE` and `CREATE INDEX`, adds two new tables, and touches no existing
table. The realistic failure is "it half-applied" or "it ran against the wrong
database", not data loss. Still, do this properly on dev so the same routine is
second nature by the time it reaches production.

### Before applying — on dev

```sh
# 1. Confirm the database supports Time Travel
npx wrangler d1 info abpm-trainer-dev

# 2. Record the bookmark. THIS IS THE ROLLBACK POINT — save the output.
npx wrangler d1 time-travel info abpm-trainer-dev

# 3. Belt and braces: an explicit export that survives the 7-day window
npx wrangler d1 export abpm-trainer-dev --remote \
  --output=./backups/dev-before-0006-$(date +%Y%m%d-%H%M).sql
```

Step 3 matters more on the Free plan than it would on Paid: it is the only copy
that still exists after 7 days. Keep it outside the repo — `backups/` is not in
`.gitignore`, and a dev export contains only synthetic `@abpm.test` accounts, but
a production export contains real personal data and **must never be committed**.

### Apply

```sh
npx wrangler d1 execute abpm-trainer-dev --remote \
  --file=migrations/0006_password_reset_otps.sql
```

### Verify

```sh
npx wrangler d1 execute abpm-trainer-dev --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'password_reset%';"
```

Expect exactly two rows: `password_reset_otps` and `password_reset_throttle`.

### If it goes wrong

```sh
npx wrangler d1 time-travel restore abpm-trainer-dev --bookmark=<from step 2>
```

Then re-verify with the `sqlite_master` query — the two tables should be gone.

### Cheaper rollback for this particular migration

Because `0006` only adds tables, you usually do not need Time Travel at all:

```sql
DROP TABLE IF EXISTS password_reset_otps;
DROP TABLE IF EXISTS password_reset_throttle;
```

That undoes it completely with no downtime and no effect on anything else. Reach
for Time Travel only if something unexpected happened to other tables.

### When it reaches production

Identical routine against `abpm-trainer`, plus:

- Do it at a quiet hour — a restore cancels in-flight queries.
- Keep the export **off** the repo and treat it as personal data (154 real people,
  with password hashes).
- Consider Workers Paid first, for the 30-day window.

---

## 7. What this does and does not protect you from

| Scenario | Covered? |
|---|---|
| Bad migration / schema change | ✅ Time Travel, within the window |
| `DELETE`/`UPDATE` with no `WHERE` | ✅ Time Travel |
| Application bug corrupting rows over hours | ✅ if caught inside the window |
| Mistake noticed after 7 days (Free plan) | ❌ **only your own `d1 export` saves you** |
| Accidental `wrangler d1 delete` of the database | ❌ Time Travel dies with the database — exports only |
| Wanting a copy to test against without touching the original | ❌ no fork/clone yet; `export` then `create` + `execute` |
| Needing an off-Cloudflare copy for compliance | ❌ `d1 export`, or the R2/Workflows scheduled export |

For longer retention Cloudflare documents an automated **export to R2 via
Workflows** pattern. Overkill at your scale — a manual `d1 export` before risky
operations, plus an occasional scheduled one for production, is proportionate.

---

## Sources

- [D1 — Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 — Limits](https://developers.cloudflare.com/d1/platform/limits/) (7 days Free / 30 days Paid)
- [Wrangler — D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/) (`time-travel info`, `time-travel restore`, `export`)
- [Export and save a D1 database via Workflows](https://developers.cloudflare.com/workflows/examples/backup-d1/)
