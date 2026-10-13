-- Jobs carry the id of the worker instance that claimed them, so a restart
-- can distinguish a live lease from one orphaned by a killed process.
ALTER TABLE jobs ADD COLUMN worker_id TEXT;
