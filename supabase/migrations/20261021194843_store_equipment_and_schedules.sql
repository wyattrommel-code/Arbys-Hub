begin;

create function public.hub_access_role(value text) returns text
language sql immutable security invoker set search_path='' as $$
  select case lower(replace(replace(coalesce(value,'crew'),'-','_'),' ','_'))
    when 'gm' then 'gm' when 'assistant_manager' then 'assistant_manager' when 'am' then 'assistant_manager'
    when 'shift_lead' then 'shift_lead' when 'manager' then 'shift_lead' else 'crew' end;
$$;

create table public.hub_organizations (id uuid primary key default gen_random_uuid(), name text not null);
create table public.hub_stores (
  id text primary key,
  organization_id uuid not null references public.hub_organizations(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  number text not null default '' check (length(number)<=30),
  timezone text not null default 'America/Denver',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index hub_stores_org_name on public.hub_stores(organization_id,lower(name));
create table public.hub_store_memberships (
  store_id text not null references public.hub_stores(id), employee_id text not null,
  role text not null check (role in ('crew','shift_lead','assistant_manager','gm')),
  follows_home_role boolean not null default false,
  is_active boolean not null default true, primary key(store_id,employee_id)
);
create index hub_store_memberships_employee on public.hub_store_memberships(employee_id,store_id);
create table public.hub_organization_admins (
  organization_id uuid not null references public.hub_organizations(id), employee_id text not null,
  primary key(organization_id,employee_id)
);
create index hub_organization_admins_employee on public.hub_organization_admins(employee_id,organization_id);

-- Bootstrap the existing operator's stores and current home-store access.
-- New stores start empty; no employees, equipment, tasks, or history are copied.
do $$ declare org uuid; sid text;
begin
  insert into public.hub_organizations(name) values ('Arby''s operations') returning id into org;
  for sid in select '07462' union select distinct store_id::text from public.employees where store_id is not null union select store_id from public.hub_resource_libraries
  loop
    insert into public.hub_stores(id,organization_id,name,number) values(sid,org,case when sid='07462' then 'Payson' else 'Store '||sid end,sid);
  end loop;
  insert into public.hub_store_memberships(store_id,employee_id,role,is_active,follows_home_role)
    select e.store_id::text,e.id::text,public.hub_access_role(to_jsonb(e)->>'role'),
      coalesce((to_jsonb(e)->>'is_active')::boolean,true) and coalesce(to_jsonb(e)->>'status','active') not in ('inactive','terminated'),true
    from public.employees e where e.store_id is not null;
  -- Existing Payson GMs administer the initial organization. Store-specific
  -- assistant managers and GMs at subsequently added stores do not inherit it.
  insert into public.hub_organization_admins(organization_id,employee_id)
    select org,employee_id from public.hub_store_memberships where store_id='07462' and role='gm' and is_active;
end $$;

create function public.get_hub_store_access(p_employee_id text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare person jsonb; result jsonb;
begin
  select to_jsonb(e) into person from public.employees e where e.id::text=p_employee_id;
  if person is null or not coalesce((person->>'is_active')::boolean,true) or coalesce(person->>'status','active') in ('inactive','terminated') then return null; end if;
  -- Newly imported employees inherit only their trusted employee home store.
  -- An inactive membership stays inactive; this never restores revoked access.
  insert into public.hub_store_memberships(store_id,employee_id,role,follows_home_role)
    select s.id,p_employee_id,public.hub_access_role(person->>'role'),true from public.hub_stores s where s.id=person->>'store_id' and s.is_active
    on conflict(store_id,employee_id) do update set role=excluded.role where hub_store_memberships.follows_home_role;
  select jsonb_build_object('employee',jsonb_build_object('employee_id',p_employee_id,'first_name',person->>'first_name','last_name',person->>'last_name','home_store_id',person->>'store_id'),
    'stores',coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'number',s.number,'timezone',s.timezone,'role',m.role,'follows_home_role',m.follows_home_role,
      'can_create_store',exists(select 1 from public.hub_organization_admins a where a.organization_id=s.organization_id and a.employee_id=p_employee_id)) order by s.name),'[]'::jsonb))
  into result from public.hub_store_memberships m join public.hub_stores s on s.id=m.store_id where m.employee_id=p_employee_id and m.is_active and s.is_active
    and (not m.follows_home_role or m.store_id=person->>'store_id');
  return result;
