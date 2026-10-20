-- One active browser credential per store; credentials are hashed before storage.
create table public.clock_kiosk_stations (
  store_id text primary key check (store_id = '07462'),
  device_hash text check (device_hash ~ '^[a-f0-9]{64}$'),
  device_expires_at timestamptz, paired_at timestamptz, revoked_at timestamptz,
  pairing_hash text check (pairing_hash ~ '^[a-f0-9]{64}$'),
  pairing_expires_at timestamptz, pairing_by uuid references public.employees(id),
  changed_by uuid not null references public.employees(id),
  check ((device_hash is null) = (device_expires_at is null)),
  check ((pairing_hash is null) = (pairing_expires_at is null))
);
create table public.clock_kiosk_events (
  id bigint generated always as identity primary key,
  store_id text not null, actor_id uuid not null references public.employees(id),
  action text not null check (action in ('code_issued','paired','revoked')),
  created_at timestamptz not null default now()
);
create index clock_kiosk_events_actor_idx on public.clock_kiosk_events(actor_id);
alter table public.clock_kiosk_stations enable row level security;
alter table public.clock_kiosk_events enable row level security;
revoke all on public.clock_kiosk_stations, public.clock_kiosk_events from public, anon, authenticated, service_role;
revoke all on sequence public.clock_kiosk_events_id_seq from public, anon, authenticated, service_role;
grant select, insert, update on public.clock_kiosk_stations to service_role;
grant select, insert on public.clock_kiosk_events to service_role;
grant usage, select on sequence public.clock_kiosk_events_id_seq to service_role;

create function public.hub_audit_clock_station() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.clock_kiosk_events(store_id, actor_id, action)
  values (new.store_id, new.changed_by,
    case when new.pairing_hash is not null and (tg_op = 'INSERT' or new.pairing_hash is distinct from old.pairing_hash) then 'code_issued'
      when new.device_hash is not null and (tg_op = 'INSERT' or new.device_hash is distinct from old.device_hash) then 'paired'
      else 'revoked' end);
  return new;
end; $$;
revoke all on function public.hub_audit_clock_station() from public, anon, authenticated;
grant execute on function public.hub_audit_clock_station() to service_role;
create trigger audit_clock_station after insert or update on public.clock_kiosk_stations
for each row execute function public.hub_audit_clock_station();

-- Conditional update consumes a code exactly once, including concurrent requests.
create function public.hub_pair_clock_station(p_store text, p_pairing_hash text, p_device_hash text, p_issuer uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  if p_device_hash is null or p_device_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  update public.clock_kiosk_stations set device_hash = p_device_hash,
    device_expires_at = now() + interval '180 days', paired_at = now(), revoked_at = null,
    pairing_hash = null, pairing_expires_at = null, pairing_by = null, changed_by = p_issuer
  where store_id = p_store and pairing_hash = p_pairing_hash
    and pairing_expires_at > now() and pairing_by = p_issuer;
  get diagnostics affected = row_count;
  return affected = 1;
end; $$;
revoke all on function public.hub_pair_clock_station(text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.hub_pair_clock_station(text,text,text,uuid) to service_role;
