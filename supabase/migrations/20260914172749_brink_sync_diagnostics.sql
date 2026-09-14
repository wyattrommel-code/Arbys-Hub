-- Server-only diagnostic metadata; existing access controls remain in effect.
alter table public.brink_api_calls
  add column diagnostics jsonb not null default '[]'::jsonb,
  add column integration_version text;
