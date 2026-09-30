alter table public.time_punches add column edit_revision integer not null default 0;
-- Keep missed-punch reasons and photos when a manager removes a break.
alter table public.punch_corrections drop constraint punch_corrections_break_punch_id_fkey;
alter table public.punch_corrections add constraint punch_corrections_break_punch_id_fkey
  foreign key (break_punch_id) references public.break_punches(id) on delete set null;

create table public.timecard_edits (
  id uuid primary key default gen_random_uuid(),
  punch_id uuid not null references public.time_punches(id) on delete restrict,
  store_id text not null default 'payson',
  edited_by uuid not null references public.employees(id),
  edited_by_name text not null,
  edited_at timestamptz not null default now(),
  note text not null check (length(trim(note)) between 3 and 1000),
  before_state jsonb not null,
  after_state jsonb not null
);
create index timecard_edits_punch_idx on public.timecard_edits(punch_id,edited_at);
alter table public.timecard_edits enable row level security;
revoke all on public.timecard_edits from public,anon,authenticated,service_role;
grant select,insert on public.timecard_edits to service_role;

create function public.hub_edit_timecard(
  p_id uuid, p_clock_in timestamptz, p_clock_out timestamptz, p_breaks jsonb,
  p_expected jsonb, p_actor uuid, p_actor_name text, p_note text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  punch public.time_punches%rowtype;
  prior_breaks jsonb; expected_breaks jsonb; after_breaks jsonb; before_state jsonb;
  item record; previous_end timestamptz; seen_open boolean := false;
  total_minutes integer := 0; unpaid integer := 0; row_id uuid; kept uuid[] := '{}';
  settings public.attendance_settings%rowtype;
begin
  if p_note is null or length(trim(p_note)) not between 3 and 1000 then
    raise exception 'Enter a correction reason (3-1000 characters).' using errcode='22023';
  end if;
  if p_actor is null or not exists(select 1 from public.employees where id=p_actor and store_id='07462' and is_active is true and coalesce(status,'active') not in ('inactive','terminated')) then
    raise exception 'Manager is no longer active.' using errcode='42501';
  end if;
  if p_clock_in is null or not isfinite(p_clock_in) or p_clock_in > now()
    or (p_clock_out is not null and (not isfinite(p_clock_out) or p_clock_out > now() or p_clock_out <= p_clock_in)) then
    raise exception 'Enter valid past shift times; clock-out must follow clock-in.' using errcode='22023';
  end if;
  if p_breaks is null or jsonb_typeof(p_breaks) <> 'array' or jsonb_array_length(p_breaks)>50 then
    raise exception 'Provide the shift breaks (up to 50).' using errcode='22023';
  end if;
  -- Match the missed-punch lock order and save shift, breaks, totals and history together.
  lock table public.time_punches,public.break_punches in share row exclusive mode;
  select * into punch from public.time_punches where id=p_id and store_id='payson';
  if not found then raise exception 'Punch not found.' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'start',b.break_start,'end',b.break_end) order by b.id),'[]'::jsonb)
    into prior_breaks from public.break_punches b where time_punch_id=p_id and store_id='payson';
  select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]'::jsonb) into expected_breaks
    from jsonb_to_recordset(p_expected->'breaks') as b(id uuid,start timestamptz,"end" timestamptz);
  if p_expected is null or not (p_expected ? 'revision')
    or punch.edit_revision is distinct from (p_expected->>'revision')::integer
    or punch.clock_in is distinct from (p_expected->>'clock_in')::timestamptz
    or punch.clock_out is distinct from (p_expected->>'clock_out')::timestamptz
    or coalesce(punch.on_break,false) is distinct from (p_expected->>'on_break')::boolean
    or coalesce(punch.total_break_minutes,0) is distinct from (p_expected->>'total_break_minutes')::integer
    or prior_breaks is distinct from expected_breaks then
    raise exception 'This punch changed. Close the editor, refresh and try again.' using errcode='40001';
  end if;
  if exists(select 1 from public.time_punches where employee_id=punch.employee_id and store_id='payson' and id<>p_id
    and clock_in < coalesce(p_clock_out,'infinity'::timestamptz) and coalesce(clock_out,'infinity'::timestamptz)>p_clock_in) then
    raise exception 'These times overlap another shift.' using errcode='22023';
  end if;
  before_state := jsonb_build_object('clock_in',punch.clock_in,'clock_out',punch.clock_out,
    'worked_minutes',punch.worked_minutes,'total_break_minutes',punch.total_break_minutes,'breaks',prior_breaks);
  previous_end := p_clock_in;
  for item in select * from jsonb_to_recordset(p_breaks) as b(id uuid,start timestamptz,"end" timestamptz) order by start loop
    if item.start is null or not isfinite(item.start) or item.start < p_clock_in or item.start > now()
      or (p_clock_out is not null and item.start >= p_clock_out)
      or (item."end" is not null and (not isfinite(item."end") or item."end" <= item.start or item."end">now() or item."end">p_clock_out)) then
      raise exception 'Breaks must fall within the shift and end after they start.' using errcode='22023';
    end if;
    if seen_open or item.start < previous_end then raise exception 'Breaks cannot overlap.' using errcode='22023'; end if;
    if item."end" is null then
      if p_clock_out is not null then raise exception 'End all breaks before closing the shift.' using errcode='22023'; end if;
      seen_open := true;
    else total_minutes := total_minutes + round(extract(epoch from (item."end"-item.start))/60)::integer;
    end if;
    previous_end := item."end";
    if item.id is not null then
      if item.id=any(kept) or not exists(select 1 from public.break_punches where id=item.id and time_punch_id=p_id and store_id='payson') then
        raise exception 'Break does not belong to this shift or is duplicated.' using errcode='22023';
      end if;
      row_id := item.id;
      update public.break_punches set break_start=item.start,break_end=item."end",
        break_minutes=case when item."end" is null then null else round(extract(epoch from (item."end"-item.start))/60)::integer end,
        status=case when item."end" is null then 'open' else 'edited' end where id=row_id;
    else
      insert into public.break_punches(time_punch_id,employee_id,employee_name,break_start,break_end,break_minutes,status,store_id)
        values(p_id,punch.employee_id,punch.employee_name,item.start,item."end",
          case when item."end" is null then null else round(extract(epoch from (item."end"-item.start))/60)::integer end,
          case when item."end" is null then 'open' else 'edited' end,'payson') returning id into row_id;
    end if;
    kept := array_append(kept,row_id);
  end loop;
  delete from public.break_punches where time_punch_id=p_id and store_id='payson' and not(id=any(kept));
  select * into settings from public.attendance_settings where store_id='payson' limit 1;
  if coalesce(settings.use_break_punches,true) then unpaid:=total_minutes;
  elsif coalesce(settings.subtract_scheduled_break,true) and punch.shift_id is not null then
    select coalesce(unpaid_break_minutes,0) into unpaid from public.schedule_shifts where id=punch.shift_id and store_id='payson';
  end if;
  update public.time_punches set clock_in=p_clock_in,clock_out=p_clock_out,on_break=seen_open,total_break_minutes=total_minutes,
    worked_minutes=case when p_clock_out is null then null else greatest(0,round(extract(epoch from(p_clock_out-p_clock_in))/60)::integer-coalesce(unpaid,0)) end,
    status=case when p_clock_out is null then 'open' else 'edited' end,needs_approval=true,edit_revision=edit_revision+1
    where id=p_id returning * into punch;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'start',b.break_start,'end',b.break_end) order by b.id),'[]'::jsonb)
    into after_breaks from public.break_punches b where time_punch_id=p_id and store_id='payson';
  insert into public.timecard_edits(punch_id,edited_by,edited_by_name,note,before_state,after_state)
    values(p_id,p_actor,p_actor_name,trim(p_note),before_state,jsonb_build_object('clock_in',punch.clock_in,'clock_out',punch.clock_out,
      'worked_minutes',punch.worked_minutes,'total_break_minutes',punch.total_break_minutes,'breaks',after_breaks));
  return to_jsonb(punch);
end;
$$;
revoke all on function public.hub_edit_timecard(uuid,timestamptz,timestamptz,jsonb,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.hub_edit_timecard(uuid,timestamptz,timestamptz,jsonb,jsonb,uuid,text,text) to service_role;
