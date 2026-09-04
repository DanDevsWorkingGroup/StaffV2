/**
 * Applies every structural migration, in order, to one environment's D1, then
 * loads that environment's seed.
 *
 * Usage: node scripts/db-setup.mjs <dev|staging|production> [--local]
 *
 * Production is deliberately awkward: it refuses to load a seed unless you pass
 * --seed-production, because seeds/production.sql is a full overwrite of real
 * records and is only ever meant for rebuilding the database from scratch.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const args = process.argv.slice(2)
const env = args.find((a) => !a.startsWith('--'))
const local = args.includes('--local')
const seedProduction = args.includes('--seed-production')

const DATABASES = {
  production: 'abpm-trainer',
  staging: 'abpm-trainer-staging',
  dev: 'abpm-trainer-dev',
}

if (!env || !(env in DATABASES)) {
  console.error('Usage: node scripts/db-setup.mjs <dev|staging|production> [--local] [--seed-production]')
  process.exit(1)
}

const database = DATABASES[env]
const seed = env === 'production' ? 'seeds/production.sql' : 'seeds/dummy.sql'

if (env === 'production' && !seedProduction) {
  console.error(
    'Refusing to seed production without --seed-production.\n' +
    'seeds/production.sql replaces every row; it is for rebuilding from scratch, not routine use.',
  )
  process.exit(1)
}

const migrations = readdirSync(join(root, 'migrations'))
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort()

if (!existsSync(join(root, seed))) {
  console.error(`Missing seed file: ${seed}`)
  process.exit(1)
}

const run = (file) => {
  const flags = local ? ['--local'] : ['--remote', '--yes']
  process.stdout.write(`  ${file.padEnd(42)}`)
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', database, ...flags, `--file=${file}`], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    console.log('ok')
  } catch (err) {
    console.log('FAILED')
    console.error(String(err.stdout ?? '') + String(err.stderr ?? ''))
    process.exit(1)
  }
}

console.log(`\nEnvironment : ${env}`)
console.log(`Database    : ${database} (${local ? 'local' : 'remote'})`)
console.log(`Seed        : ${seed}\n`)

console.log('Migrations:')
for (const m of migrations) run(join('migrations', m))

console.log('\nSeed:')
run(seed)

console.log('\nDone.')
