create table public.brink_api_calls (
 id uuid primary key,
 connection_id text not null,
 environment text not null check(environment in ('sandbox','production')),
 business_date date not null,
 operation text not null default 'GetOrders',
 endpoint text not null,
 source text not null check(source in ('manual','automatic','daily')),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 duration_ms integer,
 status text not null default 'started' check(status in ('started','success','error')),
 http_status integer,
 result_code text,
 request_xml text not null,
 response_xml text,
 response_sha256 text,
 response_bytes integer,
 response_truncated boolean not null default false,
 order_count integer,
 net_sales numeric,
 error text
);
create index brink_api_calls_connection_started on public.brink_api_calls(connection_id,started_at desc);
create index brink_api_calls_retention on public.brink_api_calls(started_at);
alter table public.brink_api_calls enable row level security;
revoke all on public.brink_api_calls from public,anon,authenticated;
grant select,insert,update,delete on public.brink_api_calls to service_role;
-- Durable request timestamps also prevent a manual click racing the scheduler.
alter table public.brink_sync_state add column automatic_enabled boolean not null default false;
alter table public.brink_sync_state add column last_daily_date date;
