-- `event_trainer_schedule` is written by src/routes/_authed/events/edit.$id.tsx
-- (delete-then-insert of trainer assignments) but was never created in the
-- Supabase database, so in production those writes failed silently. Nothing
-- reads the table, so creating it here changes no visible behaviour — it just
-- stops the edit path from erroring.
CREATE TABLE event_trainer_schedule (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  trainer_id INTEGER NOT NULL REFERENCES trainers (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (event_id, trainer_id)
);

CREATE INDEX idx_event_trainer_schedule_event_id   ON event_trainer_schedule (event_id);
CREATE INDEX idx_event_trainer_schedule_trainer_id ON event_trainer_schedule (trainer_id);
