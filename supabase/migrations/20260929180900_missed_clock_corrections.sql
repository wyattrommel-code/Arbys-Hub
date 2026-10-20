-- The kiosk API verifies the registered device, kiosk actor and employee PIN.
-- Keep the historical entry and its status change in one transaction.
create function public.hub_correct_missed_punch(
  p_employee uuid, p_type text, p_claimed timestamptz, p_reason text,
  p_expected_punch uuid default null, p_expected_break uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  emp public.employees%rowtype;
  punch public.time_punches%rowtype;
  br public.break_punches%rowtype;
  settings public.attendance_settings%rowtype;
  correction_id uuid;
  unpaid integer := 0;
  minutes integer;
  employee_name text;
begin
  if p_type is null or p_type not in ('forgot_clock_in','forgot_clock_out','forgot_break_start','forgot_break_end') then
    raise exception 'Unknown correction type.';
  end if;
  if p_claimed is null or not isfinite(p_claimed) or p_claimed > now() or p_claimed < now() - interval '7 days' then
    raise exception 'Choose a time within the past 7 days, not in the future.';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 or length(p_reason) > 1000 then
    raise exception 'Enter a reason (3â€“1000 characters).';
  end if;
  select * into emp from public.employees where id=p_employee and store_id='07462'
    and is_active is true and coalesce(status,'active') <> 'terminated';
  if not found then raise exception 'Employee is no longer active.'; end if;
  employee_name := trim(concat_ws(' ',emp.first_name,emp.last_name));

  -- Briefly serialize with punch/break writes while validating and saving all rows.
  lock table public.time_punches, public.break_punches in share row exclusive mode;
  select * into punch from public.time_punches where employee_id=p_employee and store_id='payson'
    and clock_out is null order by clock_in desc limit 1;
  if punch.id is distinct from p_expected_punch then
    raise exception 'Your clock status changed. Select your name again.';
  end if;
  select * into br from public.break_punches where time_punch_id=punch.id and store_id='payson'
    and break_end is null order by break_start desc limit 1;
  if br.id is distinct from p_expected_break then
    raise exception 'Your break status changed. Select your name again.';
  end if;
  select * into settings from public.attendance_settings where store_id='payson' limit 1;

  if p_type='forgot_clock_in' then
    if punch.id is not null then raise exception 'Already clocked in. Select your name again.'; end if;
    if exists(select 1 from public.time_punches where employee_id=p_employee and store_id='payson'
      and coalesce(clock_out,'infinity'::timestamptz) > p_claimed) then
      raise exception 'That time overlaps an existing shift. Ask your manager to review your timecard.';
    end if;
    insert into public.time_punches(employee_id,employee_name,jolt_employee_id,clock_in,status,store_id,
      unscheduled,on_break,total_break_minutes,needs_approval,correction_type,correction_note)
      values(p_employee,employee_name,emp.jolt_employee_id,p_claimed,'open','payson',
        true,false,0,true,p_type,trim(p_reason)) returning * into punch;
  else
    if punch.id is null then raise exception 'No open shift. Select your name again.'; end if;
    if p_claimed <= punch.clock_in then raise exception 'The missed time must be after clock-in.'; end if;
    if p_type='forgot_break_end' then
      if br.id is null then raise exception 'No open break. Select your name again.'; end if;
      if p_claimed <= br.break_start then raise exception 'Break end must be after break start.'; end if;
      minutes := round(extract(epoch from (p_claimed-br.break_start))/60)::integer;
      update public.break_punches set break_end=p_claimed,break_minutes=minutes,status='closed' where id=br.id;
      update public.time_punches set on_break=false,
        total_break_minutes=coalesce(total_break_minutes,0)+minutes where id=punch.id;
    else
      if br.id is not null or coalesce(punch.on_break,false) then
        raise exception 'End your break first. Select your name again.';
      end if;
      if exists(select 1 from public.break_punches where time_punch_id=punch.id
        and (break_end is null or break_end > p_claimed)) then
        raise exception 'That time is before an existing break ended. Ask your manager to review it.';
      end if;
      if p_type='forgot_break_start' then
        if not coalesce(settings.use_break_punches,true) then raise exception 'Break punches are disabled.'; end if;
        insert into public.break_punches(time_punch_id,employee_id,employee_name,break_start,status,store_id)
          values(punch.id,p_employee,employee_name,p_claimed,'open','payson') returning * into br;
        update public.time_punches set on_break=true where id=punch.id;
      else
        if coalesce(settings.use_break_punches,true) then
          unpaid := coalesce(punch.total_break_minutes,0);
        elsif coalesce(settings.subtract_scheduled_break,true) and punch.shift_id is not null then
          select coalesce(unpaid_break_minutes,0) into unpaid from public.schedule_shifts
            where id=punch.shift_id and store_id='payson';
        end if;
        update public.time_punches set clock_out=p_claimed,status='closed',on_break=false,
          worked_minutes=greatest(0,round(extract(epoch from (p_claimed-clock_in))/60 - coalesce(unpaid,0)))::integer
          where id=punch.id;
      end if;
    end if;
    update public.time_punches set needs_approval=true,correction_type=p_type,correction_note=trim(p_reason)
      where id=punch.id returning * into punch;
  end if;
  insert into public.punch_corrections(time_punch_id,break_punch_id,employee_id,employee_name,
    correction_type,claimed_time,reason,status,store_id)
    values(punch.id,br.id,p_employee,employee_name,p_type,p_claimed,trim(p_reason),'pending','payson')
    returning id into correction_id;
  return jsonb_build_object('punch',to_jsonb(punch),'correction_id',correction_id);
end;
$$;
revoke all on function public.hub_correct_missed_punch(uuid,text,timestamptz,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.hub_correct_missed_punch(uuid,text,timestamptz,text,uuid,uuid) to service_role;
