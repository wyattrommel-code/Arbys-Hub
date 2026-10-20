-- The kiosk already knows the selected employee. Verify just that employee's
-- salted hash instead of performing expensive bcrypt checks across the roster.
create or replace function public.hub_verify_employee_pin(p_pin text, p_store_id text, p_employee_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare pin_hash text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or p_store_id is distinct from '07462' or p_employee_id is null then
    return false;
  end if;
  select e.employee_code into pin_hash from public.employees e
    where e.id = p_employee_id and e.store_id = p_store_id and e.is_active
      and coalesce(e.status, 'active') not in ('inactive', 'terminated');
  if pin_hash is null then return false; end if;
  return pin_hash = extensions.crypt(p_pin, pin_hash);
end;
$$;
revoke all on function public.hub_verify_employee_pin(text, text, uuid) from public, anon, authenticated;
grant execute on function public.hub_verify_employee_pin(text, text, uuid) to service_role;
