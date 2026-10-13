-- Runs gained a creation timestamp after the initial schema shipped.
ALTER TABLE runs ADD COLUMN created_at TEXT;
