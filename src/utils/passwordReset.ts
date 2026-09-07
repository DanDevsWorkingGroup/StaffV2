/**
 * Logged-out "forgot password" flow, by email OTP.
 *
 * Three steps: request a code, verify it, set a new password. See
 * docs/plans/password-reset-otp.md for the full design and rationale.
 *
 * The single most important property of this module is that it leaks NOTHING
 * about which email addresses have accounts. Every step-1 call returns the same
 * body, the same status, and — within measurement noise — the same duration,
 * whether the address is registered, unregistered, throttled, or malformed. Read
 * `withFloor()` and the comments in `requestPasswordReset()` before changing
 * anything here; several of the odd-looking choices (doing work whose result is
 * discarded, not returning early) exist precisely to hold that property.
 */
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { first, run } from './db'
import {
  invalidateAllSessions,
  newToken,
  setUserPassword,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
} from './auth'
import { sendEmail } from './email'
import { resetCodeEmail, passwordChangedEmail } from './emailTemplates'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Digits in the code. 6 is ~19.9 bits; the attempt cap is what makes it safe. */
const CODE_DIGITS = 6

/**
 * How long an issued code stays usable.
 *
 * 20 minutes, not the 10 that is conventional, because of the recipients. Many
 * accounts are @bomba.gov.my and @abpm.gov.my addresses, and government mail
 * gateways commonly greylist: the first delivery attempt from an unrecognised
 * sender is deferred, and the message only arrives on the sender's retry —
 * typically 5-15 minutes later, occasionally more. A 10-minute code would often
 * expire in transit, and the user's fix ("request another") hits the same
 * greylist and the same delay.
 *
 * The cost is small. Brute-force resistance here comes from MAX_ATTEMPTS, not
 * from the window: 5 guesses against a 10^6 space is 5e-6 whether the window is
 * 10 minutes or 20. Doubling it doubles only the time a code sits in an inbox.
 */
const CODE_TTL_MS = 20 * 60 * 1000

/**
 * How long the post-verification ticket stays usable. Stays at 10 minutes — by
 * this point the user is actively on the page, so no mail delay applies.
 */
const TICKET_TTL_MS = 10 * 60 * 1000

/** Wrong guesses allowed against one code before the row is dead. */
const MAX_ATTEMPTS = 5

/** Minimum gap between two codes for the same address. */
const RESEND_COOLDOWN_MS = 60 * 1000

/** Authoritative hourly caps, enforced in D1 (strongly consistent). */
const THROTTLE_WINDOW_MS = 60 * 60 * 1000

/**
 * How stale a throttle row must be before the opportunistic sweep deletes it.
 *
 * 24 hours — deliberately 24× the window it protects. Anything older than one
 * window is already treated as expired by `consumeThrottle()`, so the sweep is
 * behaviour-neutral; the wide margin is only there so that clock skew can never
 * cause a live counter to be dropped.
 */
const THROTTLE_SWEEP_MS = 24 * 60 * 60 * 1000
const MAX_REQUESTS_PER_EMAIL_PER_HOUR = 3
const MAX_REQUESTS_PER_IP_PER_HOUR = 10

/**
 * Every response is padded out to this many milliseconds.
 *
 * The "account exists" path does an HMAC, a couple of D1 writes and an outbound
 * HTTPS call; the "no such account" path does almost none of that. Without a
 * floor, the difference is trivially measurable and the flow becomes an
 * enumeration oracle. 400ms comfortably exceeds the real work on both paths.
 */
const RESPONSE_FLOOR_MS = 400

const TICKET_COOKIE = 'abpm_pwreset'
const TICKET_COOKIE_PATH = '/forgot-password'

/** Minimum length for a new password. There is no policy elsewhere in the app. */
export const MIN_PASSWORD_LENGTH = 10

export type ResetOutcome = { ok: true } | { ok: false; message: string }

