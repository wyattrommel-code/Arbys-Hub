-- Reasons are separate from payroll identity and the original employee's shift.
alter table public.time_punches add column work_context jsonb;
alter table public.time_punches add constraint time_punch_work_object check (work_context is null or jsonb_typeof(work_context)='object');
create index time_punch_coverage_idx on public.time_punches ((work_context->>'covered_shift_id')) where work_context->>'reason'='covering';

-- Internal gateway helper. The API verifies the paired iPad and manager PIN.
-- All functions remain invoker-only and inaccessible to browser roles.
create function public.hub_resolve_clock_work(p_work jsonb,p_employee uuid,p_at timestamptz,p_manager uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  s public.schedule_shifts%rowtype;
  starts timestamptz;
  ends timestamptz;
  agreed_start timestamptz;
  agreed_end timestamptz;
  reason text:=p_work->>'reason';
  absence text:=p_work->>'absence';
  result jsonb;
begin
  if p_work is null then return null; end if;
  if reason is null or reason not in ('covering','extra_hours','schedule_issue') or jsonb_typeof(p_work)<>'object'
    or length(coalesce(p_work->>'note',''))>500 then raise exception 'Choose a valid clock-in reason.'; end if;
  if p_manager is null or not exists(select 1 from public.employees where id=p_manager and store_id='07462' and is_active)
    then raise exception 'Manager authorization is required.'; end if;
  result:=jsonb_build_object('version',1,'reason',reason,'note',coalesce(p_work->>'note',''),'approved_by',p_manager,'approved_at',p_at);
  if reason<>'covering' then return result; end if;
  select * into s from public.schedule_shifts where id=(p_work->>'covered_shift_id')::uuid and store_id='payson' for update;
  if not found or s.employee_id is null or s.employee_id=p_employee then raise exception 'Choose another employee''s scheduled shift.'; end if;
  if not exists(select 1 from public.schedule_weeks where store_id=s.store_id and
    week_start_date=s.shift_date-extract(dow from s.shift_date)::int and status='published') then raise exception 'That shift is not published. Ask your manager to check the schedule.'; end if;
  starts:=(s.shift_date+s.scheduled_start) at time zone 'America/Denver';
  ends:=((s.shift_date+case when s.scheduled_end<=s.scheduled_start then 1 else 0 end)+s.scheduled_end) at time zone 'America/Denver';
  agreed_start:=(p_work->>'expected_start')::timestamptz;
  agreed_end:=(p_work->>'expected_end')::timestamptz;
  if p_at<starts-interval '2 hours' or p_at>=ends then raise exception 'That shift is not available to cover now.'; end if;
  if agreed_start is null or agreed_end is null or agreed_end<=agreed_start or agreed_end-agreed_start>interval '16 hours'
    or agreed_start<starts-interval '2 hours' or agreed_end>ends+interval '2 hours'
    or p_at<agreed_start-interval '2 hours' or p_at>=agreed_end then raise exception 'Check the agreed coverage hours.'; end if;
  if absence is null or absence not in ('unchanged','approved_swap','call_out') then raise exception 'Choose the original employee''s attendance outcome.'; end if;
  if exists(select 1 from public.time_punches p where p.store_id='payson' and p.employee_id=s.employee_id
    and p.clock_in<agreed_end and coalesce(p.clock_out,'infinity'::timestamptz)>agreed_start) then
    raise exception 'The scheduled employee has a punch during these hours. Ask your manager to check the shift.';
  end if;
  if exists(select 1 from public.time_punches p where p.store_id='payson' and p.work_context->>'covered_shift_id'=s.id::text
    and (p.work_context->>'expected_start')::timestamptz<agreed_end
    and least((p.work_context->>'expected_end')::timestamptz,coalesce(p.clock_out,'infinity'::timestamptz))>agreed_start) then
    raise exception 'Someone is already recorded as covering those hours.';
  end if;
  if absence='approved_swap' and exists(select 1 from public.attendance_events e where e.store_id='payson' and e.event_type='call_out'
    and (e.shift_id=s.id or (e.shift_id is null and e.employee_id=s.employee_id and e.event_date=s.shift_date))) then
    raise exception 'A call-out is already recorded. Keep that attendance outcome or correct it in the Hub first.';
  end if;
  return result||jsonb_build_object('covered_shift_id',s.id,'covered_employee_id',s.employee_id,'covered_employee_name',s.employee_name,
    'shift_date',s.shift_date,'role',s.role,'station',s.station,'expected_start',agreed_start,'expected_end',agreed_end,'absence',absence);
end; $$;

create function public.hub_clock_in_work(p_punch jsonb,p_work jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.time_punches%rowtype; context jsonb;
begin
  p:=jsonb_populate_record(null::public.time_punches,p_punch);
  if p.employee_id is null or p.store_id<>'payson' or p.clock_in is null then raise exception 'Invalid clock-in.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('clock-work:'||p.employee_id::text,0));
  -- Share the correction/offline lock so a reconnect cannot race an online clock-in.
  lock table public.time_punches,public.break_punches in share row exclusive mode;
  if not exists(select 1 from public.employees where id=p.employee_id and store_id='07462' and is_active) then raise exception 'Employee is unavailable.'; end if;
  if exists(select 1 from public.time_punches where employee_id=p.employee_id and store_id='payson' and clock_out is null) then raise exception 'Already clocked in. Clock out first.'; end if;
  if p.shift_id is not null and not exists(select 1 from public.schedule_shifts where id=p.shift_id and store_id='payson' and
    (employee_id=p.employee_id or (employee_id is null and (jolt_employee_id=p.jolt_employee_id or lower(trim(employee_name))=lower(trim(p.employee_name)))))) then raise exception 'Scheduled shift has changed. Select your name again.'; end if;
  if p.shift_id is null and p_work is null then raise exception 'Choose why you are clocking in.'; end if;
  context:=public.hub_resolve_clock_work(p_work,p.employee_id,p.clock_in,p.authorized_by_id);
  if context is not null and p.clock_in_photo_url is null then raise exception 'Photo is required to clock in.'; end if;
  insert into public.time_punches(employee_id,employee_name,jolt_employee_id,shift_id,clock_in,clock_in_photo_url,face_detected_in,
    unscheduled,authorized_by,authorized_by_id,status,store_id,on_break,total_break_minutes,work_context)
  values(p.employee_id,p.employee_name,p.jolt_employee_id,case when context is null then p.shift_id else null end,p.clock_in,p.clock_in_photo_url,p.face_detected_in,
    p.shift_id is null,p.authorized_by,p.authorized_by_id,'open','payson',false,0,context) returning * into p;
  return to_jsonb(p);
end; $$;

-- Reuse the established idempotent sync transaction, adding reason validation
-- and persistence in the SAME transaction. Conflicts keep their evidence for review.
create function public.hub_sync_offline_punch_work(
  p_event jsonb,p_device text,p_fingerprint text,p_photo text,p_face boolean,
  p_issue text default null,p_shift uuid default null,p_manager uuid default null,p_manager_name text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; context jsonb; issue text:=p_issue;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_event->>'id',0));
  if exists(select 1 from public.clock_offline_events where id=(p_event->>'id')::uuid) then
    return public.hub_sync_offline_punch(p_event,p_device,p_fingerprint,p_photo,p_face,p_issue,p_shift,p_manager,p_manager_name);
  end if;
  lock table public.time_punches,public.break_punches in share row exclusive mode;
  if p_event->>'kind'='clock_in' and issue is null and p_event->'work_context' is not null then
    begin
      context:=public.hub_resolve_clock_work(p_event->'work_context',(p_event->>'employee_id')::uuid,(p_event->>'occurred_at')::timestamptz,p_manager);
    exception when raise_exception or invalid_text_representation or datetime_field_overflow then issue:=sqlerrm;
    end;
  end if;
  result:=public.hub_sync_offline_punch(p_event,p_device,p_fingerprint,p_photo,p_face,issue,case when context is null then p_shift else null end,p_manager,p_manager_name);
  if result->>'status'='applied' and context is not null then
    update public.time_punches set work_context=context where id=(result->'punch'->>'id')::uuid;
    result:=jsonb_set(result,'{punch}',(select to_jsonb(p) from public.time_punches p where id=(result->'punch'->>'id')::uuid));
  end if;
  return result;
end; $$;

revoke all on function public.hub_resolve_clock_work(jsonb,uuid,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.hub_clock_in_work(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.hub_sync_offline_punch_work(jsonb,text,text,text,boolean,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.hub_resolve_clock_work(jsonb,uuid,timestamptz,uuid) to service_role;
grant execute on function public.hub_clock_in_work(jsonb,jsonb) to service_role;
grant execute on function public.hub_sync_offline_punch_work(jsonb,text,text,text,boolean,text,uuid,uuid,text) to service_role;

-- A held punch retains its requested reason when a manager applies the evidence.
-- Revalidate coverage under the current manager's approval before changing hours.
create function public.hub_apply_offline_review_work(p_id uuid,p_actor uuid,p_note text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.clock_offline_events%rowtype; context jsonb; result jsonb; actor_name text;
begin
  select * into e from public.clock_offline_events where id=p_id and store_id='payson' for update;
  if not found then raise exception 'Saved punch is unavailable.'; end if;
  lock table public.time_punches,public.break_punches in share row exclusive mode;
  if e.event->>'kind'='clock_in' and e.event->'work_context' is not null then
    context:=public.hub_resolve_clock_work(e.event->'work_context',e.employee_id,e.occurred_at,p_actor);
  end if;
  result:=public.hub_apply_offline_review(p_id,p_actor,p_note);
  if context is not null then
    select trim(concat_ws(' ',first_name,last_name)) into actor_name from public.employees where id=p_actor;
    update public.time_punches set work_context=context,authorized_by_id=p_actor,authorized_by=actor_name where id=(result->>'id')::uuid;
    select to_jsonb(p) into result from public.time_punches p where id=(result->>'id')::uuid;
  end if;
  return result;
end; $$;
revoke all on function public.hub_apply_offline_review_work(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.hub_apply_offline_review_work(uuid,uuid,text) to service_role;