end $$;

create function public.get_hub_store_login(p_store text,p_pin text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare matches jsonb;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then return null; end if;
  select jsonb_agg(to_jsonb(e)) into matches from public.employees e
    join public.hub_stores s on s.id=p_store and s.is_active
    left join public.hub_store_memberships m on m.store_id=p_store and m.employee_id=e.id::text
    where e.employee_code=extensions.crypt(p_pin,e.employee_code) and coalesce((to_jsonb(e)->>'is_active')::boolean,true)
      and coalesce(to_jsonb(e)->>'status','active') not in ('inactive','terminated')
      and ((m.is_active=true and (not m.follows_home_role or m.store_id=e.store_id::text)) or (e.store_id::text=p_store and m.employee_id is null));
  -- A PIN collision across assigned stores must never select an arbitrary user.
  if jsonb_array_length(coalesce(matches,'[]'::jsonb))<>1 then return null; end if;
  return jsonb_build_object('id',matches->0->>'id','first_name',matches->0->>'first_name','last_name',matches->0->>'last_name','role',matches->0->>'role','store_id',p_store);
end $$;
revoke execute on function public.get_hub_store_login(text,text) from public,anon,authenticated;
grant execute on function public.get_hub_store_login(text,text) to service_role;

create function public.create_hub_store(p_actor text,p_source_store text,p_name text,p_number text,p_timezone text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare org uuid; sid text := gen_random_uuid()::text;
begin
  select s.organization_id into org from public.hub_stores s join public.hub_organization_admins a on a.organization_id=s.organization_id
    join public.hub_store_memberships m on m.store_id=s.id and m.employee_id=a.employee_id and m.is_active
    join public.employees e on e.id::text=a.employee_id and coalesce((to_jsonb(e)->>'is_active')::boolean,true) and coalesce(to_jsonb(e)->>'status','active') not in ('inactive','terminated')
    where s.id=p_source_store and s.is_active and a.employee_id=p_actor;
  if org is null then raise exception 'Store creation is not authorized' using errcode='42501'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid time zone' using errcode='22023'; end if;
  insert into public.hub_stores(id,organization_id,name,number,timezone) values(sid,org,btrim(p_name),btrim(p_number),p_timezone);
  insert into public.hub_store_memberships(store_id,employee_id,role) values(sid,p_actor,'gm');
  perform public.get_hub_resource_library(sid);
  return jsonb_build_object('id',sid,'name',btrim(p_name),'number',btrim(p_number),'timezone',p_timezone,'role','gm','can_create_store',true);
end $$;

create table public.hub_equipment (
  id uuid primary key default gen_random_uuid(), store_id text not null references public.hub_stores(id),
  name text not null check(length(btrim(name)) between 1 and 120), manufacturer text not null default '', model text not null default '',
  serial_number text not null default '', location text not null default '', notes text not null default '', service_contact text not null default '',
  status text not null default 'active' check(status in ('active','out_of_service','retired')),
  version integer not null default 1 check(version>0), created_by text not null, updated_by text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(store_id,id)
);
create index hub_equipment_store on public.hub_equipment(store_id,name,id);
create table public.hub_equipment_manuals (
  id uuid primary key default gen_random_uuid(), store_id text not null, equipment_id uuid not null,
  title text not null check(length(btrim(title)) between 1 and 160), file_name text not null,
  file_size bigint not null check(file_size between 5 and 52428800), object_path text not null unique,
  status text not null default 'uploading' check(status in ('uploading','ready','archived')),
  uploaded_by text not null, created_at timestamptz not null default now(),
  foreign key(store_id,equipment_id) references public.hub_equipment(store_id,id),
  check(object_path=store_id||'/'||equipment_id::text||'/'||id::text||'.pdf')
);
create index hub_equipment_manuals_equipment on public.hub_equipment_manuals(store_id,equipment_id,created_at);
create table public.hub_equipment_schedules (
  id uuid primary key default gen_random_uuid(), store_id text not null, equipment_id uuid not null,
  kind text not null check(kind in ('cleaning','maintenance')), title text not null check(length(btrim(title)) between 1 and 160),
  instructions text not null default '' check(length(instructions)<=30000),
  frequency_unit text not null check(frequency_unit in ('days','weeks','months')),
  frequency_interval integer not null check(frequency_interval between 1 and 365), start_date date not null,
  shift text not null check(shift in ('AM','PM')), responsible_role text not null default 'crew' check(responsible_role in ('crew','shift_lead','assistant_manager','gm')),
  is_active boolean not null default true, version integer not null default 1, effective_from date not null, materialized_through date,
  updated_by text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(store_id,id), foreign key(store_id,equipment_id) references public.hub_equipment(store_id,id)
);
create index hub_equipment_schedules_equipment on public.hub_equipment_schedules(store_id,equipment_id,id);
create table public.hub_equipment_tasks (
  id uuid primary key default gen_random_uuid(), store_id text not null, equipment_id uuid not null, schedule_id uuid not null,
  schedule_version integer not null, due_date date not null, shift text not null,
  equipment_name text not null, title text not null, instructions text not null, kind text not null, responsible_role text not null,
  status text not null default 'pending' check(status in ('pending','completed','cancelled')),
  completed_at timestamptz, completed_date date, completed_by text, completed_by_name text, notes text not null default '',
  created_at timestamptz not null default now(), cancelled_at timestamptz,
  foreign key(store_id,equipment_id) references public.hub_equipment(store_id,id),
  foreign key(store_id,schedule_id) references public.hub_equipment_schedules(store_id,id),
  unique(store_id,schedule_id,schedule_version,due_date,shift),
  check((status='completed' and completed_at is not null and completed_by is not null) or (status<>'completed' and completed_at is null))
);
create index hub_equipment_tasks_due on public.hub_equipment_tasks(store_id,status,due_date,id);
create index hub_equipment_tasks_history on public.hub_equipment_tasks(store_id,equipment_id,due_date desc,created_at desc,id);
create index hub_equipment_tasks_schedule on public.hub_equipment_tasks(store_id,schedule_id,due_date,shift,status);

create function public.assert_hub_equipment_actor(p_store text,p_actor text,p_manage boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare access text;
begin
  select case when m.follows_home_role then public.hub_access_role(to_jsonb(e)->>'role') else m.role end into access from public.hub_store_memberships m join public.hub_stores s on s.id=m.store_id and s.is_active
    join public.employees e on e.id::text=m.employee_id
    where m.store_id=p_store and m.employee_id=p_actor and m.is_active and (not m.follows_home_role or m.store_id=e.store_id::text)
      and coalesce((to_jsonb(e)->>'is_active')::boolean,true) and coalesce(to_jsonb(e)->>'status','active') not in ('inactive','terminated');
  if access is null or (p_manage and access not in ('assistant_manager','gm')) then raise exception 'Equipment access denied' using errcode='42501'; end if;
end $$;

-- Snapshot occurrences on demand in the store's local calendar. No cron job is
-- required: the first checklist read catches up all dates since the last read.
create function public.ensure_hub_equipment_tasks(p_store text,p_today date) returns void
language plpgsql security invoker set search_path='' as $$
declare s record; from_date date; actual_today date;
begin
  select (now() at time zone timezone)::date into actual_today from public.hub_stores where id=p_store and is_active;
  if actual_today is null or p_today>actual_today then raise exception 'Invalid checklist date' using errcode='22023'; end if;
  for s in select schedules.*,equipment.name as equipment_name,equipment.status as equipment_status
    from public.hub_equipment_schedules schedules join public.hub_equipment equipment on equipment.id=schedules.equipment_id and equipment.store_id=schedules.store_id
    where schedules.store_id=p_store order by schedules.id for update of schedules
  loop
    from_date := greatest(s.start_date,s.effective_from,coalesce(s.materialized_through+1,s.start_date));
    if s.is_active and s.equipment_status='active' and from_date<=p_today then
      insert into public.hub_equipment_tasks(store_id,equipment_id,schedule_id,schedule_version,due_date,shift,equipment_name,title,instructions,kind,responsible_role)
      select p_store,s.equipment_id,s.id,s.version,d::date,s.shift,s.equipment_name,s.title,s.instructions,s.kind,s.responsible_role
      from generate_series(from_date::timestamp,p_today::timestamp,interval '1 day') d
      where (
        (s.frequency_unit='days' and (d::date-s.start_date)%s.frequency_interval=0)
        or (s.frequency_unit='weeks' and (d::date-s.start_date)%(7*s.frequency_interval)=0)
        or (s.frequency_unit='months'
          and ((extract(year from d)::integer-extract(year from s.start_date)::integer)*12+extract(month from d)::integer-extract(month from s.start_date)::integer)%s.frequency_interval=0
          and extract(day from d)=least(extract(day from s.start_date),extract(day from date_trunc('month',d)+interval '1 month - 1 day')))
      ) and not exists(select 1 from public.hub_equipment_tasks t where t.store_id=p_store and t.schedule_id=s.id and t.due_date=d::date and t.shift=s.shift and t.status='completed')
      on conflict do nothing;
    end if;
    update public.hub_equipment_schedules set materialized_through=greatest(coalesce(materialized_through,p_today),p_today) where id=s.id and store_id=p_store;
  end loop;
end $$;

create function public.save_hub_equipment(p_store text,p_actor text,p_id uuid,p_version integer,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.hub_equipment; old_status text; today date;
begin
  perform public.assert_hub_equipment_actor(p_store,p_actor,true);
  select (now() at time zone timezone)::date into today from public.hub_stores where id=p_store;
  if p_id is not null then
    perform public.ensure_hub_equipment_tasks(p_store,today);
    select * into e from public.hub_equipment where id=p_id and store_id=p_store for update;
    if e.id is null then raise exception 'Equipment not found' using errcode='P0002'; end if;
    if e.version<>p_version or p_version is null then raise exception 'equipment_conflict' using errcode='P0001'; end if;
    old_status:=e.status;
    update public.hub_equipment set name=p_values->>'name',manufacturer=p_values->>'manufacturer',model=p_values->>'model',serial_number=p_values->>'serial_number',location=p_values->>'location',notes=p_values->>'notes',service_contact=p_values->>'service_contact',status=p_values->>'status',version=version+1,updated_by=p_actor,updated_at=now()
      where id=p_id and store_id=p_store returning * into e;
    if e.status<>old_status then
      update public.hub_equipment_schedules set version=version+1,materialized_through=case when e.status='active' then today-1 else today end,effective_from=greatest(effective_from,today) where equipment_id=p_id and store_id=p_store;
      if e.status<>'active' then update public.hub_equipment_tasks set status='cancelled',cancelled_at=now() where equipment_id=p_id and store_id=p_store and status='pending'; end if;
    end if;
  else
    insert into public.hub_equipment(store_id,name,manufacturer,model,serial_number,location,notes,service_contact,status,created_by,updated_by)
      values(p_store,p_values->>'name',p_values->>'manufacturer',p_values->>'model',p_values->>'serial_number',p_values->>'location',p_values->>'notes',p_values->>'service_contact',p_values->>'status',p_actor,p_actor) returning * into e;
  end if;
  return to_jsonb(e);
end $$;

create function public.save_hub_equipment_schedule(p_store text,p_actor text,p_equipment uuid,p_id uuid,p_version integer,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.hub_equipment_schedules; today date;
begin
  perform public.assert_hub_equipment_actor(p_store,p_actor,true);
  if not exists(select 1 from public.hub_equipment where id=p_equipment and store_id=p_store) then raise exception 'Equipment not found' using errcode='P0002'; end if;
  select (now() at time zone timezone)::date into today from public.hub_stores where id=p_store;
  if (p_id is null and (p_values->>'start_date')::date<today-366) or (p_values->>'start_date')::date>today+3660 then raise exception 'Invalid first due date' using errcode='22023'; end if;
  perform public.ensure_hub_equipment_tasks(p_store,today);
  if p_id is not null then
    select * into s from public.hub_equipment_schedules where id=p_id and store_id=p_store and equipment_id=p_equipment for update;
    if s.id is null then raise exception 'Schedule not found' using errcode='P0002'; end if;
    if s.version<>p_version or p_version is null then raise exception 'equipment_conflict' using errcode='P0001'; end if;
    update public.hub_equipment_tasks set status='cancelled',cancelled_at=now() where store_id=p_store and schedule_id=p_id and status='pending' and (due_date>=today or not (p_values->>'is_active')::boolean);
    update public.hub_equipment_schedules set title=p_values->>'title',instructions=p_values->>'instructions',kind=p_values->>'kind',frequency_unit=p_values->>'frequency_unit',frequency_interval=(p_values->>'frequency_interval')::integer,start_date=(p_values->>'start_date')::date,shift=p_values->>'shift',responsible_role=p_values->>'responsible_role',is_active=(p_values->>'is_active')::boolean,
      version=version+1,effective_from=today,materialized_through=today-1,updated_by=p_actor,updated_at=now()
      where id=p_id and store_id=p_store returning * into s;
  else
    insert into public.hub_equipment_schedules(store_id,equipment_id,title,instructions,kind,frequency_unit,frequency_interval,start_date,shift,responsible_role,is_active,effective_from,updated_by)
      values(p_store,p_equipment,p_values->>'title',p_values->>'instructions',p_values->>'kind',p_values->>'frequency_unit',(p_values->>'frequency_interval')::integer,(p_values->>'start_date')::date,p_values->>'shift',p_values->>'responsible_role',(p_values->>'is_active')::boolean,(p_values->>'start_date')::date,p_actor) returning * into s;
  end if;
  return to_jsonb(s);
end $$;

create function public.complete_hub_equipment_task(p_store text,p_actor text,p_task uuid,p_notes text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare task public.hub_equipment_tasks; actor_role text; actor_name text; today date;
begin
  perform public.assert_hub_equipment_actor(p_store,p_actor,false);
  select * into task from public.hub_equipment_tasks where id=p_task and store_id=p_store for update;
  if task.id is null then raise exception 'Task not found' using errcode='P0002'; end if;
  if task.status='completed' then return to_jsonb(task); end if;
  if task.status<>'pending' then raise exception 'This task was cancelled. Reload the checklist.' using errcode='P0001'; end if;
  select (now() at time zone timezone)::date into today from public.hub_stores where id=p_store;
  if task.due_date>today then raise exception 'This task is not due yet' using errcode='22023'; end if;
  select case when m.follows_home_role then public.hub_access_role(to_jsonb(e)->>'role') else m.role end into actor_role
    from public.hub_store_memberships m join public.employees e on e.id::text=m.employee_id where m.store_id=p_store and m.employee_id=p_actor;
  if array_position(array['crew','shift_lead','assistant_manager','gm'],actor_role)<array_position(array['crew','shift_lead','assistant_manager','gm'],task.responsible_role) then raise exception 'This task requires a supervisor' using errcode='42501'; end if;
  if length(coalesce(p_notes,''))>10000 then raise exception 'Notes are too long' using errcode='22023'; end if;
  select concat_ws(' ',e.first_name,e.last_name) into actor_name from public.employees e where e.id::text=p_actor;
  update public.hub_equipment_tasks set status='completed',completed_at=now(),completed_date=today,completed_by=p_actor,completed_by_name=actor_name,notes=coalesce(p_notes,'') where id=p_task and store_id=p_store returning * into task;
  return to_jsonb(task);
end $$;

create function public.get_hub_store_people(p_store text,p_actor text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare org uuid; access text; result jsonb;
begin
  perform public.assert_hub_equipment_actor(p_store,p_actor,false);
  select organization_id into org from public.hub_stores where id=p_store;
  select case when m.follows_home_role then public.hub_access_role(to_jsonb(e)->>'role') else m.role end into access
    from public.hub_store_memberships m join public.employees e on e.id::text=m.employee_id where m.store_id=p_store and m.employee_id=p_actor and m.is_active;
  if access<>'gm' and not exists(select 1 from public.hub_organization_admins where organization_id=org and employee_id=p_actor) then raise exception 'Store access management denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('employee_id',e.id::text,'name',concat_ws(' ',e.first_name,e.last_name),'home_store',home.name,'role',case when m.follows_home_role then public.hub_access_role(to_jsonb(e)->>'role') else m.role end,'is_active',coalesce(m.is_active,false)) order by e.last_name,e.first_name,e.id),'[]'::jsonb) into result
    from public.employees e join public.hub_stores home on home.id=e.store_id::text and home.organization_id=org
    left join public.hub_store_memberships m on m.store_id=p_store and m.employee_id=e.id::text
    where coalesce((to_jsonb(e)->>'is_active')::boolean,true) and coalesce(to_jsonb(e)->>'status','active') not in ('inactive','terminated');
  return result;
end $$;

create function public.save_hub_store_member(p_store text,p_actor text,p_employee text,p_role text,p_active boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare people jsonb;
begin
  people:=public.get_hub_store_people(p_store,p_actor);
  if p_active is null or p_role not in ('crew','shift_lead','assistant_manager','gm') or p_role is null then raise exception 'Invalid access setting' using errcode='22023'; end if;
  if not exists(select 1 from jsonb_array_elements(people) person where person->>'employee_id'=p_employee) then raise exception 'Employee is outside this organization or inactive' using errcode='42501'; end if;
  if p_actor=p_employee and (not p_active or p_role<>'gm') then raise exception 'You cannot remove your own manager access' using errcode='22023'; end if;
  insert into public.hub_store_memberships(store_id,employee_id,role,is_active) values(p_store,p_employee,p_role,p_active)
    on conflict(store_id,employee_id) do update set role=excluded.role,is_active=excluded.is_active,follows_home_role=false;
  return public.get_hub_store_people(p_store,p_actor);
end $$;
revoke execute on function public.get_hub_store_people(text,text),public.save_hub_store_member(text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.get_hub_store_people(text,text),public.save_hub_store_member(text,text,text,text,boolean) to service_role;

do $$ declare name text;
begin
  foreach name in array array['hub_organizations','hub_stores','hub_store_memberships','hub_organization_admins','hub_equipment','hub_equipment_manuals','hub_equipment_schedules','hub_equipment_tasks'] loop
    execute format('alter table public.%I enable row level security',name);
    execute format('revoke all on table public.%I from public,anon,authenticated',name);
    execute format('grant select,insert,update on table public.%I to service_role',name);
  end loop;
end $$;
revoke execute on function public.hub_access_role(text),public.get_hub_store_access(text),public.create_hub_store(text,text,text,text,text),public.assert_hub_equipment_actor(text,text,boolean),public.ensure_hub_equipment_tasks(text,date),public.save_hub_equipment(text,text,uuid,integer,jsonb),public.save_hub_equipment_schedule(text,text,uuid,uuid,integer,jsonb),public.complete_hub_equipment_task(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.hub_access_role(text),public.get_hub_store_access(text),public.create_hub_store(text,text,text,text,text),public.assert_hub_equipment_actor(text,text,boolean),public.ensure_hub_equipment_tasks(text,date),public.save_hub_equipment(text,text,uuid,integer,jsonb),public.save_hub_equipment_schedule(text,text,uuid,uuid,integer,jsonb),public.complete_hub_equipment_task(text,text,uuid,text) to service_role;
create policy equipment_documents_server_only on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'equipment-documents') with check(bucket_id<>'equipment-documents');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('equipment-documents','equipment-documents',false,52428800,array['application/pdf']);

commit;
