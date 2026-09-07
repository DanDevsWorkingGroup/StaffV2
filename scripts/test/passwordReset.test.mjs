/**
 * Exercises the logged-out password-reset OTP flow against real SQLite, using
 * the production schema.
 *
 * Run: node --experimental-strip-types --import ./scripts/test/register.mjs \
 *        scripts/test/passwordReset.test.mjs
 *
 * The cookie helpers from `@tanstack/react-start/server` need a request context
 * that does not exist outside a Worker, so they are stubbed by the loader with
 * a simple in-memory jar (see ./start-server-stub.mjs).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createStubD1 } from './d1-stub.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

const schema = readFileSync(join(root, 'migrations', '0001_schema.sql'), 'utf8')
const otpSchema = readFileSync(
  join(root, 'migrations', '0006_password_reset_otps.sql'),
  'utf8',
)

const { database, sqlite } = createStubD1([schema, otpSchema])

const cf = await import('./cloudflare-workers-stub.mjs')
cf.env.DB = database
cf.env.OTP_PEPPER = 'test-pepper-not-a-real-secret'
// No RESEND_API_KEY: sendEmail() must degrade to a logged no-op, not throw.

const cookies = await import('./start-server-stub.mjs')

const {
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  completePasswordReset,
  generateOtp,
  normalizeCode,
  hmacOtp,
} = await import('../../src/utils/passwordReset.ts')

const { hashPassword, verifyPassword } = await import('../../src/utils/auth.ts')

// --- fixtures ---------------------------------------------------------------

const ORIGINAL_PASSWORD = 'original-password-123'

async function reseed() {
  sqlite.exec(`
    DELETE FROM password_reset_otps;
    DELETE FROM password_reset_throttle;
    DELETE FROM sessions;
    DELETE FROM users;
  `)
  const hash = await hashPassword(ORIGINAL_PASSWORD)
  const stmt = sqlite.prepare(
    'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
  )
  stmt.run('user-1', 'trainer@bomba.gov.my', hash)
  stmt.run('user-2', 'other@gmail.com', hash)

  sqlite
    .prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
    .run('sess-a', 'user-1', '2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z')
  sqlite
    .prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
    .run('sess-b', 'user-1', '2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z')
  sqlite
    .prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
    .run('sess-other', 'user-2', '2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z')

  cookies.__reset()
}

/**
 * The code is never stored, so tests recover it the only way an attacker
 * could not: by brute-forcing the 10^6 space against the row's HMAC. That is
 * slow, so instead we search a small candidate set produced by the same RNG —
 * simpler: read it back by re-hashing candidates is impractical, so we patch
 * the row with a known code instead.
 */
async function plantCode(userId, code) {
  const hash = await hmacOtp(code)
  sqlite
    .prepare('UPDATE password_reset_otps SET code_hash = ? WHERE user_id = ?')
    .run(hash, userId)
}

function otpRows(userId) {
  return sqlite
    .prepare('SELECT * FROM password_reset_otps WHERE user_id = ?')
    .all(userId)
}

