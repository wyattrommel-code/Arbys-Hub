-- Server-only PAR snapshots. No tokens, payment details, or customer data.
create table public.brink_sync_state (
  connection_id text primary key,
  attempt_id uuid not null,
  attempted_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_error text
);
create table public.brink_sales_days (
  connection_id text not null,
  business_date date not null,
  environment text not null check (environment in ('sandbox','production')),
  synced_at timestamptz not null default now(),
  orders jsonb not null check (jsonb_typeof(orders) = 'array'),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  primary key (connection_id, business_date)
);
alter table public.brink_sync_state enable row level security;
alter table public.brink_sales_days enable row level security;
revoke all on public.brink_sync_state, public.brink_sales_days from public, anon, authenticated;
grant select, insert, update on public.brink_sync_state, public.brink_sales_days to service_role;

create function public.brink_claim_sync(p_connection text, p_attempt uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.brink_sync_state(connection_id,attempt_id,attempted_at,last_error)
  values(p_connection,p_attempt,now(),null)
  on conflict(connection_id) do update set attempt_id=excluded.attempt_id, attempted_at=now(), last_error=null
  where public.brink_sync_state.attempted_at <= now() - interval '2 minutes';
  return found;
end;
$$;

create function public.brink_finish_sync(p_connection text,p_attempt uuid,p_date date,p_environment text,p_orders jsonb,p_summary jsonb,p_publish boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.brink_sync_state where connection_id=p_connection and attempt_id=p_attempt for update;
  if not found then return false; end if;
  if p_publish and p_environment <> 'production' then raise exception 'Sandbox cannot publish store sales'; end if;
  insert into public.brink_sales_days(connection_id,business_date,environment,orders,summary)
    values(p_connection,p_date,p_environment,p_orders,p_summary)
    on conflict(connection_id,business_date) do update set environment=excluded.environment,orders=excluded.orders,summary=excluded.summary,synced_at=now();
  if p_publish then
    -- Replace all 24 buckets atomically; zero buckets clear stale prior values.
    if jsonb_array_length(p_summary->'hourly') <> 24 then raise exception 'Expected 24 hourly buckets'; end if;
    insert into public.hourly_sales(sale_date,hour_of_day,net_sales,updated_at)
      select p_date,(h->>'hour_of_day')::integer,(h->>'net_sales')::numeric,now()
      from jsonb_array_elements(p_summary->'hourly') h
      on conflict(sale_date,hour_of_day) do update set net_sales=excluded.net_sales,updated_at=now();
  end if;
  update public.brink_sync_state set last_success_at=now(),last_error=null where connection_id=p_connection;
  return true;
end;
$$;
revoke all on function public.brink_claim_sync(text,uuid),public.brink_finish_sync(text,uuid,date,text,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.brink_claim_sync(text,uuid),public.brink_finish_sync(text,uuid,date,text,jsonb,jsonb,boolean) to service_role;
