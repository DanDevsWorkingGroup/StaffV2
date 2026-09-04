/**
 * Generates seeds/dummy.sql — synthetic data for staging and dev.
 *
 * Every account uses the same password so the environments are easy to poke at;
 * that is fine precisely because none of this data is real. Production is
 * seeded from seeds/production.sql instead and never from this file.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'seeds', 'dummy.sql')

const PASSWORD = 'AbpmDev123!'
const hash = bcrypt.hashSync(PASSWORD, 10)

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (Array.isArray(v) || typeof v === 'object') return lit(JSON.stringify(v))
  return `'${String(v).replace(/'/g, "''")}'`
}
const row = (vals) => `  (${vals.map(lit).join(', ')})`

// Role ids match production so exported RBAC behaviour is comparable.
const ROLES = [
  ['e5c3aee5-d3d8-4eee-af52-27bd9769007c', 'ADMIN', 'System Administrator - Full Access', 1],
  ['913dbaa9-c602-48c3-bca8-5663f8472b90', 'COORDINATOR', 'Module Coordinator - Management Access', 2],
  ['c703e414-a585-4ba0-b3df-0709edd5cbe8', 'EVENT COORDINATOR', 'Events module admin', 2],
  ['de8ae362-5cbf-461a-9957-daf96ff36677', 'DORMITORY COORDINATOR', 'Dormitory module admin', 2],
  ['f9f4b473-5f8c-443d-921c-342d9a25e97a', 'PT COORDINATOR', 'Physical Training module admin', 2],
  ['51fea4d6-0730-4f6c-bf3d-9066da7ac02a', 'RA COORDINATOR', 'Religious Activities module admin', 2],
  ['1edfc25f-7e3a-48a9-9bc4-ecc6184bb72a', 'TRAINER', 'Standard Trainer - Limited Access', 3],
]

const RESOURCES = ['events', 'schedules', 'trainers', 'dormitory', 'physical_training', 'religious_activities']
const ACTIONS = ['create', 'read', 'update', 'delete']

const permissions = []
for (const r of RESOURCES) {
  for (const a of ACTIONS) {
    permissions.push([`perm-${r}-${a}`, `${r}.${a}`, r, a, `${a} ${r}`])
  }
}

// ADMIN gets everything; each coordinator gets its own module plus read on the
// rest; TRAINER is read-only.
const modulesByRole = {
  'COORDINATOR': RESOURCES,
  'EVENT COORDINATOR': ['events', 'schedules'],
  'DORMITORY COORDINATOR': ['dormitory'],
  'PT COORDINATOR': ['physical_training'],
  'RA COORDINATOR': ['religious_activities'],
}
const rolePerms = []
for (const [roleId, roleName] of ROLES) {
  for (const p of permissions) {
    const [permId, , resource, action] = p
    let grant = false
    if (roleName === 'ADMIN') grant = true
    else if (roleName === 'TRAINER') grant = action === 'read'
    else grant = (modulesByRole[roleName] ?? []).includes(resource) || action === 'read'
    if (grant) rolePerms.push([`rp-${roleName.replace(/ /g, '_')}-${permId}`, roleId, permId])
  }
}

const REGIONS = [
  [1, 'Terengganu', 'TRG', 3, 12],
  [2, 'Kelantan', 'KTN', 2, 8],
  [3, 'Pahang', 'PHG', 2, 9],
  [4, 'Selangor', 'SGR', 4, 15],
]

const FIRST = ['Adam', 'Bakri', 'Chandra', 'Danish', 'Ehsan', 'Faridah', 'Ghani', 'Hafiz', 'Intan', 'Jamal',
  'Kamal', 'Lina', 'Marwan', 'Nadia', 'Omar', 'Puteri', 'Qistina', 'Rizal', 'Suria', 'Taufik']
const LAST = ['Abdullah', 'Bakar', 'Chong', 'Daud', 'Embong', 'Fauzi', 'Ghazali', 'Hashim', 'Ismail', 'Jalil']
const RANKS = ['KB1', 'KB3', 'KB5', 'KB10', 'KB13', 'PgKB II', 'PPjB']
const DEPARTMENTS = ['PEJABAT KOMANDAN', 'PENGAJIAN KESELAMATAN KEBAKARAN', 'CAWANGAN PRAKTIKAL', 'PENGAJIAN PENYELAMATAN']
const SPECIALISATIONS = ['Rescue', 'Fire Safety', 'Hazmat', 'Training', 'Logistics']

// Deterministic output: the same seed file every run, so diffs stay readable.
let n = 0
const pick = (arr) => arr[(n++ * 7919) % arr.length]

const users = []
const trainers = []

// One named account per role, so every permission path can be exercised.
ROLES.forEach(([roleId, roleName], i) => {
  const slug = roleName.toLowerCase().replace(/ /g, '')
  const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
  users.push([id, `${slug}@abpm.test`, hash, '2026-01-01T00:00:00.000Z'])
  trainers.push([
    i + 1, `${roleName} DEMO`, RANKS[i % RANKS.length], 'active',
    SPECIALISATIONS[i % SPECIALISATIONS.length], roleId, 1, id,
    REGIONS[i % REGIONS.length][1], DEPARTMENTS[i % DEPARTMENTS.length],
  ])
})

// Plus a bench of ordinary trainers to make list and calendar views realistic.
const TRAINER_ROLE = '1edfc25f-7e3a-48a9-9bc4-ecc6184bb72a'
for (let i = 0; i < 33; i++) {
  const idx = ROLES.length + i + 1
  const name = `${pick(FIRST)} ${pick(LAST)}`.toUpperCase()
  const id = `00000000-0000-4000-8000-${String(idx).padStart(12, '0')}`
  users.push([id, `trainer${i + 1}@abpm.test`, hash, '2026-01-01T00:00:00.000Z'])
  trainers.push([
    idx, name, pick(RANKS), i % 11 === 0 ? 'inactive' : 'active', pick(SPECIALISATIONS),
    TRAINER_ROLE, i % 11 === 0 ? 0 : 1, id, pick(REGIONS)[1], pick(DEPARTMENTS),
  ])
}

const CATEGORIES = ['Physical Training', 'Safety Training', 'Emergency Response', 'Leadership Training',
  'Team Building', 'Religious Activity', 'Community Service', 'Special Event']
const COLORS = ['#3b82f6', '#8b5cf6', '#ef4444', '#eab308', '#10b981', '#14b8a6', '#06b6d4', '#ec4899']

const pad = (x) => String(x).padStart(2, '0')
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const shift = (days) => { const d = new Date('2026-09-01T00:00:00Z'); d.setDate(d.getDate() + days); return d }

const events = []
for (let i = 0; i < 24; i++) {
  const start = shift(i * 5 - 40)
  const end = shift(i * 5 - 40 + (i % 4))
  events.push([i + 1, `DEMO COURSE ${String(i + 1).padStart(2, '0')}`, CATEGORIES[i % CATEGORIES.length],
    dateStr(start), dateStr(end), `Synthetic event ${i + 1} for testing`, COLORS[i % COLORS.length]])
}

const schedules = []
let sid = 1
for (const ev of events) {
  const evId = ev[0]
  const start = new Date(`${ev[3]}T00:00:00Z`)
  const end = new Date(`${ev[4]}T00:00:00Z`)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    for (let k = 0; k < 3; k++) {
      const trainerId = ((evId + k) % trainers.length) + 1
      schedules.push([sid++, trainerId, dateStr(d), [], 'scheduled', `Assigned to: ${ev[1]}`])
    }
  }
}

const PT_TYPES = ['Physical Fitness Training', 'Agility Exercises', 'Endurance Training', 'Strength Conditioning']
const SLOTS = ['5:00 PM - 6:00 PM', '6:00 PM - 7:00 PM']
const physical = []
for (let i = 0; i < 12; i++) {
  physical.push([i + 1, dateStr(shift(i * 3 - 15)), PT_TYPES[i % PT_TYPES.length],
    trainers[i % trainers.length][1], [1, 2, 3, 4].map((k) => ((i + k) % trainers.length) + 1),
    SLOTS[i % SLOTS.length]])
}

const RA_TYPES = ['Quran Recitation', 'Islamic Studies', 'Religious Lecture', 'Dua & Dhikr', 'Tafsir Session']
const religious = []
for (let i = 0; i < 12; i++) {
  religious.push([i + 1, dateStr(shift(i * 3 - 15)), RA_TYPES[i % RA_TYPES.length],
    trainers[(i + 2) % trainers.length][1], [1, 2, 3].map((k) => ((i + k * 2) % trainers.length) + 1)])
}

const BLOCKS = ['A', 'B', 'C']
const dorm = []
let did = 1
for (let i = 0; i < 18; i++) {
  const room = `Block ${BLOCKS[i % 3]} - Room ${(i % 6) + 1}`
  dorm.push([did++, room, (i % trainers.length) + 1, null, '2026-08-20T00:00:00.000Z', 'active'])
}
const visitors = []
for (let i = 0; i < 6; i++) {
  visitors.push([i + 1, `Demo Visitor ${i + 1}`, ['JBPM Selangor', 'Universiti Malaya', 'MOH'][i % 3],
    `01${i}-000000${i}`, `88010100${i}`, 'Synthetic visitor', i < 3 ? 'demo-batch-1' : null])
}
for (let i = 0; i < 6; i++) {
  dorm.push([did++, `Block C - Room ${(i % 4) + 1}`, null, i + 1, '2026-08-25T00:00:00.000Z', 'active'])
}

const out = []
const w = (s) => out.push(s)

w('-- Synthetic data for staging and dev. Generated by scripts/build-dummy-seed.mjs.')
w('--')
w(`-- Every account uses the password: ${PASSWORD}`)
w('-- Role accounts are <role>@abpm.test, e.g. admin@abpm.test, ptcoordinator@abpm.test.')
w('-- Ordinary trainers are trainer1@abpm.test .. trainer33@abpm.test.')
w('--')
w('-- None of this is real. Production data lives in seeds/production.sql.')
w('')
w('PRAGMA defer_foreign_keys = TRUE;')
w('')
w('DELETE FROM event_trainer_schedule;')
w('DELETE FROM dormitory_assignments;')
w('DELETE FROM dormitory_visitors;')
w('DELETE FROM religious_activities;')
w('DELETE FROM physical_training;')
w('DELETE FROM schedules;')
w('DELETE FROM events;')
w('DELETE FROM training_sessions;')
w('DELETE FROM sessions;')
w('DELETE FROM trainers;')
w('DELETE FROM users;')
w('DELETE FROM role_permissions;')
w('DELETE FROM permissions;')
w('DELETE FROM roles;')
w('DELETE FROM regions;')
w('')

const batch = (table, cols, rows, size = 40) => {
  if (!rows.length) return
  w(`-- ${table}`)
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size)
    w(`INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${slice.map(row).join(',\n')};`)
  }
  w('')
}

batch('roles', ['id', 'name', 'description', 'level'], ROLES)
batch('permissions', ['id', 'name', 'resource', 'action', 'description'], permissions)
batch('role_permissions', ['id', 'role_id', 'permission_id'], rolePerms)
batch('regions', ['id', 'name', 'code', 'training_centers', 'active_trainers'], REGIONS)
batch('users', ['id', 'email', 'password_hash', 'email_confirmed_at'], users)
batch('trainers', ['id', 'name', 'rank', 'status', 'specialization', 'role_id', 'is_active', 'user_id', 'region', 'department'], trainers)
batch('events', ['id', 'name', 'category', 'start_date', 'end_date', 'description', 'color'], events)
batch('schedules', ['id', 'trainer_id', 'date', 'availability', 'status', 'notes'], schedules, 60)
batch('physical_training', ['id', 'date', 'training_type', 'in_charge', 'participants', 'time_slot'], physical)
batch('religious_activities', ['id', 'date', 'activity', 'in_charge', 'participants'], religious)
batch('dormitory_visitors', ['id', 'name', 'organization', 'phone', 'id_number', 'notes', 'batch_id'], visitors)
batch('dormitory_assignments', ['id', 'room_id', 'trainer_id', 'visitor_id', 'check_in', 'status'], dorm)

w('-- keep AUTOINCREMENT counters ahead of the seeded ids')
for (const t of ['regions', 'trainers', 'events', 'schedules', 'physical_training', 'religious_activities', 'dormitory_assignments', 'dormitory_visitors']) {
  w(`INSERT INTO sqlite_sequence (name, seq) SELECT '${t}', COALESCE((SELECT MAX(id) FROM ${t}), 0)\n  WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '${t}');`)
  w(`UPDATE sqlite_sequence SET seq = COALESCE((SELECT MAX(id) FROM ${t}), 0) WHERE name = '${t}';`)
}

writeFileSync(OUT, out.join('\n') + '\n')
console.log(`wrote ${OUT}`)
console.table({
  roles: ROLES.length, permissions: permissions.length, role_permissions: rolePerms.length,
  regions: REGIONS.length, users: users.length, trainers: trainers.length, events: events.length,
  schedules: schedules.length, physical_training: physical.length,
  religious_activities: religious.length, dormitory_visitors: visitors.length,
  dormitory_assignments: dorm.length,
})
