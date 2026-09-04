/**
 * Exercises the PostgREST-compatible D1 shim against real SQLite, using the
 * production schema. Run: node --experimental-strip-types scripts/test/postgrest.test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createStubD1 } from './d1-stub.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

// Apply every structural migration, in order, so the test database always
// matches production rather than a hand-picked subset.
const migrationDir = join(root, 'migrations')
const migrations = readdirSync(migrationDir)
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort()
  .map((f) => readFileSync(join(migrationDir, f), 'utf8'))

const { database, sqlite } = createStubD1(migrations)

// Point the Worker `env` stub at our SQLite-backed D1 before importing the shim.
const cf = await import('./cloudflare-workers-stub.mjs')
cf.env.DB = database

const { from } = await import('../../src/utils/postgrest.ts')

// --- fixtures ---------------------------------------------------------------
sqlite.exec(`
  INSERT INTO roles (id, name, description, level) VALUES
    ('role-admin','ADMIN','Full access',1),
    ('role-trainer','TRAINER','Limited',3);

  INSERT INTO users (id, email, password_hash) VALUES
    ('user-1','a@example.com','x'),
    ('user-2','b@example.com','y');

  INSERT INTO trainers (id, name, rank, status, role_id, is_active, user_id, department) VALUES
    (1,'ALPHA BIN A','KB1','active','role-admin',1,'user-1','PEJABAT'),
    (2,'BRAVO BIN B','KB2','active','role-trainer',1,'user-2','PRAKTIKAL'),
    (3,'CHARLIE BIN C','KB3','inactive','role-trainer',0,NULL,'PRAKTIKAL');

  INSERT INTO events (id, name, category, start_date, end_date) VALUES
    (10,'Alpha Course','Safety Training','2026-03-01','2026-03-05'),
    (11,'Bravo Course','Team Building','2026-04-10','2026-04-12');

  INSERT INTO schedules (id, trainer_id, date, availability, status, notes) VALUES
    (100,1,'2026-03-02','["AM","PM"]','scheduled','Assigned to: Alpha Course'),
    (101,2,'2026-03-03','[]','available',NULL);

  INSERT INTO physical_training (id, date, training_type, in_charge, participants, time_slot) VALUES
    (200,'2026-03-02','Agility Exercises','ALPHA BIN A','[1,2]','6:00 PM - 7:00 PM');

  INSERT INTO religious_activities (id, date, activity, in_charge, participants) VALUES
    (300,'2026-03-02','Quran Recitation','ALPHA BIN A','[2]');
`)

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ok   ${name}`)
    passed++
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`)
    failed++
  }
}

console.log('\nPostgREST-over-D1 shim')

// --- select -----------------------------------------------------------------
await test('select * returns all rows', async () => {
  const { data, error } = await from('events').select('*')
  assert.equal(error, null)
  assert.equal(data.length, 2)
})

await test('select decodes JSON array columns back into arrays', async () => {
  const { data } = await from('schedules').select('*').eq('id', 100)
  assert.deepEqual(data[0].availability, ['AM', 'PM'])
  const pt = await from('physical_training').select('*').eq('id', 200)
  assert.deepEqual(pt.data[0].participants, [1, 2])
})

await test('select decodes INTEGER booleans back into booleans', async () => {
  const { data } = await from('trainers').select('*').eq('id', 1)
  assert.equal(data[0].is_active, true)
  const off = await from('trainers').select('*').eq('id', 3)
  assert.equal(off.data[0].is_active, false)
})

await test('select with explicit column list returns only those columns', async () => {
  const { data } = await from('trainers').select('id, name').eq('id', 1)
  assert.deepEqual(Object.keys(data[0]).sort(), ['id', 'name'])
})

await test('embedded to-one resource resolves (trainers -> roles)', async () => {
  const { data } = await from('trainers').select('*, roles(name)').eq('id', 1)
  assert.deepEqual(data[0].roles, { name: 'ADMIN' })
})

await test('embedded resource honours an alias (trainer:trainers)', async () => {
  const { data } = await from('schedules')
    .select('*, trainer:trainers(id, name, rank)')
    .eq('id', 100)
  assert.equal(data[0].trainer.name, 'ALPHA BIN A')
  assert.equal(data[0].trainer.rank, 'KB1')
})

await test('embedded resource is null when the foreign key is null', async () => {
  const { data } = await from('trainers').select('*, roles(name)').eq('id', 3)
  assert.equal(data[0].roles.name, 'TRAINER')
  const orphan = await from('schedules')
    .insert({ trainer_id: null, date: '2026-05-01' })
    .select()
    .single()
  const { data: rows } = await from('schedules')
    .select('*, trainer:trainers(id, name)')
    .eq('id', orphan.data.id)
  assert.equal(rows[0].trainer, null)
})

await test('foreign key fetched for an embed is dropped from a narrow select', async () => {
  const { data } = await from('trainers').select('name, roles(name)').eq('id', 1)
  assert.deepEqual(Object.keys(data[0]).sort(), ['name', 'roles'])
})

// --- filters ----------------------------------------------------------------
await test('eq / gte / lte filter correctly', async () => {
  const { data } = await from('trainers').select('*').eq('status', 'active')
  assert.equal(data.length, 2)
  const ev = await from('events').select('*').gte('start_date', '2026-04-01')
  assert.equal(ev.data.length, 1)
  const ev2 = await from('events').select('*').lte('start_date', '2026-03-31')
  assert.equal(ev2.data.length, 1)
})

await test('or() reproduces the overlapping-window filter', async () => {
  const { data } = await from('events')
    .select('*')
    .or('start_date.lte.2026-03-31,end_date.gte.2026-03-01')
  assert.equal(data.length, 2)
})

await test('in() filters by a list, and an empty list matches nothing', async () => {
  const { data } = await from('trainers').select('*').in('id', [1, 3])
  assert.equal(data.length, 2)
  const none = await from('trainers').select('*').in('id', [])
  assert.equal(none.data.length, 0)
})

await test('ilike() matches case-insensitively', async () => {
  const { data } = await from('schedules').select('*').ilike('notes', '%alpha course%')
  assert.equal(data.length, 1)
})

await test('contains() matches inside a JSON array column', async () => {
  const { data } = await from('physical_training').select('id').contains('participants', [2])
  assert.equal(data.length, 1)
  const miss = await from('physical_training').select('id').contains('participants', [99])
  assert.equal(miss.data.length, 0)
  const ra = await from('religious_activities').select('id').contains('participants', [2])
  assert.equal(ra.data.length, 1)
})

await test('order() and limit() apply', async () => {
  const { data } = await from('events').select('*').order('start_date', { ascending: false })
  assert.equal(data[0].id, 11)
  const one = await from('events').select('*').order('start_date').limit(1)
  assert.equal(one.data.length, 1)
  assert.equal(one.data[0].id, 10)
})

// --- single -----------------------------------------------------------------
await test('single() returns one object, not a list', async () => {
  const { data, error } = await from('events').select('*').eq('id', 10).single()
  assert.equal(error, null)
  assert.equal(data.name, 'Alpha Course')
})

await test('single() with no match yields PGRST116, as PostgREST does', async () => {
  const { data, error } = await from('events').select('*').eq('id', 9999).single()
  assert.equal(data, null)
  assert.equal(error.code, 'PGRST116')
})

// --- errors -----------------------------------------------------------------
await test('unknown column reports 42703 (events.trainer_ids stays broken as in prod)', async () => {
  const { data, error } = await from('events').select('id').contains('trainer_ids', [1])
  assert.equal(data, null)
  assert.equal(error.code, '42703')
})

await test('unknown table reports 42P01', async () => {
  const { error } = await from('not_a_table').select('*')
  assert.equal(error.code, '42P01')
})

// --- insert -----------------------------------------------------------------
await test('insert one row and return it via select().single()', async () => {
  const { data, error } = await from('events')
    .insert({ name: 'Charlie Course', category: 'Special Event', start_date: '2026-06-01', end_date: '2026-06-02' })
    .select()
    .single()
  assert.equal(error, null)
  assert.equal(data.name, 'Charlie Course')
  assert.ok(data.id > 0)
})

await test('insert many rows, encoding arrays into JSON', async () => {
  const rows = [
    { trainer_id: 1, date: '2026-07-01', availability: ['AM'], status: 'scheduled', notes: 'x' },
    { trainer_id: 2, date: '2026-07-01', availability: [], status: 'scheduled', notes: 'y' },
  ]
  const { error } = await from('schedules').insert(rows)
  assert.equal(error, null)
  const { data } = await from('schedules').select('*').eq('date', '2026-07-01')
  assert.equal(data.length, 2)
  assert.deepEqual(data.find((r) => r.trainer_id === 1).availability, ['AM'])
})

await test('insert batches large payloads without exceeding bind limits', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({
    trainer_id: 1,
    date: '2026-08-01',
    availability: [],
    status: 'scheduled',
    notes: `bulk ${i}`,
  }))
  const { error } = await from('schedules').insert(rows)
  assert.equal(error, null)
  const { data } = await from('schedules').select('id').eq('date', '2026-08-01')
  assert.equal(data.length, 250)
})

await test('insert rejects an unknown column', async () => {
  const { error } = await from('events').insert({ name: 'x', category: 'y', start_date: '2026-01-01', end_date: '2026-01-01', bogus: 1 })
  assert.equal(error.code, '42703')
})

// --- update -----------------------------------------------------------------
await test('update with eq() changes only the matching row', async () => {
  const { error } = await from('trainers').update({ rank: 'KB9' }).eq('id', 2)
  assert.equal(error, null)
  const { data } = await from('trainers').select('rank').eq('id', 2).single()
  assert.equal(data.rank, 'KB9')
  const other = await from('trainers').select('rank').eq('id', 1).single()
  assert.equal(other.data.rank, 'KB1')
})

await test('update encodes booleans and arrays on the way in', async () => {
  await from('trainers').update({ is_active: false }).eq('id', 2)
  const { data } = await from('trainers').select('*').eq('id', 2).single()
  assert.equal(data.is_active, false)

  await from('physical_training').update({ participants: [3, 4, 5] }).eq('id', 200)
  const pt = await from('physical_training').select('*').eq('id', 200).single()
  assert.deepEqual(pt.data.participants, [3, 4, 5])
})

await test('update ... select().single() returns the updated row', async () => {
  const { data, error } = await from('events')
    .update({ description: 'updated' })
    .eq('id', 10)
    .select()
    .single()
  assert.equal(error, null)
  assert.equal(data.description, 'updated')
})

// --- delete -----------------------------------------------------------------
await test('delete with eq() removes the row and can return it', async () => {
  const { data, error } = await from('schedules').delete().eq('id', 101).select()
  assert.equal(error, null)
  assert.equal(data.length, 1)
  const { data: gone } = await from('schedules').select('*').eq('id', 101)
  assert.equal(gone.length, 0)
})

await test('delete without select() still removes rows', async () => {
  await from('event_trainer_schedule').insert([
    { event_id: 10, trainer_id: 1 },
    { event_id: 10, trainer_id: 2 },
  ])
  const { error } = await from('event_trainer_schedule').delete().eq('event_id', 10)
  assert.equal(error, null)
  const { data } = await from('event_trainer_schedule').select('*').eq('event_id', 10)
  assert.equal(data.length, 0)
})

// --- dormitory visitors (added after the port, by 0004/0005) ------------------
await test('a dormitory assignment can point at a visitor instead of a trainer', async () => {
  const v = await from('dormitory_visitors')
    .insert({ name: 'Guest Instructor', organization: 'JBPM', batch_id: 'batch-1' })
    .select()
    .single()
  assert.equal(v.error, null)

  const a = await from('dormitory_assignments')
    .insert({ room_id: 'Block A - Room 9', visitor_id: v.data.id, status: 'active' })
    .select()
    .single()
  assert.equal(a.error, null)
  assert.equal(a.data.trainer_id, null)
  assert.equal(a.data.visitor_id, v.data.id)
})

await test('embedded visitor resolves on a dormitory assignment', async () => {
  const { data } = await from('dormitory_assignments')
    .select('*, visitor:dormitory_visitors(id, name, organization)')
    .eq('room_id', 'Block A - Room 9')
  assert.equal(data.length, 1)
  assert.equal(data[0].visitor.name, 'Guest Instructor')
  assert.equal(data[0].visitor.organization, 'JBPM')
})

await test('a visitor batch can be selected and removed as a group', async () => {
  await from('dormitory_visitors').insert([
    { name: 'Party A', organization: 'MOH', batch_id: 'batch-2' },
    { name: 'Party B', organization: 'MOH', batch_id: 'batch-2' },
    { name: 'Solo', organization: 'MOH', batch_id: null },
  ])
  const { data } = await from('dormitory_visitors').select('id, name').eq('batch_id', 'batch-2')
  assert.equal(data.length, 2)

  const { error } = await from('dormitory_visitors').delete().eq('batch_id', 'batch-2')
  assert.equal(error, null)
  const { data: left } = await from('dormitory_visitors').select('id').eq('batch_id', 'batch-2')
  assert.equal(left.length, 0)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