function sessionCount(userId) {
  return sqlite
    .prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
    .get(userId).n
}

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await reseed()
    await fn()
    console.log(`  ok   ${name}`)
    passed++
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`)
    failed++
  }
}

console.log('\nPassword reset OTP flow')

// --- code generation --------------------------------------------------------

await test('generateOtp produces six digits, and varies', async () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const code = generateOtp()
    assert.match(code, /^\d{6}$/)
    seen.add(code)
  }
  assert.ok(seen.size > 150, `expected variety, got ${seen.size} distinct`)
})

await test('normalizeCode strips spaces and punctuation', async () => {
  assert.equal(normalizeCode('481 902'), '481902')
  assert.equal(normalizeCode('481-902'), '481902')
  assert.equal(normalizeCode(' 481902\n'), '481902')
})

// --- step 1 -----------------------------------------------------------------

await test('unknown email inserts no row and still returns ok', async () => {
  const result = await requestPasswordResetOtp('nobody@example.com', '1.2.3.4')
  assert.deepEqual(result, { ok: true })
  const rows = sqlite.prepare('SELECT COUNT(*) AS n FROM password_reset_otps').get()
  assert.equal(rows.n, 0)
})

await test('known email inserts exactly one row, code not stored in clear', async () => {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  const rows = otpRows('user-1')
  assert.equal(rows.length, 1)
  assert.match(rows[0].code_hash, /^[0-9a-f]{64}$/)
  assert.equal(rows[0].attempts, 0)
  assert.equal(rows[0].verified_at, null)
  assert.equal(rows[0].consumed_at, null)
})

await test('expiry window is 20 minutes', async () => {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  const row = otpRows('user-1')[0]
  const span =
    new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()
  assert.equal(span, 20 * 60 * 1000)
})

await test('email lookup is case-insensitive', async () => {
  await requestPasswordResetOtp('TRAINER@BOMBA.GOV.MY', '1.2.3.4')
  assert.equal(otpRows('user-1').length, 1)
})

// --- dev-only code logging -------------------------------------------------
//
// This guard protects a live credential. If it ever regresses, anyone with
// dashboard log access on staging or production can take over any account.

function captureWarnings(fn) {
  return async () => {
    const lines = []
    const original = console.warn
    console.warn = (...args) => lines.push(args.join(' '))
    try {
      await fn(lines)
    } finally {
      console.warn = original
    }
  }
}

const codeLogged = (lines) => lines.some((l) => l.includes('[dev-only]'))

await test(
  'APP_ENV=dev logs the code (so dev can be tested at all)',
  captureWarnings(async (lines) => {
    cf.env.APP_ENV = 'dev'
    try {
      await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
      assert.ok(codeLogged(lines), 'dev must log the code')
      const logged = lines.find((l) => l.includes('[dev-only]'))
      assert.match(logged, /\b\d{6}\b/, 'the logged line must contain the code')
    } finally {
      delete cf.env.APP_ENV
    }
  }),
)

await test(
  'APP_ENV=production NEVER logs the code',
  captureWarnings(async (lines) => {
    cf.env.APP_ENV = 'production'
    try {
      await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
      assert.ok(!codeLogged(lines), 'production must not log the code')
    } finally {
      delete cf.env.APP_ENV
    }
  }),
)

await test(
  'APP_ENV=staging NEVER logs the code',
  captureWarnings(async (lines) => {
    cf.env.APP_ENV = 'staging'
    try {
      await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
      assert.ok(!codeLogged(lines), 'staging must not log the code')
    } finally {
      delete cf.env.APP_ENV
    }
  }),
)

await test(
  'unset APP_ENV fails CLOSED and does not log the code',
  captureWarnings(async (lines) => {
    delete cf.env.APP_ENV
    await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
    assert.ok(
      !codeLogged(lines),
      'an unset APP_ENV must not log — this is why the test is === dev, not !== production',
    )
  }),
)

await test(
  'near-miss APP_ENV values do not log',
  captureWarnings(async (lines) => {
    for (const value of ['DEV', 'dev ', 'development', 'devel', '']) {
      cf.env.APP_ENV = value
      await requestPasswordResetOtp('trainer@bomba.gov.my', `1.2.3.${value.length}`)
      sqlite.exec('DELETE FROM password_reset_otps')
    }
    delete cf.env.APP_ENV
    assert.ok(!codeLogged(lines), 'only the exact string "dev" may enable logging')
  }),
)

// --- throttle table sweep --------------------------------------------------

function throttleRows() {
  return sqlite.prepare('SELECT * FROM password_reset_throttle').all()
}

await test('sweep deletes throttle rows older than 24 hours', async () => {
  // Two stale rows from a long-past window, plus one fresh row.
  const stale = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const ins = sqlite.prepare(
    'INSERT INTO password_reset_throttle (key, count, window_start) VALUES (?, ?, ?)',
  )
  ins.run('email:stale-one', 3, stale)
  ins.run('ip:stale-two', 9, stale)

  assert.equal(throttleRows().length, 2)

  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')

  const remaining = throttleRows().map((r) => r.key)
  assert.ok(!remaining.includes('email:stale-one'), 'stale email row must go')
  assert.ok(!remaining.includes('ip:stale-two'), 'stale ip row must go')
})

await test('sweep does NOT clear an ACTIVE throttle counter', async () => {
  // The dangerous failure: sweeping a live counter would hand an attacker a
  // free reset of their own rate limit.
  for (let i = 0; i < 3; i++) {
    await requestPasswordResetOtp('trainer@bomba.gov.my', '5.5.5.5')
    sqlite.exec('DELETE FROM password_reset_otps')
  }

  const before = throttleRows().find((r) => r.count >= 3)
  assert.ok(before, 'expected a counter at the cap before sweeping')

  // Another request runs the sweep again.
  await requestPasswordResetOtp('trainer@bomba.gov.my', '5.5.5.5')

  const after = throttleRows().find((r) => r.key === before.key)
  assert.ok(after, 'active counter must survive the sweep')
  assert.ok(
    after.count >= 3,
    `active counter was reset by the sweep: ${after.count}`,
  )
  assert.equal(
    otpRows('user-1').length,
    0,
    'throttled request must still issue no code after a sweep',
  )
})

await test('sweep leaves a row from within the last hour alone', async () => {
  const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  sqlite
    .prepare(
      'INSERT INTO password_reset_throttle (key, count, window_start) VALUES (?, ?, ?)',
    )
    .run('email:recent', 2, recent)

  await requestPasswordResetOtp('someone-else@example.com', '9.9.9.9')

  const row = throttleRows().find((r) => r.key === 'email:recent')
  assert.ok(row, 'a 30-minute-old row must not be swept')
  assert.equal(row.count, 2, 'its count must be untouched')
})

await test('responses for known and unknown addresses are identical', async () => {
  const known = await requestPasswordResetOtp('trainer@bomba.gov.my', '1.1.1.1')
  const unknown = await requestPasswordResetOtp('nobody@example.com', '2.2.2.2')
  assert.equal(JSON.stringify(known), JSON.stringify(unknown))
})

await test('4th request in an hour is suppressed but still returns ok', async () => {
  const ip = '9.9.9.9'
  for (let i = 0; i < 3; i++) {
    await requestPasswordResetOtp('trainer@bomba.gov.my', ip)
    // Clear the row so the 60s resend cooldown is not what blocks us.
    sqlite.exec('DELETE FROM password_reset_otps')
  }
  const result = await requestPasswordResetOtp('trainer@bomba.gov.my', ip)
  assert.deepEqual(result, { ok: true })
  assert.equal(otpRows('user-1').length, 0, 'throttled request must not issue a code')
})

await test('throttle counts unknown addresses too (no enumeration oracle)', async () => {
  const ip = '8.8.8.8'
  for (let i = 0; i < 4; i++) {
    await requestPasswordResetOtp('ghost@example.com', ip)
  }
  const row = sqlite
    .prepare('SELECT COUNT(*) AS n FROM password_reset_throttle')
    .get()
  assert.ok(row.n >= 2, 'expected throttle rows for both email and ip buckets')
})

await test('resend cooldown blocks a second code within 60s', async () => {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  const firstHash = otpRows('user-1')[0].code_hash
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  const rows = otpRows('user-1')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].code_hash, firstHash, 'code should not have been reissued')
})

// --- step 2 -----------------------------------------------------------------

await test('correct code verifies and issues a ticket', async () => {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  await plantCode('user-1', '123456')

  const result = await verifyPasswordResetOtp(
    'trainer@bomba.gov.my',
    '123456',
    '1.2.3.4',
  )
  assert.equal(result.ok, true)

  const row = otpRows('user-1')[0]
  assert.ok(row.verified_at)
  assert.match(row.ticket_hash, /^[0-9a-f]{64}$/)
  assert.ok(cookies.__get('abpm_pwreset'), 'ticket cookie should be set')
})

await test('spaced code is accepted', async () => {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  await plantCode('user-1', '123456')
  const result = await verifyPasswordResetOtp(
    'trainer@bomba.gov.my',
    '123 456',
    '1.2.3.4',
  )
  assert.equal(result.ok, true)
})

await test('wrong code fails generically and increments attempts', async () => {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  await plantCode('user-1', '123456')

  const result = await verifyPasswordResetOtp(
    'trainer@bomba.gov.my',
    '000000',
    '1.2.3.4',
  )
  assert.equal(result.ok, false)
  assert.match(result.message, /invalid or expired/i)
  assert.equal(otpRows('user-1')[0].attempts, 1)
})

await test('unknown address gives the same failure as a wrong code', async () => {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  await plantCode('user-1', '123456')

  const wrong = await verifyPasswordResetOtp(
    'trainer@bomba.gov.my',
    '000000',
    '1.2.3.4',
  )
  const ghost = await verifyPasswordResetOtp(
    'ghost@example.com',
    '000000',
    '1.2.3.4',
  )
  assert.equal(JSON.stringify(wrong), JSON.stringify(ghost))
})

await test('six wrong guesses kill the code even if the sixth is right', async () => {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  await plantCode('user-1', '123456')

  for (let i = 0; i < 5; i++) {
    await verifyPasswordResetOtp('trainer@bomba.gov.my', '000000', '1.2.3.4')
  }
  const result = await verifyPasswordResetOtp(
    'trainer@bomba.gov.my',
    '123456',
    '1.2.3.4',
  )
  assert.equal(result.ok, false)
  assert.equal(otpRows('user-1').length, 0, 'exhausted row should be deleted')
})

await test('expired code fails', async () => {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  await plantCode('user-1', '123456')
  sqlite
    .prepare('UPDATE password_reset_otps SET expires_at = ? WHERE user_id = ?')
    .run('2020-01-01T00:00:00.000Z', 'user-1')

  const result = await verifyPasswordResetOtp(
    'trainer@bomba.gov.my',
    '123456',
    '1.2.3.4',
  )
  assert.equal(result.ok, false)
})

await test('a verified code cannot be replayed', async () => {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  await plantCode('user-1', '123456')

  const first = await verifyPasswordResetOtp(
    'trainer@bomba.gov.my',
    '123456',
    '1.2.3.4',
  )
  assert.equal(first.ok, true)

  const second = await verifyPasswordResetOtp(
    'trainer@bomba.gov.my',
    '123456',
    '1.2.3.4',
  )
  assert.equal(second.ok, false)
})

// --- step 3 -----------------------------------------------------------------

async function reachStepThree() {
  await requestPasswordResetOtp('trainer@bomba.gov.my', '1.2.3.4')
  await plantCode('user-1', '123456')
  const verified = await verifyPasswordResetOtp(
    'trainer@bomba.gov.my',
    '123456',
    '1.2.3.4',
  )
  assert.equal(verified.ok, true)
}

await test('happy path changes the password', async () => {
  await reachStepThree()
  const result = await completePasswordReset('brand-new-password', 'brand-new-password')
  assert.equal(result.ok, true)

  const row = sqlite
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get('user-1')
  assert.equal(await verifyPassword('brand-new-password', row.password_hash), true)
  assert.equal(await verifyPassword(ORIGINAL_PASSWORD, row.password_hash), false)
})

await test('all sessions for the user are deleted, others survive', async () => {
  await reachStepThree()
  assert.equal(sessionCount('user-1'), 2)
  assert.equal(sessionCount('user-2'), 1)

  await completePasswordReset('brand-new-password', 'brand-new-password')

  assert.equal(sessionCount('user-1'), 0, 'every session for the user must go')
  assert.equal(sessionCount('user-2'), 1, 'other users must be untouched')
})

await test('the OTP row is consumed and the ticket cleared', async () => {
  await reachStepThree()
  await completePasswordReset('brand-new-password', 'brand-new-password')
  const rows = otpRows('user-1')
  assert.equal(rows.length, 1)
  assert.ok(rows[0].consumed_at)
  assert.equal(rows[0].ticket_hash, null)
})

await test('the ticket cannot be reused for a second reset', async () => {
  await reachStepThree()
  await completePasswordReset('brand-new-password', 'brand-new-password')
  const second = await completePasswordReset('another-password-9', 'another-password-9')
  assert.equal(second.ok, false)
})

await test('step 3 without a ticket fails', async () => {
  cookies.__reset()
  const result = await completePasswordReset('brand-new-password', 'brand-new-password')
  assert.equal(result.ok, false)
})

await test('short password is rejected before anything is written', async () => {
  await reachStepThree()
  const result = await completePasswordReset('short', 'short')
  assert.equal(result.ok, false)
  assert.match(result.message, /at least 10 characters/i)

  const row = sqlite
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get('user-1')
  assert.equal(await verifyPassword(ORIGINAL_PASSWORD, row.password_hash), true)
  assert.equal(sessionCount('user-1'), 2, 'sessions must survive a rejected reset')
})

await test('mismatched confirmation is rejected', async () => {
  await reachStepThree()
  const result = await completePasswordReset('brand-new-password', 'different-password')
  assert.equal(result.ok, false)
  assert.match(result.message, /do not match/i)
})

await test('reusing the current password is refused', async () => {
  await reachStepThree()
  const result = await completePasswordReset(ORIGINAL_PASSWORD, ORIGINAL_PASSWORD)
  assert.equal(result.ok, false)
  assert.match(result.message, /not used before/i)
})

await test('expired ticket fails', async () => {
  await reachStepThree()
  sqlite
    .prepare('UPDATE password_reset_otps SET ticket_expires_at = ? WHERE user_id = ?')
    .run('2020-01-01T00:00:00.000Z', 'user-1')

  const result = await completePasswordReset('brand-new-password', 'brand-new-password')
  assert.equal(result.ok, false)
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
