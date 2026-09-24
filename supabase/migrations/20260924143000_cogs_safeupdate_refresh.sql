-- Production compatibility: Supabase safeupdate rejects unqualified DELETEs.
-- Replace the already-deployed refresh function without duplicating its full body.
do $$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef('public.cogs_refresh_derived()'::regprocedure);
  function_definition := replace(
    function_definition,
    'delete from public.cogs_item_cost;',
    'delete from public.cogs_item_cost where true;'
  );
  function_definition := replace(
    function_definition,
    'delete from public.cogs_windows;',
    'delete from public.cogs_windows where true;'
  );
  if function_definition not like '%delete from public.cogs_item_cost where true;%'
     or function_definition not like '%delete from public.cogs_windows where true;%' then
    raise exception 'Could not qualify COGS refresh deletes';
  end if;
  execute function_definition;
end;
$$;
