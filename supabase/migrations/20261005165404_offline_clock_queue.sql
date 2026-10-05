-- Private keys never leave the Hub server. The iPad receives only the public key.
create table public.clock_offline_keys (
  id text primary key check (id='v1'), public_jwk jsonb not null, private_jwk jsonb not null
);
alter table public.clock_offline_keys enable row level security;
revoke all on public.clock_offline_keys from public,anon,authenticated,service_role;
grant select,insert on public.clock_offline_keys to service_role;

create table public.clock_offline_events (
  id uuid primary key,
  store_id text not null default 'payson' check (store_id='payson'),
  device_hash text not null check (device_hash ~ '^[a-f0-9]{64}$'),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  employee_id uuid not null, employee_name text not null,
  event jsonb not null, photo_url text not null,
  occurred_at timestamptz not null, captured_at timestamptz not null,
  status text not null check (status in ('applied','review')),
  issue text, punch_id uuid references public.time_punches(id) on delete restrict,
  break_id uuid references public.break_punches(id) on delete set null,
  received_at timestamptz not null default now(),
  resolved_at timestamptz, resolved_by uuid references public.employees(id), resolution_note text,
  resolution_punch_id uuid references public.time_punches(id) on delete restrict,
  check ((resolved_at is null and resolved_by is null and resolution_note is null) or
    (status='review' and resolved_at is not null and resolved_by is not null and length(trim(resolution_note)) between 3 and 1000))
);
create index clock_offline_review_idx on public.clock_offline_events(store_id,received_at) where status='review' and resolved_at is null;
create index clock_offline_employee_idx on public.clock_offline_events(employee_id);
create index clock_offline_punch_idx on public.clock_offline_events(punch_id);
create index clock_offline_break_idx on public.clock_offline_events(break_id);
create index clock_offline_resolver_idx on public.clock_offline_events(resolved_by);
create index clock_offline_resolution_punch_idx on public.clock_offline_events(resolution_punch_id);
create index clock_offline_payroll_idx on public.clock_offline_events(store_id,occurred_at) where status='review' and resolved_at is null;
alter table public.clock_offline_events enable row level security;
revoke all on public.clock_offline_events from public,anon,authenticated,service_role;
grant select,insert on public.clock_offline_events to service_role;
grant update(resolved_at,resolved_by,resolution_note,resolution_punch_id) on public.clock_offline_events to service_role;

alter table public.punch_corrections add column source text not null default 'kiosk' check(source in ('kiosk','offline'));

