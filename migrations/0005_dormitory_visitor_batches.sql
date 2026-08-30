-- Group tag for visitors checked in together via "Mass Assign Visitors".
--
-- A coordinator hosting a party of external guests from one organization picks
-- a floor or a building and a headcount; the system creates one visitor record
-- per person (name defaults to the organization) and spreads them across the
-- free beds. Every record from that one action shares a `batch_id` so the whole
-- group can be checked out in a single step. Individually added visitors leave
-- this NULL.
ALTER TABLE dormitory_visitors ADD COLUMN batch_id TEXT;

CREATE INDEX idx_dormitory_visitors_batch_id ON dormitory_visitors (batch_id);
