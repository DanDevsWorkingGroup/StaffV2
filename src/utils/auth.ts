import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import bcrypt from 'bcryptjs'
import { first, run } from './db'

const SESSION_COOKIE = 'abpm_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const PBKDF2_ITERATIONS = 100_000

export type SessionUser = {
  id: string
  email: string
}

// ---------------------------------------------------------------------------
// Password hashing
//
// The 154 accounts migrated out of Supabase GoTrue carry bcrypt ($2a$10$)
// hashes, and we cannot re-derive them without the plaintext. So bcrypt stays
// supported for verification, and any account that logs in successfully with a
// bcrypt hash is transparently re-hashed to PBKDF2-SHA256, which the Workers
// runtime computes natively and therefore far more cheaply.
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith('pbkdf2$')) {
    const [, algo, iterations, salt, expected] = stored.split('$')
    if (algo !== 'sha256') return false
    const derived = await pbkdf2(password, fromBase64(salt), Number(iterations))
    return timingSafeEqual(derived, fromBase64(expected))
  }

  // Legacy GoTrue bcrypt hashes: $2a$, $2b$, $2y$
  if (stored.startsWith('$2')) {
    return await bcrypt.compare(password, stored)
  }

  return false
}

/** True when the stored hash should be upgraded after a successful login. */
function needsRehash(stored: string): boolean {
  return stored.startsWith('$2')
}

// ---------------------------------------------------------------------------
// Sessions
//
// The cookie carries a random opaque token; only its SHA-256 is persisted, so a
// leaked database row cannot be replayed as a session.
// ---------------------------------------------------------------------------

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function startSession(userId: string): Promise<void> {
  const token = newToken()
  const id = await sha256Hex(token)
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_TTL_MS)

  await run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    id,
    userId,
    now.toISOString(),
    expires.toISOString(),
  )

  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = getCookie(SESSION_COOKIE)
  if (!token) return null

  const id = await sha256Hex(token)
  const row = await first<{ id: string; email: string; expires_at: string }>(
    `SELECT u.id AS id, u.email AS email, s.expires_at AS expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    id,
  )

  if (!row) return null

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await run('DELETE FROM sessions WHERE id = ?', id)
    deleteCookie(SESSION_COOKIE, { path: '/' })
    return null
  }

  return { id: row.id, email: row.email }
}

export type AuthResult = { error: true; message: string } | { error: false }

export async function signIn(
  email: string,
  password: string,
): Promise<AuthResult> {
  const normalized = (email ?? '').trim()
  if (!normalized || !password) {
    return { error: true, message: 'Invalid login credentials' }
  }

  const user = await first<{ id: string; password_hash: string }>(
    'SELECT id, password_hash FROM users WHERE lower(email) = lower(?)',
    normalized,
  )

  // Same message either way so the form cannot be used to enumerate accounts.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { error: true, message: 'Invalid login credentials' }
  }

  if (needsRehash(user.password_hash)) {
    const upgraded = await hashPassword(password)
    await run(
      'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
      upgraded,
      new Date().toISOString(),
      user.id,
    )
  }

  await run(
    'UPDATE users SET last_sign_in_at = ? WHERE id = ?',
    new Date().toISOString(),
    user.id,
  )

  await startSession(user.id)
  return { error: false }
}

export async function signUp(
  email: string,
  password: string,
): Promise<AuthResult> {
  const normalized = (email ?? '').trim()
  if (!normalized) return { error: true, message: 'Email is required' }
  if (!password || password.length < 6) {
    return { error: true, message: 'Password should be at least 6 characters' }
  }

  const existing = await first<{ id: string }>(
    'SELECT id FROM users WHERE lower(email) = lower(?)',
    normalized,
  )
  if (existing) {
    return { error: true, message: 'A user with this email address already exists' }
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await run(
    `INSERT INTO users (id, email, password_hash, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    normalized,
    await hashPassword(password),
    now,
    now,
    now,
    JSON.stringify({ email_verified: true }),
  )

  await startSession(id)
  return { error: false }
}

export async function signOut(): Promise<void> {
  const token = getCookie(SESSION_COOKIE)
  if (token) {
    await run('DELETE FROM sessions WHERE id = ?', await sha256Hex(token))
  }
  deleteCookie(SESSION_COOKIE, { path: '/' })
}

// ---------------------------------------------------------------------------
// Admin helpers
//
// These stand in for Supabase's `auth.admin.*`. With D1 the Worker binding is
// already privileged, so there is no separate service-role connection.
// ---------------------------------------------------------------------------

export async function adminGetUserById(userId: string): Promise<SessionUser | null> {
  return await first<SessionUser>(
    'SELECT id, email FROM users WHERE id = ?',
    userId,
  )
}

export async function adminCreateUser(
  email: string,
  password: string,
): Promise<{ user: SessionUser } | { error: string }> {
  const normalized = (email ?? '').trim()
  if (!normalized) return { error: 'Email is required' }
  if (!password) return { error: 'Password is required' }

  const existing = await first<{ id: string }>(
    'SELECT id FROM users WHERE lower(email) = lower(?)',
    normalized,
  )
  if (existing) {
    return { error: 'A user with this email address has already been registered' }
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await run(
    `INSERT INTO users (id, email, password_hash, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    normalized,
    await hashPassword(password),
    now,
    now,
    now,
    JSON.stringify({ email_verified: true }),
  )

  // Unlike signUp() this must not start a session — an admin is creating an
  // account for somebody else.
  return { user: { id, email: normalized } }
}
