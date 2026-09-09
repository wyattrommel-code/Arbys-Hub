create table public.timecard_approvals (
  id uuid primary key default gen_random_uuid(),
  punch_id uuid not null references public.time_punches(id),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  approved_by uuid not null references public.employees(id),
  approved_by_name text not null,
  approved_at timestamptz not null default now(),
  note text not null check (length(trim(note)) between 1 and 1000),
  review_flags jsonb not null,
  reviewed_snapshot jsonb not null,
  unique (punch_id, snapshot_hash)
);
alter table public.timecard_approvals enable row level security;
revoke all on public.timecard_approvals from public, anon, authenticated, service_role;
grant select, insert on public.timecard_approvals to service_role;
create index timecard_approvals_manager_idx on public.timecard_approvals(approved_by);
