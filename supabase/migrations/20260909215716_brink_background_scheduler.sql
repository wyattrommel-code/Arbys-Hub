create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Fixed destination, fixed job, and an encrypted scheduler credential. This
-- privileged function is callable only by the server service_role; it cannot
-- schedule arbitrary SQL or send secrets to a caller-selected address.
create function public.brink_configure_scheduler(p_secret text,p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare secret_id uuid;
begin
  if p_secret is null or length(p_secret) < 32 or p_enabled is null then raise exception 'Invalid scheduler configuration'; end if;
  select id into secret_id from vault.secrets where name='hub_brink_scheduler';
  if secret_id is null then
    perform vault.create_secret(p_secret,'hub_brink_scheduler','Arbys Hub fixed-destination PAR scheduler');
  else
    perform vault.update_secret(secret_id,p_secret);
  end if;
  if p_enabled then
    perform cron.schedule('hub-brink-sales','*/3 * * * *',
      $job$select net.http_get(url:='https://arbys-hub.vercel.app/api/cron/brink-sales?mode=automatic',headers:=jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='hub_brink_scheduler')),timeout_milliseconds:=55000);$job$);
  elsif exists(select 1 from cron.job where jobname='hub-brink-sales') then
    perform cron.unschedule('hub-brink-sales');
  end if;
  return p_enabled;
end;
$$;
revoke all on function public.brink_configure_scheduler(text,boolean) from public,anon,authenticated;
grant execute on function public.brink_configure_scheduler(text,boolean) to service_role;

-- Keep detailed XML for 24 hours and request metadata for 30 days. Existing
-- sales snapshots are not removed. Cron's own run history is bounded too.
select cron.schedule('hub-brink-log-retention','17 13 * * *',$job$
 update public.brink_api_calls set response_xml=null where started_at < now()-interval '1 day' and response_xml is not null;
 update public.brink_api_calls set status='error',error='Execution ended without a completion record',finished_at=now() where status='started' and started_at<now()-interval '5 minutes';
 delete from public.brink_api_calls where started_at < now()-interval '30 days';
 delete from cron.job_run_details where end_time < now()-interval '7 days' and jobid in (select jobid from cron.job where jobname in ('hub-brink-sales','hub-brink-log-retention'));
$job$);