-- The gateway verifies the paired device, signed capture lease and encrypted PIN.
-- Dedupe receipt, state changes and audit are committed in one transaction.
create function public.hub_sync_offline_punch(
  p_event jsonb, p_device text, p_fingerprint text, p_photo text, p_face boolean,
  p_issue text default null, p_shift uuid default null, p_manager uuid default null, p_manager_name text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  existing public.clock_offline_events%rowtype;
  prior public.clock_offline_events%rowtype;
  event_id uuid := (p_event->>'id')::uuid;
  employee uuid := (p_event->>'employee_id')::uuid;
  kind text := p_event->>'kind';
  issue text := p_issue;
  expected_punch uuid;
  expected_break uuid;
  reference text;
  result jsonb;
  punch uuid;
  br uuid;
  name text;
begin
  if kind is null or kind not in ('clock_in','clock_out','break_start','break_end','forgot_clock_in','forgot_clock_out','forgot_break_start','forgot_break_end') then
    raise exception 'Invalid offline action.' using errcode='22023';
  end if;
  if p_photo is null or position('/storage/v1/object/public/punch-photos/payson/'||employee::text||'/' in p_photo)=0 then
    raise exception 'Offline photo is required.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(event_id::text,0));
  select * into existing from public.clock_offline_events where id=event_id;
  if found then
    if existing.device_hash<>p_device or existing.fingerprint<>p_fingerprint then
      raise exception 'Offline receipt does not match.' using errcode='22023';
    end if;
    return jsonb_build_object('id',event_id,'status',existing.status);
  end if;
  if p_event->>'previous_id' is not null then
    select * into prior from public.clock_offline_events where id=(p_event->>'previous_id')::uuid and employee_id=employee and device_hash=p_device;
    if not found then raise exception 'Previous offline punch has not arrived.' using errcode='40001'; end if;
    if prior.status='review' then issue:=coalesce(issue,'An earlier offline punch needs review. Apply these punches in order.'); end if;
  end if;
  reference:=p_event->>'punch_id';
  if reference like 'local:%' then
    select * into prior from public.clock_offline_events where id=substring(reference from 7)::uuid and employee_id=employee and device_hash=p_device;
    if not found then raise exception 'Related clock-in has not arrived.' using errcode='40001'; end if;
    expected_punch:=prior.punch_id;
    if prior.status='review' then issue:=coalesce(issue,'The related clock-in needs review.'); end if;
  else expected_punch:=reference::uuid; end if;
  reference:=p_event->>'break_id';
  if reference like 'local:%' then
    select * into prior from public.clock_offline_events where id=substring(reference from 7)::uuid and employee_id=employee and device_hash=p_device;
    if not found then raise exception 'Related break has not arrived.' using errcode='40001'; end if;
    expected_break:=prior.break_id;
    if prior.status='review' then issue:=coalesce(issue,'The related break needs review.'); end if;
  else expected_break:=reference::uuid; end if;
  select trim(concat_ws(' ',first_name,last_name)) into name from public.employees where id=employee and store_id='07462';
  name:=coalesce(nullif(name,''),'Unknown employee');
  if issue is null then
    begin
      result:=public.hub_correct_missed_punch_photo(employee,
        case when kind like 'forgot_%' then kind else 'forgot_'||kind end,
        (p_event->>'occurred_at')::timestamptz,
        case when kind like 'forgot_%' then p_event->>'reason' else 'Recorded on the store iPad while offline.' end,
        p_photo,p_face,expected_punch,expected_break);
      punch:=(result->'punch'->>'id')::uuid;
      update public.punch_corrections set source='offline',photo_captured_at=(p_event->>'captured_at')::timestamptz
        where id=(result->>'correction_id')::uuid returning break_punch_id into br;
      if kind in ('clock_in','forgot_clock_in') then
        update public.time_punches set clock_in_photo_url=p_photo,face_detected_in=p_face,
          shift_id=p_shift,unscheduled=(p_shift is null),authorized_by_id=p_manager,authorized_by=p_manager_name where id=punch;
      elsif kind in ('clock_out','forgot_clock_out') then
        update public.time_punches set clock_out_photo_url=p_photo,face_detected_out=p_face where id=punch;
      end if;
      select to_jsonb(t) into result from public.time_punches t where id=punch;
    exception when raise_exception or unique_violation then
      -- Roll back this event's mutation; preserve its evidence for the manager.
      issue:=sqlerrm; punch:=null; br:=null; result:=null;
    end;
  end if;
  insert into public.clock_offline_events(id,device_hash,fingerprint,employee_id,employee_name,event,photo_url,occurred_at,captured_at,status,issue,punch_id,break_id)
    values(event_id,p_device,p_fingerprint,employee,name,p_event,p_photo,(p_event->>'occurred_at')::timestamptz,(p_event->>'captured_at')::timestamptz,case when issue is null then 'applied' else 'review' end,issue,punch,br);
  return jsonb_build_object('id',event_id,'status',case when issue is null then 'applied' else 'review' end,'punch',result);
end; $$;
revoke all on function public.hub_sync_offline_punch(jsonb,text,text,text,boolean,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.hub_sync_offline_punch(jsonb,text,text,text,boolean,text,uuid,uuid,text) to service_role;

-- A GM/AM can verify the photo and apply a held punch without asking the employee
-- to retake it. The API verifies manager permissions; applying and resolving are atomic.
create function public.hub_apply_offline_review(p_id uuid,p_actor uuid,p_note text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  event public.clock_offline_events%rowtype;
  current_punch uuid;
  current_break uuid;
  result jsonb;
  kind text;
begin
  if p_note is null or length(trim(p_note))<3 or length(p_note)>1000 then raise exception 'Enter a resolution note.' using errcode='22023'; end if;
  if not exists(select 1 from public.employees where id=p_actor and store_id='07462' and is_active) then raise exception 'Manager is not active.' using errcode='42501'; end if;
  select * into event from public.clock_offline_events where id=p_id and store_id='payson' for update;
  if not found or event.status<>'review' or event.resolved_at is not null then raise exception 'This punch has already been handled.' using errcode='40001'; end if;
  if exists(select 1 from public.clock_offline_events where employee_id=event.employee_id and store_id=event.store_id and status='review' and resolved_at is null and received_at<event.received_at) then
    raise exception 'Handle this employee''s earlier offline punches first.' using errcode='22023';
  end if;
  lock table public.time_punches,public.break_punches in share row exclusive mode;
  select id into current_punch from public.time_punches where employee_id=event.employee_id and store_id='payson' and clock_out is null order by clock_in desc limit 1;
  select id into current_break from public.break_punches where time_punch_id=current_punch and store_id='payson' and break_end is null order by break_start desc limit 1;
  kind:=event.event->>'kind';
  result:=public.hub_correct_missed_punch_photo(event.employee_id,case when kind like 'forgot_%' then kind else 'forgot_'||kind end,
    event.occurred_at,trim(p_note),event.photo_url,false,current_punch,current_break);
  current_punch:=(result->'punch'->>'id')::uuid;
  update public.punch_corrections set source='offline',photo_captured_at=event.captured_at where id=(result->>'correction_id')::uuid;
  if kind in ('clock_in','forgot_clock_in') then
    update public.time_punches set clock_in_photo_url=event.photo_url,authorized_by_id=p_actor where id=current_punch;
  elsif kind in ('clock_out','forgot_clock_out') then
    update public.time_punches set clock_out_photo_url=event.photo_url where id=current_punch;
  end if;
  update public.clock_offline_events set resolved_at=now(),resolved_by=p_actor,resolution_note=trim(p_note),resolution_punch_id=current_punch where id=p_id;
  return (select to_jsonb(t) from public.time_punches t where id=current_punch);
end; $$;
revoke all on function public.hub_apply_offline_review(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.hub_apply_offline_review(uuid,uuid,text) to service_role;
