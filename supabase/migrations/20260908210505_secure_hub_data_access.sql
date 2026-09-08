-- Coordinated security cutover. Deploy the matching server-authorized application
-- during a maintenance window; the old browser-direct application cannot use this schema.
-- No records/photos are deleted. Existing PINs still work, but cannot be retrieved.
begin;

create schema if not exists hub_security;
revoke all on schema hub_security from public, anon, authenticated;
grant usage on schema hub_security to service_role;

create table hub_security.pin_attempts (
  client_key text not null,
  window_start bigint not null,
  attempts integer not null default 0,
  primary key (client_key, window_start)
);
alter table hub_security.pin_attempts enable row level security;
revoke all on hub_security.pin_attempts from public, anon, authenticated;
grant select, insert, update, delete on hub_security.pin_attempts to service_role;

create or replace function public.hub_consume_pin_attempt(p_client_key text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  window_id bigint := floor(extract(epoch from clock_timestamp()) / 300)::bigint;
  local_attempts integer;
  total_attempts integer;
begin
  if p_client_key is null or p_client_key !~ '^[a-f0-9]{64}$' then return false; end if;
  -- Always lock global then client, so concurrent calls cannot exceed the limits.
  insert into hub_security.pin_attempts values ('global', window_id, 1)
    on conflict (client_key, window_start) do update
      set attempts = hub_security.pin_attempts.attempts + 1
    returning attempts into total_attempts;
  insert into hub_security.pin_attempts values (p_client_key, window_id, 1)
    on conflict (client_key, window_start) do update
      set attempts = hub_security.pin_attempts.attempts + 1
    returning attempts into local_attempts;
  delete from hub_security.pin_attempts where window_start < window_id - 2;
  return local_attempts <= 60 and total_attempts <= 120;
end;
$$;

-- Hash in place so no second plaintext credential copy remains. The column is
-- omitted from every browser projection and is writable only by the GM endpoint.
update public.employees
set employee_code = extensions.crypt(employee_code, extensions.gen_salt('bf', 10))
where employee_code !~ '^\$2[aby]\$';

create or replace function hub_security.hash_employee_pin()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and new.employee_code is not distinct from old.employee_code then return new; end if;
  if new.employee_code is null or new.employee_code !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly four digits' using errcode = '22023';
  end if;
  -- Serialize PIN changes per store: salted hashes cannot enforce PIN uniqueness.
  perform pg_advisory_xact_lock(hashtextextended('hub-pin:' || new.store_id, 0));
  if exists (select 1 from public.employees e where e.store_id = new.store_id
    and e.id is distinct from new.id
    and e.employee_code = extensions.crypt(new.employee_code, e.employee_code)) then
    raise exception 'PIN is already in use at this store' using errcode = '23505';
  end if;
  new.employee_code := extensions.crypt(new.employee_code, extensions.gen_salt('bf', 10));
  return new;
end;
$$;
create trigger secure_employee_pin before insert or update of employee_code on public.employees
  for each row execute function hub_security.hash_employee_pin();

create or replace function public.hub_employee_by_pin(p_pin text, p_store_id text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare employee_id uuid;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or p_store_id <> '07462' then return null; end if;
  select e.id into employee_id from public.employees e
    where e.store_id = p_store_id and e.is_active
      and coalesce(e.status, 'active') not in ('inactive', 'terminated')
      and e.employee_code = extensions.crypt(p_pin, e.employee_code);
  return employee_id;
end;
$$;

-- The Hub uses its own signed cookies, not Supabase Auth JWTs. Public Data API
-- roles must have no table access. The server checks current employee, role,
-- ownership, columns and store before using its private service credential.
do $$
declare item record;
begin
  for item in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', item.policyname, item.tablename);
  end loop;
  for item in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', item.tablename);
  end loop;
  -- Table REVOKE does not remove separately granted column privileges.
  for item in select table_name, column_name from information_schema.columns where table_schema = 'public' loop
    execute format('revoke all privileges (%I) on public.%I from public, anon, authenticated', item.column_name, item.table_name);
  end loop;
end;
$$;
revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema hub_security from public, anon, authenticated;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on function public.hub_consume_pin_attempt(text) to service_role;
grant execute on function public.hub_employee_by_pin(text, text) to service_role;
grant execute on function hub_security.hash_employee_pin() to service_role;
alter function public.set_updated_at() set search_path = '';

alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
-- Built-in PUBLIC EXECUTE is a global default; a per-schema REVOKE cannot cancel it.
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;

-- Existing public URLs stop granting access. Authenticated application endpoints
-- stream photos after checking the current employee or separately scoped kiosk.
update storage.buckets set public = false
  where id in ('checklist-photos', 'profile-photos', 'punch-photos');
-- Defense against future permissive storage policies. Restrictive false policies
-- prevent these buckets from being exposed to either public API role.
create policy hub_private_photos on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id not in ('checklist-photos', 'profile-photos', 'punch-photos'))
  with check (bucket_id not in ('checklist-photos', 'profile-photos', 'punch-photos'));

notify pgrst, 'reload schema';
commit;
