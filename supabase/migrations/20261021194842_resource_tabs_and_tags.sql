begin;

create table public.hub_resource_libraries (
  store_id text primary key check (length(btrim(store_id)) > 0),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table public.hub_resource_tabs (
  store_id text not null references public.hub_resource_libraries(store_id),
  value text not null check (value ~ '^[a-z][a-z0-9_]{0,63}$'),
  label text not null check (length(btrim(label)) between 1 and 60),
  description text not null default '' check (length(description) <= 160),
  icon text not null default 'folder' check (icon in ('wrench','graduation','clipboard','utensils','shield','folder','book')),
  sort_order integer not null check (sort_order > 0),
  primary key (store_id, value)
);
create index hub_resource_tabs_order_idx on public.hub_resource_tabs (store_id, sort_order);

alter table public.hub_resource_libraries enable row level security;
alter table public.hub_resource_tabs enable row level security;
revoke all on table public.hub_resource_libraries, public.hub_resource_tabs from public, anon, authenticated;
grant select, insert, update on table public.hub_resource_libraries, public.hub_resource_tabs to service_role;

-- The Hub uses its own signed sessions. Only its server can execute these
-- functions, and its API checks the employee's access and configured store.
create function public.get_hub_resource_library(p_store_id text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_store_id is null or length(btrim(p_store_id)) = 0 then
    raise exception 'A store is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.hub_resource_libraries where store_id = p_store_id) then
    insert into public.hub_resource_libraries (store_id) values (p_store_id) on conflict do nothing;
    insert into public.hub_resource_tabs (store_id,value,label,description,icon,sort_order)
    values
      (p_store_id,'equipment','Equipment','Manuals, maintenance, cleaning, and repairs','wrench',1),
      (p_store_id,'training','Training','Learner Hub, onboarding, and station training','graduation',2),
      (p_store_id,'operations','Operations','Opening, closing, service, and daily procedures','clipboard',3),
      (p_store_id,'food_menu','Food & Menu','Builds, prep, portions, and limited-time offers','utensils',4),
      (p_store_id,'safety_cleaning','Safety & Cleaning','Food safety, sanitation, and emergency guides','shield',5),
      (p_store_id,'policies_contacts','Policies & Contacts','Handbooks, store policies, forms, and contacts','folder',6)
    on conflict do nothing;
  end if;
  select jsonb_build_object(
    'version', library.version,
    'categories', coalesce((select jsonb_agg(jsonb_build_object(
      'value', tabs.value, 'label', tabs.label, 'description', tabs.description, 'icon', tabs.icon
    ) order by tabs.sort_order) from public.hub_resource_tabs tabs where tabs.store_id = p_store_id), '[]'::jsonb)
  ) into result from public.hub_resource_libraries library where library.store_id = p_store_id;
  return result;
end;
$$;

create function public.save_hub_resource_tabs(p_store_id text, p_version integer, p_tabs jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  current_version integer;
  tab jsonb;
begin
  perform public.get_hub_resource_library(p_store_id);
  select version into current_version from public.hub_resource_libraries where store_id = p_store_id for update;
  if p_version is null or p_version <> current_version then
    raise exception 'resource_tabs_conflict' using errcode = 'P0001';
  end if;
  if p_tabs is null or jsonb_typeof(p_tabs) <> 'array' then
    raise exception 'Tabs must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_tabs) not between 1 and 30 then
    raise exception 'Use between 1 and 30 tabs' using errcode = '22023';
  end if;
  for tab in select value from jsonb_array_elements(p_tabs) loop
    if jsonb_typeof(tab) is distinct from 'object'
      or coalesce(tab->>'value','') !~ '^[a-z][a-z0-9_]{0,63}$'
      or jsonb_typeof(tab->'label') is distinct from 'string'
      or length(btrim(coalesce(tab->>'label',''))) not between 1 and 60
      or length(coalesce(tab->>'description','')) > 160
      or coalesce(tab->>'icon','') not in ('wrench','graduation','clipboard','utensils','shield','folder','book') then
      raise exception 'Invalid tab' using errcode = '22023';
    end if;
    if not exists (select 1 from public.hub_resource_tabs where store_id=p_store_id and value=tab->>'value')
      and (tab->>'value') !~ '^custom_[0-9a-f]{32}$' then
      raise exception 'Invalid new tab key' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) <> count(distinct value->>'value') or count(*) <> count(distinct lower(btrim(value->>'label'))) from jsonb_array_elements(p_tabs)) then
    raise exception 'Tab names and keys must be unique' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.hub_resource_tabs tabs where tabs.store_id=p_store_id
      and not exists (select 1 from jsonb_array_elements(p_tabs) item where item->>'value'=tabs.value)
  ) then
    raise exception 'Existing tabs cannot be removed' using errcode = '22023';
  end if;

  insert into public.hub_resource_tabs (store_id,value,label,description,icon,sort_order)
    select p_store_id, item->>'value', btrim(item->>'label'), btrim(coalesce(item->>'description','')), item->>'icon', position::integer
    from jsonb_array_elements(p_tabs) with ordinality as entries(item, position)
  on conflict (store_id,value) do update set
    label=excluded.label, description=excluded.description, icon=excluded.icon, sort_order=excluded.sort_order;
  update public.hub_resource_libraries set version=version+1, updated_at=now() where store_id=p_store_id;
  return public.get_hub_resource_library(p_store_id);
end;
$$;

revoke execute on function public.get_hub_resource_library(text), public.save_hub_resource_tabs(text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.get_hub_resource_library(text), public.save_hub_resource_tabs(text,integer,jsonb) to service_role;

do $$
declare resource_store text;
begin
  for resource_store in select distinct store_id from public.hub_resources union select '07462'
  loop perform public.get_hub_resource_library(resource_store); end loop;
end;
$$;

alter table public.hub_resources drop constraint hub_resources_category_check;
alter table public.hub_resources add column tags text[] not null default '{}'::text[]
  check (cardinality(tags) <= 12 and array_position(tags,null) is null);

-- Keep every resource and attachment while moving the former document-type
-- categories into their subject tabs.
update public.hub_resources set
  category = case category when 'learner_hub' then 'training' when 'sops' then 'operations' when 'other' then 'policies_contacts' else category end,
  tags = case category when 'learner_hub' then array['Learner Hub'] when 'sops' then array['SOP'] else '{}'::text[] end,
  version = version+1, updated_at=now()
where category in ('learner_hub','sops','other');

alter table public.hub_resources add constraint hub_resources_category_store_fk
  foreign key (store_id,category) references public.hub_resource_tabs(store_id,value);
create index hub_resources_category_store_idx on public.hub_resources (store_id,category);

commit;
