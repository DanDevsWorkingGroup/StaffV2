-- Temporary dormitory visitors.
--
-- The dormitory occasionally hosts external guests (auditors, guest instructors,
-- family of trainees) who are not trainers and must not appear in the trainer
-- roster. They get their own lightweight record here and are placed into rooms
-- through the existing `dormitory_assignments` table via a new `visitor_id`
-- column, so every occupancy query keeps working unchanged.
CREATE TABLE dormitory_visitors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  organization TEXT,
  phone        TEXT,
  id_number    TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A dormitory_assignments row now points at EITHER a trainer OR a visitor.
ALTER TABLE dormitory_assignments
  ADD COLUMN visitor_id INTEGER REFERENCES dormitory_visitors (id);

CREATE INDEX idx_dormitory_assignments_visitor_id ON dormitory_assignments (visitor_id);
