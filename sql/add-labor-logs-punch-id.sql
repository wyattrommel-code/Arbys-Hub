ALTER TABLE labor_logs
ADD COLUMN IF NOT EXISTS punch_id text;

CREATE UNIQUE INDEX IF NOT EXISTS labor_logs_punch_id_unique_idx
ON labor_logs (punch_id);
