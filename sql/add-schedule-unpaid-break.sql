-- Unpaid break on Hub-built shifts. Existing Jolt rows stay at 0.
-- scheduled_hours = (end - start) - unpaid_break_minutes / 60.

ALTER TABLE schedule_shifts
ADD COLUMN IF NOT EXISTS unpaid_break_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE schedule_template_shifts
ADD COLUMN IF NOT EXISTS unpaid_break_minutes integer NOT NULL DEFAULT 0;
