-- ABPM Trainer System — D1 (SQLite) schema
-- Ported from self-hosted Supabase Postgres (public + auth schemas).
--
-- Type mapping notes:
--   uuid                      -> TEXT
--   timestamp / timestamptz   -> TEXT (ISO-8601)
--   date                      -> TEXT ('YYYY-MM-DD')
--   boolean                   -> INTEGER (0/1)
--   integer[] / text[]        -> TEXT holding a JSON array

-- ---------------------------------------------------------------------------
-- Auth (replaces Supabase auth.users + GoTrue sessions)
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  email_confirmed_at TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_sign_in_at    TEXT,
  raw_user_meta_data TEXT NOT NULL DEFAULT '{}'
);

-- GoTrue treats e-mail case-insensitively; mirror that.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,          -- SHA-256 of the cookie token, hex
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX sessions_user_id_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- RBAC
-- ---------------------------------------------------------------------------

CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  level       INTEGER NOT NULL,
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE permissions (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  resource    TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT,
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE role_permissions (
  id            TEXT PRIMARY KEY,
  role_id       TEXT REFERENCES roles (id) ON DELETE CASCADE,
  permission_id TEXT REFERENCES permissions (id) ON DELETE CASCADE,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role_id ON role_permissions (role_id);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

CREATE TABLE regions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE,
  code             TEXT NOT NULL UNIQUE,
  training_centers INTEGER DEFAULT 0,
  active_trainers  INTEGER DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Domain tables
-- ---------------------------------------------------------------------------

CREATE TABLE trainers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  rank           TEXT NOT NULL,
  status         TEXT DEFAULT 'active',
  specialization TEXT,
  created_at     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  role_id        TEXT REFERENCES roles (id),
  is_active      INTEGER DEFAULT 1,
  last_login     TEXT,
  user_id        TEXT UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  region         TEXT,
  updated_at     TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  department     TEXT
);

CREATE INDEX idx_trainers_role_id    ON trainers (role_id);
CREATE INDEX idx_trainers_user_id    ON trainers (user_id);
CREATE INDEX idx_trainers_department ON trainers (department);
CREATE INDEX idx_trainers_status     ON trainers (status);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  description TEXT,
  color       TEXT,
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_events_start_date ON events (start_date);
CREATE INDEX idx_events_end_date   ON events (end_date);

CREATE TABLE schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  trainer_id   INTEGER REFERENCES trainers (id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  availability TEXT DEFAULT '[]',       -- JSON array of text
  status       TEXT DEFAULT 'available',
  notes        TEXT,
  created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_schedules_date       ON schedules (date);
CREATE INDEX idx_schedules_trainer_id ON schedules (trainer_id);

CREATE TABLE physical_training (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL,
  training_type TEXT NOT NULL,
  in_charge     TEXT NOT NULL,
  participants  TEXT NOT NULL DEFAULT '[]',   -- JSON array of trainer ids
  time_slot     TEXT NOT NULL,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_physical_training_date ON physical_training (date);

CREATE TABLE religious_activities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  activity     TEXT NOT NULL,
  in_charge    TEXT NOT NULL,
  participants TEXT NOT NULL DEFAULT '[]',    -- JSON array of trainer ids
  created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_religious_activities_date ON religious_activities (date);

CREATE TABLE dormitory_assignments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    TEXT NOT NULL,
  trainer_id INTEGER REFERENCES trainers (id),
  check_in   TEXT,
  check_out  TEXT,
  status     TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_dormitory_assignments_room_id    ON dormitory_assignments (room_id);
CREATE INDEX idx_dormitory_assignments_trainer_id ON dormitory_assignments (trainer_id);

CREATE TABLE training_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  type       TEXT NOT NULL,
  trainer_id INTEGER REFERENCES trainers (id),
  status     TEXT DEFAULT 'scheduled',
  time_slot  TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_training_sessions_date ON training_sessions (date);
