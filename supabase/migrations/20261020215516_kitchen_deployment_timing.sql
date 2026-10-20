-- Kitchen evidence and deployment versions are read through authenticated routes.
create table public.deployment_versions (
  id uuid primary key,
  store_id text not null check (store_id = 'payson'),
  log_date date not null,
  shift text not null check (shift in ('Morning','Night')),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  submitted_by_id uuid not null references public.employees(id),
  submitted_by text not null,
  assignments jsonb not null check (jsonb_typeof(assignments) = 'array'),
  unique(store_id, log_date, effective_at)
);
create index deployment_versions_timeline on public.deployment_versions(store_id, log_date, effective_at desc);
alter table public.deployment_versions enable row level security;
revoke all on public.deployment_versions from public, anon, authenticated;
grant select, insert on public.deployment_versions to service_role;

-- Keep legacy shift summaries compatible, but atomically append the full station
-- state first. No historical version is updated/deleted when people move.
create function public.hub_save_deployment(p_id uuid, p_date date, p_shift text,
  p_effective timestamptz, p_actor uuid, p_actor_name text, p_assignments jsonb, p_base uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_previous public.deployment_versions; v_saved public.deployment_versions;
  v_log uuid; v_minutes integer; v_effective timestamptz := coalesce(p_effective, now());
begin
  perform pg_advisory_xact_lock(hashtextextended('deployment:payson:' || p_date::text, 0));
  select * into v_saved from public.deployment_versions where id=p_id;
  if found then
    if v_saved.submitted_by_id <> p_actor or v_saved.log_date <> p_date or v_saved.shift <> p_shift
      or v_saved.assignments <> p_assignments or (p_effective is not null and v_saved.effective_at <> p_effective) then
      raise exception 'Deployment request ID already used' using errcode='22023';
    end if;
    return to_jsonb(v_saved);
  end if;
  if p_date is null or p_shift not in ('Morning','Night') or p_actor is null or p_actor_name is null
    or jsonb_typeof(p_assignments) <> 'array' or p_assignments is null or jsonb_array_length(p_assignments)>100
    or (v_effective at time zone 'America/Denver')::date <> p_date or v_effective > now()
    or p_date < (now() at time zone 'America/Denver')::date - 14 then
    raise exception 'Invalid deployment' using errcode='22023';
  end if;
  select * into v_previous from public.deployment_versions where store_id='payson' and log_date=p_date order by effective_at desc limit 1;
  if v_previous.id is distinct from p_base or v_previous.effective_at >= v_effective then
    raise exception 'Deployment changed. Reload before saving.' using errcode='40001';
  end if;
  insert into public.deployment_versions(id,store_id,log_date,shift,effective_at,submitted_by_id,submitted_by,assignments)
    values(p_id,'payson',p_date,p_shift,v_effective,p_actor,p_actor_name,p_assignments) returning * into v_saved;
  v_minutes := greatest(0, ceil(extract(epoch from (now() - ((p_date + case when p_shift='Morning' then time '10:30' else time '16:30' end) at time zone 'America/Denver'))) / 60)::integer);
  insert into public.deployment_logs(log_date,shift,submitted_by,submitted_at,is_late,minutes_late,store_id)
    values(p_date,p_shift,p_actor_name,now(),v_minutes>0,v_minutes,'payson')
    on conflict(log_date,shift) do update set submitted_by=excluded.submitted_by,submitted_at=excluded.submitted_at,
      is_late=excluded.is_late,minutes_late=excluded.minutes_late
    returning id into v_log;
  delete from public.deployment_assignments where deployment_id=v_log;
  insert into public.deployment_assignments(deployment_id,log_date,shift,employee_name,stations,notes,store_id)
    select v_log,p_date,p_shift,a->>'employee_name',array(select jsonb_array_elements_text(a->'stations')),nullif(a->>'notes',''),'payson'
    from jsonb_array_elements(p_assignments) a;
  return to_jsonb(v_saved);
end $$;
revoke all on function public.hub_save_deployment(uuid,date,text,timestamptz,uuid,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.hub_save_deployment(uuid,date,text,timestamptz,uuid,text,jsonb,uuid) to service_role;

create table public.brink_kitchen_state (
  connection_id text primary key,
  enabled boolean not null default false,
  queues jsonb not null default '[]',
  queues_fetched_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_daily_date date,
  last_error text
);
create table public.brink_kitchen_days (
  connection_id text not null,
  business_date date not null,
  environment text not null check(environment in ('sandbox','production')),
  synced_at timestamptz not null default now(),
  order_bumps jsonb not null check(jsonb_typeof(order_bumps)='array'),
  item_bumps jsonb not null check(jsonb_typeof(item_bumps)='array'),
  exact_duplicates integer not null default 0,
  primary key(connection_id,business_date)
);
alter table public.brink_kitchen_state enable row level security;
alter table public.brink_kitchen_days enable row level security;
revoke all on public.brink_kitchen_state,public.brink_kitchen_days from public,anon,authenticated;
grant select,insert,update on public.brink_kitchen_state,public.brink_kitchen_days to service_role;

-- Share the sales cooldown without clearing a sales failure during a manual
-- kitchen-only run. A kitchen refresh must not imply a successful sales sync.
create function public.brink_claim_kitchen(p_connection text,p_attempt uuid)
returns boolean language plpgsql set search_path='' as $$
begin
  insert into public.brink_sync_state(connection_id,attempt_id,attempted_at)
    values(p_connection,p_attempt,now())
    on conflict(connection_id) do update set attempt_id=excluded.attempt_id,attempted_at=now()
    where public.brink_sync_state.attempted_at <= now() - interval '2 minutes';
  return found;
end $$;
revoke all on function public.brink_claim_kitchen(text,uuid) from public,anon,authenticated;
grant execute on function public.brink_claim_kitchen(text,uuid) to service_role;

create function public.brink_finish_kitchen(p_connection text,p_attempt uuid,p_date date,p_environment text,
  p_orders jsonb,p_items jsonb,p_duplicates integer)
returns boolean language plpgsql set search_path='' as $$
begin
  perform 1 from public.brink_sync_state where connection_id=p_connection and attempt_id=p_attempt for update;
  if not found then return false; end if;
  insert into public.brink_kitchen_days(connection_id,business_date,environment,order_bumps,item_bumps,exact_duplicates)
    values(p_connection,p_date,p_environment,p_orders,p_items,p_duplicates)
    on conflict(connection_id,business_date) do update set environment=excluded.environment,order_bumps=excluded.order_bumps,
      item_bumps=excluded.item_bumps,exact_duplicates=excluded.exact_duplicates,synced_at=now();
  update public.brink_kitchen_state set last_success_at=now(),last_error=null where connection_id=p_connection;
  return true;
end $$;
revoke all on function public.brink_finish_kitchen(text,uuid,date,text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.brink_finish_kitchen(text,uuid,date,text,jsonb,jsonb,integer) to service_role;