/** The one and only failure string for steps 2 and 3. */
const GENERIC_FAILURE = 'Invalid or expired code. Please request a new one.'

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run `work` and return its result no earlier than `RESPONSE_FLOOR_MS` after
 * entry — including when it throws, which is itself a timing signal.
 */
async function withFloor<T>(work: () => Promise<T>, onError: T): Promise<T> {
  const started = Date.now()
  let result: T
  try {
    result = await work()
  } catch (error) {
    console.error(
      `[password-reset] ${error instanceof Error ? error.message : String(error)}`,
    )
    result = onError
  }
  const remaining = RESPONSE_FLOOR_MS - (Date.now() - started)
  if (remaining > 0) await sleep(remaining)
  return result
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * A uniformly random decimal code.
 *
 * Rejection sampling, not `% 10**n` on a raw draw: the naive version biases the
 * low codes, which shrinks the effective search space.
 */
export function generateOtp(digits: number = CODE_DIGITS): string {
  const space = 10 ** digits
  const limit = Math.floor(0xffffffff / space) * space
  const buffer = new Uint32Array(1)
  let draw: number
  do {
    crypto.getRandomValues(buffer)
    draw = buffer[0]
  } while (draw >= limit)
  return String(draw % space).padStart(digits, '0')
}

/** Strip everything a user might paste around the digits. */
export function normalizeCode(code: string): string {
  return (code ?? '').replace(/\D/g, '')
}

function otpPepper(): string {
  const pepper = (env as unknown as { OTP_PEPPER?: string }).OTP_PEPPER
  if (!pepper) {
    // Loud in logs, but must not change the shape or timing of any response, so
    // we fall back rather than throw. A fixed dev pepper keeps local testing
    // working; production must set the secret.
    console.error(
      '[password-reset] OTP_PEPPER is not set — using an insecure development pepper',
    )
    return 'insecure-development-pepper'
  }
  return pepper
}

/**
 * HMAC-SHA256 of the code, keyed by a Worker secret that never reaches the
 * database. Without the key, a stolen D1 snapshot would let an attacker
 * precompute all 10^6 digests and read live codes straight out of the table.
 */
export async function hmacOtp(code: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(otpPepper()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(code),
  )
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Print a freshly issued code to the Worker log — ON THE dev ENVIRONMENT ONLY.
 *
 * WHY THIS EXISTS
 * ---------------
 * The dev and staging databases are seeded with `@abpm.test` addresses. `.test`
 * is a reserved TLD (RFC 6761) that can never receive mail, so no OTP can ever
 * be delivered on those environments. The code is not stored either — D1 holds
 * only `HMAC-SHA256(OTP_PEPPER, code)` — so without this line there is no way to
 * complete a reset on dev and the flow cannot be tested end to end at all.
 *
 * WHY IT IS SAFE HERE AND NOWHERE ELSE
 * ------------------------------------
 * This writes a live, currently-valid credential into Workers Logs, which are
 * retained and readable by anyone with dashboard access. On dev that is
 * acceptable: the accounts are synthetic and the database holds no real person.
 * On staging or production it would be a credential disclosure — anyone who can
 * read logs could take over any account by requesting a reset for it.
 *
 * THE GUARD MUST NOT BE RELAXED
 * -----------------------------
 * The test is `=== 'dev'`, deliberately, and not `!== 'production'`. The latter
 * would also fire on staging, and — far worse — would fire anywhere `APP_ENV` is
 * unset, which is every environment that forgets to declare it, including a
 * misconfigured production Worker. Fail closed: unknown environment means no
 * logging. Do not change this to a negative test, do not add `|| !APP_ENV`, and
 * do not extend it to staging "just to debug something".
 */
function logCodeForDevOnly(email: string, code: string): void {
  if ((env as unknown as { APP_ENV?: string }).APP_ENV !== 'dev') return
  console.warn(
    `[password-reset][dev-only] code for ${email}: ${code} — this line must never appear outside the dev environment`,
  )
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Throttling
// ---------------------------------------------------------------------------

/**
 * Consume one unit against a rolling hourly bucket. Returns false when the cap
 * is already reached.
 *
 * Called for unregistered addresses too — see the migration comment. The key is
 * hashed so the table never holds a plaintext address or IP.
 */
export async function consumeThrottle(
  rawKey: string,
  limit: number,
  now: Date = new Date(),
): Promise<boolean> {
  const key = await sha256Hex(rawKey)
  const nowIso = now.toISOString()

  const existing = await first<{ count: number; window_start: string }>(
    'SELECT count, window_start FROM password_reset_throttle WHERE key = ?',
    key,
  )

  if (!existing) {
    await run(
      'INSERT INTO password_reset_throttle (key, count, window_start) VALUES (?, 1, ?)',
      key,
      nowIso,
    )
    return true
  }

  const windowAge = now.getTime() - new Date(existing.window_start).getTime()

  if (windowAge > THROTTLE_WINDOW_MS) {
    await run(
      'UPDATE password_reset_throttle SET count = 1, window_start = ? WHERE key = ?',
      nowIso,
      key,
    )
    return true
  }

  if (existing.count >= limit) return false

  await run(
    'UPDATE password_reset_throttle SET count = count + 1 WHERE key = ?',
    key,
  )
  return true
}

/**
 * The Workers rate-limit binding, when configured — a cheap per-datacentre burst
 * guard in front of the authoritative D1 counters. Absent binding means absent
 * guard, not a failure: D1 is what actually enforces the caps.
 */
async function burstGuard(binding: string, key: string): Promise<boolean> {
  const limiter = (env as unknown as Record<string, { limit?: (o: { key: string }) => Promise<{ success: boolean }> }>)[binding]
  if (!limiter?.limit) return true
  try {
    const { success } = await limiter.limit({ key })
    return success
  } catch {
    return true
  }
}

// ---------------------------------------------------------------------------
// Step 1 — request a code
// ---------------------------------------------------------------------------

/**
 * Always resolves to `{ ok: true }`. There is no input, no account state and no
 * infrastructure failure that produces a different answer.
 */
export async function requestPasswordResetOtp(
  email: string,
  ip: string,
): Promise<{ ok: true }> {
  return await withFloor(async () => {
    const normalized = (email ?? '').trim()
    const emailLower = normalized.toLowerCase()
    const now = new Date()

    // Opportunistic cleanup. There is no cron on this Worker and the volume is
    // tiny, so expired rows are swept on the way past.
    await run(
      'DELETE FROM password_reset_otps WHERE expires_at < ?',
      new Date(now.getTime() - CODE_TTL_MS).toISOString(),
    )

    // Throttle rows would otherwise accumulate forever — one per distinct email
    // hash and IP hash ever seen. A row whose window opened more than
    // THROTTLE_SWEEP_MS ago is already dead: consumeThrottle() resets any window
    // older than THROTTLE_WINDOW_MS to a fresh count of 1, so deleting it is
    // exactly equivalent to leaving it. The sweep cutoff is deliberately many
    // multiples of the window, so an *active* counter can never be cleared —
    // that would hand an attacker a free reset of their own rate limit.
    await run(
      'DELETE FROM password_reset_throttle WHERE window_start < ?',
      new Date(now.getTime() - THROTTLE_SWEEP_MS).toISOString(),
    )

    // A flag, not an early return. Every branch below runs the same statements
    // in the same order regardless of whether the account exists.
    let blocked = false

    if (!normalized || !normalized.includes('@')) blocked = true

    if (!(await burstGuard('PW_RESET_REQUEST', `ip:${ip}`))) blocked = true
    if (!(await burstGuard('PW_RESET_REQUEST', `email:${emailLower}`))) blocked = true

    if (!(await consumeThrottle(`ip:${ip}`, MAX_REQUESTS_PER_IP_PER_HOUR, now))) {
      blocked = true
    }
    if (
      !(await consumeThrottle(
        `email:${emailLower}`,
        MAX_REQUESTS_PER_EMAIL_PER_HOUR,
        now,
      ))
    ) {
      blocked = true
    }

    const user = emailLower
      ? await first<{ id: string; email: string }>(
          'SELECT id, email FROM users WHERE lower(email) = lower(?)',
          normalized,
        )
      : null

    // Enforce the resend cooldown against the most recent live code.
    if (user) {
      const recent = await first<{ created_at: string }>(
        `SELECT created_at FROM password_reset_otps
          WHERE user_id = ? AND consumed_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        user.id,
      )
      if (
        recent &&
        now.getTime() - new Date(recent.created_at).getTime() < RESEND_COOLDOWN_MS
      ) {
        blocked = true
      }
    }

    // Generate and hash on BOTH paths. The HMAC is the most expensive
    // synchronous step, so skipping it when the account is unknown would be
    // measurable even with the response floor in place.
    const code = generateOtp()
    const codeHash = await hmacOtp(code)

    if (user && !blocked) {
      // One live code per user: issuing a new one retires the rest.
      await run(
        'DELETE FROM password_reset_otps WHERE user_id = ? AND consumed_at IS NULL',
        user.id,
      )

      await run(
        `INSERT INTO password_reset_otps
           (id, user_id, email_lower, code_hash, attempts, created_at, expires_at, request_ip)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        crypto.randomUUID(),
        user.id,
        emailLower,
        codeHash,
        now.toISOString(),
        new Date(now.getTime() + CODE_TTL_MS).toISOString(),
        ip,
      )

      // Not awaited. The caller's wait must never be a function of the mail
      // provider's latency — that would reintroduce the timing oracle that
      // `withFloor` exists to close. `sendEmail` never throws.
      void sendEmail(resetCodeEmail(user.email, code, CODE_TTL_MS / 60000))

      logCodeForDevOnly(user.email, code)
    }

    return { ok: true as const }
  }, { ok: true as const })
}

// ---------------------------------------------------------------------------
// Step 2 — verify the code
// ---------------------------------------------------------------------------

/**
 * Every failure — wrong code, expired code, no code ever issued, unknown
 * address, attempts exhausted — returns the identical message.
 */
export async function verifyPasswordResetOtp(
  email: string,
  code: string,
  ip: string,
): Promise<ResetOutcome> {
  const failure: ResetOutcome = { ok: false, message: GENERIC_FAILURE }

  return await withFloor(async () => {
    const emailLower = (email ?? '').trim().toLowerCase()
    const normalizedCode = normalizeCode(code)
    const now = new Date()

    let blocked = false
    if (!(await burstGuard('PW_RESET_VERIFY', `ip:${ip}`))) blocked = true

    const row = emailLower
      ? await first<{
          id: string
          user_id: string
          code_hash: string
          attempts: number
        }>(
          `SELECT id, user_id, code_hash, attempts
             FROM password_reset_otps
            WHERE email_lower = ?
              AND consumed_at IS NULL
              AND verified_at IS NULL
              AND expires_at > ?
            ORDER BY created_at DESC
            LIMIT 1`,
          emailLower,
          now.toISOString(),
        )
      : null

    // Hash the candidate whether or not a row was found, so "no such pending
    // reset" costs the same as "wrong code".
    const candidate = await hmacOtp(normalizedCode)

    if (!row || blocked || normalizedCode.length !== CODE_DIGITS) {
      return failure
    }

    if (row.attempts >= MAX_ATTEMPTS) {
      await run('DELETE FROM password_reset_otps WHERE id = ?', row.id)
      return failure
    }

    const matches = timingSafeEqual(hexToBytes(candidate), hexToBytes(row.code_hash))

    if (!matches) {
      await run(
        'UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = ?',
        row.id,
      )
      return failure
    }

    // Correct. Issue the step-3 ticket: a random token in an httpOnly cookie,
    // with only its SHA-256 stored — the same shape as a session.
    const ticket = newToken()
    const ticketHash = await sha256Hex(ticket)
    const ticketExpires = new Date(now.getTime() + TICKET_TTL_MS)

    const result = await run(
      `UPDATE password_reset_otps
          SET verified_at = ?, ticket_hash = ?, ticket_expires_at = ?
        WHERE id = ? AND verified_at IS NULL AND consumed_at IS NULL`,
      now.toISOString(),
      ticketHash,
      ticketExpires.toISOString(),
      row.id,
    )

    // The guarded UPDATE is what makes the code single-use: a concurrent second
    // verification of the same code changes zero rows and gets nothing.
    if (!result.meta?.changes) return failure

    setCookie(TICKET_COOKIE, ticket, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: TICKET_COOKIE_PATH,
      maxAge: Math.floor(TICKET_TTL_MS / 1000),
    })

    return { ok: true as const }
  }, failure)
}

// ---------------------------------------------------------------------------
// Step 3 — set the new password
// ---------------------------------------------------------------------------

export async function completePasswordReset(
  password: string,
  confirmPassword: string,
): Promise<ResetOutcome> {
  const failure: ResetOutcome = { ok: false, message: GENERIC_FAILURE }

  return await withFloor(async () => {
    const now = new Date()

    // Password-policy problems are the one thing worth reporting precisely: the
    // user already proved control of the mailbox, so there is nothing left to
    // enumerate, and a vague error here is just cruel.
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return {
        ok: false as const,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      }
    }
    if (password !== confirmPassword) {
      return { ok: false as const, message: 'Passwords do not match.' }
    }

    const ticket = getCookie(TICKET_COOKIE)
    if (!ticket) return failure

    const ticketHash = await sha256Hex(ticket)

    const row = await first<{ id: string; user_id: string; ticket_expires_at: string }>(
      `SELECT id, user_id, ticket_expires_at
         FROM password_reset_otps
        WHERE ticket_hash = ?
          AND consumed_at IS NULL
          AND verified_at IS NOT NULL
          AND ticket_expires_at > ?`,
      ticketHash,
      now.toISOString(),
    )

    if (!row) {
      deleteCookie(TICKET_COOKIE, { path: TICKET_COOKIE_PATH })
      return failure
    }

    const account = await first<{ email: string; password_hash: string }>(
      'SELECT email, password_hash FROM users WHERE id = ?',
      row.user_id,
    )
    if (!account) {
      deleteCookie(TICKET_COOKIE, { path: TICKET_COOKIE_PATH })
      return failure
    }

    if (await verifyPassword(password, account.password_hash)) {
      return {
        ok: false as const,
        message: 'Please choose a password you have not used before.',
      }
    }

    // Order matters if these ever fail apart: set the password first, so a
    // partial failure leaves stale sessions against a NEW password rather than
    // live sessions against an old one.
    await setUserPassword(row.user_id, password)
    await invalidateAllSessions(row.user_id)

    await run(
      `UPDATE password_reset_otps
          SET consumed_at = ?, ticket_hash = NULL, ticket_expires_at = NULL
        WHERE id = ? AND consumed_at IS NULL`,
      now.toISOString(),
      row.id,
    )

    // Retire any other live codes for this user.
    await run(
      'DELETE FROM password_reset_otps WHERE user_id = ? AND consumed_at IS NULL',
      row.user_id,
    )

    deleteCookie(TICKET_COOKIE, { path: TICKET_COOKIE_PATH })
    // Also clear any session cookie this browser happened to be holding. The
    // rows are gone either way; this just stops the client presenting a dead one.
    deleteCookie('abpm_session', { path: '/' })

    // Non-actionable notification: this is how a user finds out if somebody
    // else reset their password.
    void sendEmail(passwordChangedEmail(account.email))

    return { ok: true as const }
  }, failure)
}
