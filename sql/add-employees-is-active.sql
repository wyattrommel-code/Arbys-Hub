-- Active flag for employees (fast default filtering across the hub).
-- Canonical lifecycle still uses `status` (active | inactive | terminated);
-- `is_active` mirrors whether status = 'active'.

ALTER TABLE employees
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE employees
SET is_active = (COALESCE(lower(trim(status)), 'active') = 'active');

CREATE INDEX IF NOT EXISTS employees_store_id_is_active_idx
ON employees (store_id, is_active)
WHERE is_active = true;
