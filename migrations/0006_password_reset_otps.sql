-- Email OTP codes for the logged-out "forgot password" flow.
--
-- One row per issued code. The code itself is never stored: only an HMAC-SHA256
-- of it, keyed by the OTP_PEPPER Worker secret, so a leaked D1 snapshot cannot
-- be turned back into working codes. A plain SHA-256 would not be enough here —
-- a 6-digit code has only ~20 bits of entropy, so all one million digests can be
-- precomputed in seconds. (That is also why `sessions.id` can safely be a bare
-- SHA-256: its input is 256 bits of randomness, not six digits.)
--
-- A row is single-use and moves through:
--   issued -> verified_at set -> consumed_at set
--   (or) expires_at passes / attempts hits the cap -> dead

CREATE TABLE password_reset_otps (
  id                TEXT PRIMARY KEY,          -- uuid
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email_lower       TEXT NOT NULL,             -- lower(email) at issue time
  code_hash         TEXT NOT NULL,             -- HMAC-SHA256(OTP_PEPPER, code), hex
  attempts          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,             -- ISO-8601
  expires_at        TEXT NOT NULL,             -- created_at + 10 min
  verified_at       TEXT,                      -- set when the correct code is entered
  consumed_at       TEXT,                      -- set when the password is actually changed
  ticket_hash       TEXT,                      -- SHA-256 of the step-3 cookie token, hex
  ticket_expires_at TEXT,                      -- verified_at + 10 min
  request_ip        TEXT                       -- CF-Connecting-IP at issue time
);

CREATE INDEX idx_pw_reset_user    ON password_reset_otps (user_id);
CREATE INDEX idx_pw_reset_email   ON password_reset_otps (email_lower, created_at);
CREATE INDEX idx_pw_reset_ticket  ON password_reset_otps (ticket_hash);
CREATE INDEX idx_pw_reset_expires ON password_reset_otps (expires_at);

-- Durable per-identifier counters for rate limiting.
--
-- The Workers rate-limit binding is per-datacentre and eventually consistent, so
-- it is only a burst guard; this table is the authoritative hourly cap. Keys are
-- hashed so the table never holds a plaintext email address or IP.
--
-- Rows exist for addresses that are NOT registered too. If unknown addresses
-- skipped the counter, the difference between "throttled" and "not throttled"
-- would itself be an enumeration oracle.
CREATE TABLE password_reset_throttle (
  key          TEXT PRIMARY KEY,      -- 'email:<sha256(lower(email))>' | 'ip:<sha256(ip)>'
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL          -- ISO-8601; reset once now - window_start > 1h
);
