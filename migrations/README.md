# Database files

`migrations/` holds **structure only** and is applied to every environment, in
filename order.

`seeds/` holds **data**, and which file you apply depends on the environment:

| File                | Used by            | Contents                                            |
| ------------------- | ------------------ | --------------------------------------------------- |
| `seeds/production.sql` | production only | The real records migrated out of self-hosted Supabase |
| `seeds/dummy.sql`      | staging, dev    | Synthetic people and activity, safe to share         |

`seeds/production.sql` carries real names, e-mail addresses and password
hashes, so it must never be loaded into staging or dev. That is the whole
reason the seeds live outside `migrations/` — otherwise "apply every migration"
would quietly copy production personal data into a shared environment.

## Applying

```sh
# Structure (any environment)
for f in migrations/0*.sql; do
  npx wrangler d1 execute abpm-trainer-dev --remote --file="$f"
done

# Data
npx wrangler d1 execute abpm-trainer-dev --remote --file=seeds/dummy.sql
```

Or use the helper, which applies every migration in order plus the right seed:

```sh
npm run db:setup -- dev
npm run db:setup -- staging
```
