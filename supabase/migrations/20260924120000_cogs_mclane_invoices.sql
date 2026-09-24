-- Versioned, server-only McLane purchase-cost ledger for customer 292855 / unit 0007462.
-- cogs_* data is deliberately not exposed to anon or authenticated PostgREST clients.

create table public.cogs_invoices (
  id bigint generated always as identity primary key,
  customer_number text not null check (customer_number = '292855'),
  unit_number text not null check (unit_number = '0007462'),
  invoice_number text not null check (invoice_number ~ '^[0-9]{8}$'),
  invoice_date date not null,
  delivery_date date not null,
  source_filename text not null check (source_filename ~ '^292855_0007462_[0-9]{8}[.]PDF$'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text not null check (length(parser_version) between 1 and 100),
  subtotal numeric(14,2) not null,
  tax numeric(14,2) not null,
  total numeric(14,2) not null,
  food_total numeric(14,2) not null,
  non_food_total numeric(14,2) not null,
  line_count integer not null check (line_count > 0),
  imported_at timestamptz not null default now(),
  constraint cogs_invoice_number_unique unique (customer_number, unit_number, invoice_number),
  constraint cogs_invoice_source_unique unique (source_sha256),
  constraint cogs_invoice_filename_matches check (source_filename = customer_number || '_' || unit_number || '_' || invoice_number || '.PDF'),
  constraint cogs_invoice_subtotals_match check (abs((food_total + non_food_total) - subtotal) <= 0.02),
  constraint cogs_invoice_total_matches check (abs((subtotal + tax) - total) <= 0.02)
);

create table public.cogs_invoice_lines (
  invoice_id bigint not null references public.cogs_invoices(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  sku text not null check (length(sku) between 1 and 40),
  description text not null check (length(description) between 1 and 500),
  ordered_quantity numeric(14,4),
  shipped_quantity numeric(14,4) not null,
  uom text not null check (uom ~ '^[A-Z0-9]{1,12}$'),
  unit_price numeric(14,4),
  price_basis text not null check (price_basis in ('shipped_unit','catch_weight')),
  price_uom text not null check (price_uom ~ '^[A-Z0-9]{1,12}$'),
  catch_weight numeric(14,4),
  extended_amount numeric(14,2) not null,
  account_code text not null check (account_code ~ '^[0-9]{5}$'),
  category text not null check (length(category) between 1 and 100),
  is_food boolean not null,
  raw_line_number integer not null check (raw_line_number > 0),
  primary key (invoice_id, line_number),
  constraint cogs_line_food_category_matches check (is_food = (category = 'FOOD')),
  constraint cogs_line_price_basis_shape check (
    (price_basis = 'shipped_unit' and price_uom = uom and catch_weight is null)
    or (price_basis = 'catch_weight' and price_uom = 'LB' and catch_weight > 0)
  )
);

-- One row per purchase unit. Costs are observations, not recipe/portion costs.
create table public.cogs_item_cost (
  sku text not null,
  uom text not null,
  price_basis text not null check (price_basis in ('shipped_unit','catch_weight')),
  price_uom text not null,
  description text not null,
  latest_unit_price numeric(14,4) not null check (latest_unit_price > 0),
  latest_delivery_date date not null,
  latest_invoice_number text not null,
  prior_unit_price numeric(14,4),
  prior_delivery_date date,
  prior_invoice_number text,
  food_spend numeric(14,2) not null,
  purchase_observation_count integer not null check (purchase_observation_count > 0),
  refreshed_at timestamptz not null default now(),
  primary key (sku, uom, price_basis, price_uom),
  constraint cogs_prior_cost_complete check (
    (prior_unit_price is null and prior_delivery_date is null and prior_invoice_number is null)
    or (prior_unit_price > 0 and prior_delivery_date is not null and prior_invoice_number is not null)
  ),
  constraint cogs_prior_cost_distinct check (prior_unit_price is null or prior_unit_price <> latest_unit_price)
);

-- Empty by design: mappings are human-verified configuration, never fuzzy guesses.
-- cost_multiplier converts one observed price unit to one target unit.
create table public.cogs_item_mappings (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('inventory','waste')),
  target_item_id text not null,
  supplier_sku text not null,
  supplier_uom text not null,
  price_basis text not null check (price_basis in ('shipped_unit','catch_weight')),
  price_uom text not null,
  target_uom text not null,
  cost_multiplier numeric(14,6) check (cost_multiplier > 0),
  is_verified boolean not null default false,
  verification_source text not null,
  verified_by text,
  verified_at timestamptz,
  mapping_version integer not null default 1 check (mapping_version > 0),
  created_at timestamptz not null default now(),
  constraint cogs_mapping_unique unique(target_type,target_item_id),
  constraint cogs_mapping_verification check (not is_verified or (verified_by is not null and verified_at is not null)),
  constraint cogs_mapping_conversion check (
    cost_multiplier is not null or (price_basis='shipped_unit' and price_uom=target_uom)
  )
);

create table public.cogs_windows (
  start_date date primary key,
  end_date date,
  invoice_count integer not null check (invoice_count > 0),
  food_total numeric(14,2) not null,
  non_food_total numeric(14,2) not null,
  expected_sales_days integer,
  covered_sales_days integer not null check (covered_sales_days >= 0),
  coverage_start date,
  coverage_end date,
  net_sales numeric(14,2),
  closed_orders integer,
  -- Brink currently supplies closed order count, not a people/guest headcount.
  guest_count integer,
  food_percent_proxy numeric(14,4),
  food_per_guest_proxy numeric(14,4),
  food_per_closed_order_proxy numeric(14,4),
  sales_source text not null default 'brink_sales_days.summary',
  closed_orders_provenance text not null default 'Brink closed orders; not people or guest headcount',
  is_complete boolean not null,
  warning text not null,
  refreshed_at timestamptz not null default now(),
  constraint cogs_window_dates check (end_date is null or end_date >= start_date),
  constraint cogs_window_guest_not_invented check (guest_count is null and food_per_guest_proxy is null),
  constraint cogs_window_coverage_shape check (
    (covered_sales_days = 0 and coverage_start is null and coverage_end is null and net_sales is null and closed_orders is null)
    or (covered_sales_days > 0 and coverage_start is not null and coverage_end is not null and net_sales is not null and closed_orders is not null)
  ),
  constraint cogs_window_complete_coverage check (
    not is_complete or (end_date is not null and expected_sales_days = covered_sales_days)
  )
);

create index cogs_invoices_delivery_date_idx on public.cogs_invoices(delivery_date, invoice_number);
create index cogs_invoice_lines_food_sku_idx on public.cogs_invoice_lines(sku, uom) where is_food;
create index cogs_invoice_lines_invoice_category_idx on public.cogs_invoice_lines(invoice_id, category);

alter table public.cogs_invoices enable row level security;
alter table public.cogs_invoice_lines enable row level security;
alter table public.cogs_item_cost enable row level security;
alter table public.cogs_windows enable row level security;
alter table public.cogs_item_mappings enable row level security;
revoke all on public.cogs_invoices, public.cogs_invoice_lines, public.cogs_item_cost, public.cogs_windows, public.cogs_item_mappings from public, anon, authenticated;
revoke all on sequence public.cogs_invoices_id_seq, public.cogs_item_mappings_id_seq from public, anon, authenticated;
grant select on public.cogs_invoices, public.cogs_invoice_lines, public.cogs_item_cost, public.cogs_windows, public.cogs_item_mappings to service_role;

create function public.cogs_refresh_derived()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.cogs_item_cost where true;
  insert into public.cogs_item_cost (
    sku, uom, price_basis, price_uom, description, latest_unit_price, latest_delivery_date, latest_invoice_number,
    prior_unit_price, prior_delivery_date, prior_invoice_number, food_spend, purchase_observation_count
  )
  with purchase_rows as (
    select l.sku, l.uom, l.price_basis, l.price_uom, l.description, l.unit_price, i.delivery_date, i.invoice_number,
           l.line_number, l.extended_amount
      from public.cogs_invoice_lines l
      join public.cogs_invoices i on i.id = l.invoice_id
     where l.is_food and l.unit_price > 0 and l.shipped_quantity > 0 and l.extended_amount > 0
  ), distinct_costs as (
    select distinct on (sku, uom, price_basis, price_uom, unit_price)
           sku, uom, price_basis, price_uom, unit_price, description, delivery_date, invoice_number, line_number
      from purchase_rows
     order by sku, uom, price_basis, price_uom, unit_price, delivery_date desc, invoice_number desc, line_number desc
  ), ranked as (
    select *, row_number() over (
      partition by sku, uom, price_basis, price_uom
      order by delivery_date desc, invoice_number desc, line_number desc, unit_price desc
    ) as cost_rank
    from distinct_costs
  ), spend as (
    select l.sku, l.uom, l.price_basis, l.price_uom, sum(l.extended_amount)::numeric(14,2) as food_spend,
           count(*) filter (where l.unit_price > 0 and l.shipped_quantity > 0 and l.extended_amount > 0)::integer as observations
      from public.cogs_invoice_lines l
     where l.is_food
     group by l.sku, l.uom, l.price_basis, l.price_uom
  )
  select r.sku, r.uom, r.price_basis, r.price_uom,
         max(r.description) filter (where r.cost_rank = 1),
         max(r.unit_price) filter (where r.cost_rank = 1),
         max(r.delivery_date) filter (where r.cost_rank = 1),
         max(r.invoice_number) filter (where r.cost_rank = 1),
         max(r.unit_price) filter (where r.cost_rank = 2),
         max(r.delivery_date) filter (where r.cost_rank = 2),
         max(r.invoice_number) filter (where r.cost_rank = 2),
         s.food_spend, s.observations
    from ranked r
    join spend s using (sku, uom, price_basis, price_uom)
   where r.cost_rank <= 2
   group by r.sku, r.uom, r.price_basis, r.price_uom, s.food_spend, s.observations;

  delete from public.cogs_windows where true;
  insert into public.cogs_windows (
    start_date, end_date, invoice_count, food_total, non_food_total,
    expected_sales_days, covered_sales_days, coverage_start, coverage_end,
    net_sales, closed_orders, guest_count, food_percent_proxy,
    food_per_guest_proxy, food_per_closed_order_proxy, is_complete, warning
  )
  with delivery_groups as (
    select delivery_date as start_date,
           (lead(delivery_date) over (order by delivery_date) - 1)::date as end_date,
           count(*)::integer as invoice_count,
           sum(food_total)::numeric(14,2) as food_total,
           sum(non_food_total)::numeric(14,2) as non_food_total
      from public.cogs_invoices
     group by delivery_date
  ), authoritative_sales as (
    select distinct on (business_date)
           business_date,
           (summary->>'net_sales')::numeric as net_sales,
           (summary->>'closed_orders')::integer as closed_orders
      from public.brink_sales_days
     where environment = 'production'
       and coalesce(summary->>'net_sales', '') ~ '^-?[0-9]+([.][0-9]+)?$'
       and coalesce(summary->>'closed_orders', '') ~ '^[0-9]+$'
     order by business_date, synced_at desc, connection_id
  ), joined as (
    select d.*,
           case when d.end_date is null then null else (d.end_date - d.start_date + 1)::integer end as expected_days,
           count(s.business_date)::integer as covered_days,
           min(s.business_date) as first_day,
           max(s.business_date) as last_day,
           case when count(s.business_date) = 0 then null else sum(s.net_sales)::numeric(14,2) end as period_sales,
           case when count(s.business_date) = 0 then null else sum(s.closed_orders)::integer end as period_orders
      from delivery_groups d
      left join authoritative_sales s
        on s.business_date >= d.start_date
       and (d.end_date is null or s.business_date <= d.end_date)
     group by d.start_date, d.end_date, d.invoice_count, d.food_total, d.non_food_total
  )
  select start_date, end_date, invoice_count, food_total, non_food_total,
         expected_days, covered_days, first_day, last_day, period_sales, period_orders,
         null::integer,
         case when period_sales > 0 then round(food_total / period_sales * 100, 4) end,
         null::numeric,
         case when period_orders > 0 then round(food_total / period_orders, 4) end,
         (end_date is not null and expected_days = covered_days),
         case
           when end_date is null then 'Open window: no subsequent delivery yet.'
           when expected_days <> covered_days then 'Partial sales coverage; proxy uses covered Brink days only.'
           else 'Closed window with complete Brink sales coverage.'
         end
    from joined;
end;
$$;

-- Brink snapshots can arrive after an invoice. Keep coverage/proxies current without
-- asking a browser or importer to rewrite derived rows.
create function public.cogs_refresh_after_brink_sales()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.cogs_refresh_derived();
  return null;
end;
$$;
create trigger cogs_refresh_after_brink_sales
  after insert or update or delete on public.brink_sales_days
  for each statement execute function public.cogs_refresh_after_brink_sales();

create function public.cogs_import_invoice(p_invoice jsonb, p_lines jsonb, p_allow_parser_replace boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_existing record;
  v_line_count integer;
  v_distinct_line_count integer;
  v_line_total numeric;
  v_food_total numeric;
  v_status text := 'inserted';
begin
  if jsonb_typeof(p_invoice) <> 'object' or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Invoice must be an object and lines must be an array';
  end if;
  if p_invoice->>'customer_number' <> '292855' or p_invoice->>'unit_number' <> '0007462' then
    raise exception 'Only McLane customer 292855 / unit 0007462 may be imported';
  end if;
  if coalesce(p_invoice->>'invoice_number','') !~ '^[0-9]{8}$'
     or p_invoice->>'source_filename' <> '292855_0007462_' || (p_invoice->>'invoice_number') || '.PDF'
     or coalesce(p_invoice->>'source_sha256','') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invoice identity, filename, or SHA-256 is invalid';
  end if;
  if coalesce(p_invoice->>'invoice_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or coalesce(p_invoice->>'delivery_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or coalesce(p_invoice->>'parser_version','') = '' then
    raise exception 'Invoice dates or parser version are invalid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
     where jsonb_typeof(l) <> 'object'
        or coalesce(l->>'line_number','') !~ '^[1-9][0-9]*$'
        or coalesce(l->>'raw_line_number','') !~ '^[1-9][0-9]*$'
        or coalesce(l->>'sku','') = '' or coalesce(l->>'description','') = ''
        or coalesce(l->>'uom','') !~ '^[A-Z0-9]{1,12}$'
        or coalesce(l->>'price_basis','') not in ('shipped_unit','catch_weight')
        or coalesce(l->>'price_uom','') !~ '^[A-Z0-9]{1,12}$'
        or (l->>'price_basis' = 'shipped_unit' and (l->>'price_uom' <> l->>'uom' or (l ? 'catch_weight' and l->'catch_weight' <> 'null'::jsonb)))
        or (l->>'price_basis' = 'catch_weight' and (l->>'price_uom' <> 'LB' or coalesce(l->>'catch_weight','') !~ '^[0-9]+([.][0-9]+)?$' or (l->>'catch_weight')::numeric <= 0))
        or coalesce(l->>'account_code','') !~ '^[0-9]{5}$'
        or coalesce(l->>'category','') = ''
        or jsonb_typeof(l->'is_food') <> 'boolean'
        or (l->>'is_food')::boolean <> (l->>'category' = 'FOOD')
        or coalesce(l->>'shipped_quantity','') !~ '^-?[0-9]+([.][0-9]+)?$'
        or coalesce(l->>'extended_amount','') !~ '^-?[0-9]+([.][0-9]+)?$'
        or (l ? 'unit_price' and l->'unit_price' <> 'null'::jsonb and coalesce(l->>'unit_price','') !~ '^-?[0-9]+([.][0-9]+)?$')
        or (l ? 'ordered_quantity' and l->'ordered_quantity' <> 'null'::jsonb and coalesce(l->>'ordered_quantity','') !~ '^-?[0-9]+([.][0-9]+)?$')
  ) then raise exception 'One or more invoice lines are invalid or ambiguous'; end if;

  select count(*)::integer, count(distinct (l->>'line_number')::integer)::integer,
         coalesce(sum((l->>'extended_amount')::numeric),0),
         coalesce(sum((l->>'extended_amount')::numeric) filter (where (l->>'is_food')::boolean),0)
    into v_line_count, v_distinct_line_count, v_line_total, v_food_total
    from jsonb_array_elements(p_lines) l;
  if v_line_count = 0 or v_line_count <> v_distinct_line_count then
    raise exception 'Lines must have unique line numbers';
  end if;
  if coalesce(p_invoice->>'line_count','') !~ '^[1-9][0-9]*$'
     or coalesce(p_invoice->>'subtotal','') !~ '^-?[0-9]+([.][0-9]+)?$'
     or coalesce(p_invoice->>'tax','') !~ '^-?[0-9]+([.][0-9]+)?$'
     or coalesce(p_invoice->>'total','') !~ '^-?[0-9]+([.][0-9]+)?$'
     or coalesce(p_invoice->>'food_total','') !~ '^-?[0-9]+([.][0-9]+)?$'
     or coalesce(p_invoice->>'non_food_total','') !~ '^-?[0-9]+([.][0-9]+)?$'
     or (p_invoice->>'line_count')::integer <> v_line_count
     or abs(v_line_total - (p_invoice->>'subtotal')::numeric) > 0.02
     or abs(v_food_total - (p_invoice->>'food_total')::numeric) > 0.02
     or abs((v_line_total-v_food_total) - (p_invoice->>'non_food_total')::numeric) > 0.02
     or abs(((p_invoice->>'subtotal')::numeric + (p_invoice->>'tax')::numeric) - (p_invoice->>'total')::numeric) > 0.02 then
    raise exception 'Invoice line arithmetic or declared totals do not match';
  end if;

  select id, source_sha256, parser_version into v_existing
    from public.cogs_invoices
   where customer_number = '292855' and unit_number = '0007462'
     and invoice_number = p_invoice->>'invoice_number';
  if found then
    if v_existing.source_sha256 <> p_invoice->>'source_sha256' then
      raise exception 'Invoice number was already imported from a different source';
    end if;
    if v_existing.parser_version = p_invoice->>'parser_version' then
      return jsonb_build_object('invoice_id', v_existing.id, 'status', 'replayed', 'line_count', v_line_count);
    end if;
    if not p_allow_parser_replace then
      raise exception 'Same source requires explicit parser-version replacement';
    end if;
    v_id := v_existing.id;
    v_status := 'replaced';
    delete from public.cogs_invoice_lines where invoice_id = v_id;
    update public.cogs_invoices set
      invoice_date=(p_invoice->>'invoice_date')::date, delivery_date=(p_invoice->>'delivery_date')::date,
      parser_version=p_invoice->>'parser_version', subtotal=(p_invoice->>'subtotal')::numeric,
      tax=(p_invoice->>'tax')::numeric, total=(p_invoice->>'total')::numeric,
      food_total=(p_invoice->>'food_total')::numeric, non_food_total=(p_invoice->>'non_food_total')::numeric,
      line_count=v_line_count, imported_at=now()
      where id=v_id;
  else
    if exists (select 1 from public.cogs_invoices where source_sha256 = p_invoice->>'source_sha256') then
      raise exception 'Source SHA-256 was already imported as another invoice';
    end if;

    insert into public.cogs_invoices (
      customer_number, unit_number, invoice_number, invoice_date, delivery_date,
      source_filename, source_sha256, parser_version, subtotal, tax, total,
      food_total, non_food_total, line_count
    ) values (
      p_invoice->>'customer_number', p_invoice->>'unit_number', p_invoice->>'invoice_number',
      (p_invoice->>'invoice_date')::date, (p_invoice->>'delivery_date')::date,
      p_invoice->>'source_filename', p_invoice->>'source_sha256', p_invoice->>'parser_version',
      (p_invoice->>'subtotal')::numeric, (p_invoice->>'tax')::numeric, (p_invoice->>'total')::numeric,
      (p_invoice->>'food_total')::numeric, (p_invoice->>'non_food_total')::numeric, v_line_count
    ) returning id into v_id;
  end if;

  insert into public.cogs_invoice_lines (
    invoice_id, line_number, sku, description, ordered_quantity, shipped_quantity,
    uom, unit_price, price_basis, price_uom, catch_weight, extended_amount, account_code, category, is_food, raw_line_number
  )
  select v_id, (l->>'line_number')::integer, l->>'sku', l->>'description',
         nullif(l->>'ordered_quantity','')::numeric, (l->>'shipped_quantity')::numeric,
         l->>'uom', nullif(l->>'unit_price','')::numeric, l->>'price_basis', l->>'price_uom',
         nullif(l->>'catch_weight','')::numeric, (l->>'extended_amount')::numeric,
         l->>'account_code', l->>'category', (l->>'is_food')::boolean,
         (l->>'raw_line_number')::integer
    from jsonb_array_elements(p_lines) l;

  perform public.cogs_refresh_derived();
  return jsonb_build_object('invoice_id', v_id, 'status', v_status, 'line_count', v_line_count);
exception
  when unique_violation then
    raise exception 'Invoice replay conflicted with an existing invoice or source';
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'Invoice contains an invalid number or date';
end;
$$;

-- One RPC and one PostgreSQL transaction for the complete validated batch. Any
-- exception rolls back every invoice, replacement, line, and derived refresh.
create function public.cogs_import_batch(p_batch jsonb, p_allow_parser_replace boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_batch) <> 'array' or jsonb_array_length(p_batch) = 0 then
    raise exception 'Batch must be a non-empty array';
  end if;
  for v_item in select value from jsonb_array_elements(p_batch)
  loop
    if jsonb_typeof(v_item->'invoice') <> 'object' or jsonb_typeof(v_item->'lines') <> 'array' then
      raise exception 'Every batch item requires invoice and lines';
    end if;
    v_result := public.cogs_import_invoice(v_item->'invoice', v_item->'lines', p_allow_parser_replace);
    v_results := v_results || jsonb_build_array(v_result || jsonb_build_object(
      'invoice_number', v_item->'invoice'->>'invoice_number',
      'sha256', v_item->'invoice'->>'source_sha256'));
  end loop;
  return jsonb_build_object('status','committed','results',v_results);
end;
$$;

revoke all on function public.cogs_refresh_derived(), public.cogs_refresh_after_brink_sales(), public.cogs_import_invoice(jsonb,jsonb,boolean), public.cogs_import_batch(jsonb,boolean) from public, anon, authenticated;
grant execute on function public.cogs_refresh_derived(), public.cogs_import_invoice(jsonb,jsonb,boolean), public.cogs_import_batch(jsonb,boolean) to service_role;
