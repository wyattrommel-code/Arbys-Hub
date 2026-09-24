import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL("../supabase/migrations/20260924120000_cogs_mclane_invoices.sql", import.meta.url);
const safeUpdateMigrationUrl = new URL("../supabase/migrations/20260924143000_cogs_safeupdate_refresh.sql", import.meta.url);

function line(overrides = {}) {
  return {
    line_number: 1, sku: "100001", description: "Synthetic food case",
    ordered_quantity: 10, shipped_quantity: 10, uom: "CS", unit_price: 2,
    price_basis: "shipped_unit", price_uom: "CS", catch_weight: null,
    extended_amount: 20, account_code: "10000", category: "FOOD", is_food: true,
    raw_line_number: 10, ...overrides,
  };
}
function payload(number, delivery, lines, overrides = {}) {
  const food = lines.filter((row) => row.is_food).reduce((sum, row) => sum + row.extended_amount, 0);
  const subtotal = lines.reduce((sum, row) => sum + row.extended_amount, 0);
  return {
    customer_number: "292855", unit_number: "0007462", invoice_number: number,
    invoice_date: delivery, delivery_date: delivery,
    source_filename: `292855_0007462_${number}.PDF`,
    source_sha256: number.at(-1).repeat(64), parser_version: "synthetic-test-v1",
    subtotal, tax: 0, total: subtotal, food_total: food,
    non_food_total: subtotal - food, line_count: lines.length, ...overrides,
  };
}
async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.brink_sales_days (
      connection_id text not null, business_date date not null, environment text not null,
      synced_at timestamptz not null default now(), orders jsonb not null default '[]',
      summary jsonb not null, primary key(connection_id,business_date));
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.exec(await readFile(safeUpdateMigrationUrl, "utf8"));
  return db;
}
async function scalar(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0]?.value;
}
const isoDay = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : value;
async function importInvoice(db, invoice, lines) {
  return scalar(db, "select public.cogs_import_invoice($1::jsonb,$2::jsonb) as value", [JSON.stringify(invoice), JSON.stringify(lines)]);
}
async function importBatch(db, batch, replace = false) {
  return scalar(db, "select public.cogs_import_batch($1::jsonb,$2::boolean) as value", [JSON.stringify(batch), replace]);
}

// Synthetic values only: this suite never reads production PDFs, data, or credentials.
test("COGS import is fixed-customer, arithmetic-checked, replay-safe, and private", async (t) => {
  const db = await setup(t);
  const lines = [
    line(),
    line({ line_number: 2, sku: "FEE001", description: "Distribution fee", shipped_quantity: 1,
      unit_price: 5, extended_amount: 5, account_code: "20000", category: "DISTRIBUTION FEE", is_food: false, raw_line_number: 11 }),
    line({ line_number: 3, sku: "100001", description: "Signed food credit", shipped_quantity: -1,
      unit_price: -2, extended_amount: -2, raw_line_number: 12 }),
  ];
  const invoice = payload("10000001", "2026-09-01", lines);

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.exec("select * from public.cogs_invoices"), /permission denied/);
    await assert.rejects(importInvoice(db, invoice, lines), /permission denied/);
    await assert.rejects(db.exec("select public.cogs_refresh_derived()"), /permission denied/);
    await db.exec("reset role");
  }

  await db.exec("set role service_role");
  await assert.rejects(db.exec("delete from public.cogs_invoices"), /permission denied/);
  const inserted = await importInvoice(db, invoice, lines);
  assert.equal(inserted.status, "inserted");
  assert.equal((await importInvoice(db, invoice, lines)).status, "replayed");
  assert.equal(await scalar(db, "select count(*)::int as value from public.cogs_invoices"), 1);
  assert.equal(await scalar(db, "select count(*)::int as value from public.cogs_invoice_lines"), 3);
  assert.equal(Number(await scalar(db, "select food_total as value from public.cogs_invoices")), 18);
  assert.equal(Number(await scalar(db, "select non_food_total as value from public.cogs_invoices")), 5);
  // Fees and signed credits cannot become positive purchase-unit cost observations.
  assert.equal(await scalar(db, "select count(*)::int as value from public.cogs_item_cost"), 1);
  assert.equal(Number(await scalar(db, "select latest_unit_price as value from public.cogs_item_cost")), 2);
  assert.equal(await scalar(db, "select count(*)::int as value from public.cogs_item_cost where sku='FEE001'"), 0);

  await assert.rejects(importInvoice(db, { ...invoice, customer_number: "292760" }, lines), /Only McLane customer/);
  await assert.rejects(importInvoice(db, { ...invoice, subtotal: 24, total: 24 }, lines), /arithmetic/);
  await assert.rejects(importInvoice(db, { ...invoice, source_sha256: "f".repeat(64) }, lines), /different source/);
  const badFoodFlag = lines.map((row, i) => i ? row : { ...row, is_food: false });
  await assert.rejects(importInvoice(db, payload("10000009", "2026-09-01", badFoodFlag), badFoodFlag), /invalid or ambiguous/);
  await db.exec("reset role");
});

test("windows coalesce same-date deliveries, use Brink provenance, and expose partial coverage", async (t) => {
  const db = await setup(t);
  const firstLines = [line()];
  const sameDateLines = [line({ unit_price: 3, extended_amount: 30 })];
  const nextLines = [line({ shipped_quantity: 5, unit_price: 3, extended_amount: 15 })];
  await db.exec("set role service_role");
  await importInvoice(db, payload("10000001", "2026-09-01", firstLines), firstLines);
  await importInvoice(db, payload("10000002", "2026-09-01", sameDateLines), sameDateLines);
  await importInvoice(db, payload("10000003", "2026-09-08", nextLines), nextLines);
  await db.exec("reset role");

  assert.equal(await scalar(db, "select count(*)::int as value from public.cogs_windows"), 2);
  let window = (await db.query("select * from public.cogs_windows where start_date='2026-09-01'")).rows[0];
  assert.equal(isoDay(window.end_date), "2026-09-07");
  assert.equal(window.invoice_count, 2);
  assert.equal(Number(window.food_total), 50);
  assert.equal(window.is_complete, false);
  assert.equal(window.covered_sales_days, 0);
  assert.equal(window.net_sales, null); // Missing days are missing, never zero.
  const open = (await db.query("select * from public.cogs_windows where start_date='2026-09-08'")).rows[0];
  assert.equal(open.end_date, null);
  assert.equal(open.is_complete, false);

  await db.exec(`
    insert into public.brink_sales_days(connection_id,business_date,environment,summary) values
      ('prod','2026-09-01','production','{"net_sales":100,"closed_orders":10}'),
      ('prod','2026-09-02','production','{"net_sales":150,"closed_orders":15}'),
      ('sandbox','2026-09-03','sandbox','{"net_sales":9999,"closed_orders":999}');
  `);
  window = (await db.query("select * from public.cogs_windows where start_date='2026-09-01'")).rows[0];
  assert.equal(window.covered_sales_days, 2);
  assert.equal(window.expected_sales_days, 7);
  assert.equal(window.is_complete, false);
  assert.equal(Number(window.net_sales), 250);
  assert.equal(window.closed_orders, 25);
  assert.equal(window.guest_count, null);
  assert.equal(window.food_per_guest_proxy, null);
  assert.equal(Number(window.food_per_closed_order_proxy), 2);
  assert.equal(Number(window.food_percent_proxy), 20);
  assert.match(window.closed_orders_provenance, /not people or guest/);
  assert.match(window.warning, /Partial sales coverage/);

  await db.exec(`
    insert into public.brink_sales_days(connection_id,business_date,environment,summary)
    select 'prod', d::date, 'production', '{"net_sales":100,"closed_orders":10}'::jsonb
      from generate_series('2026-09-03'::date,'2026-09-07'::date,'1 day') d;
  `);
  window = (await db.query("select * from public.cogs_windows where start_date='2026-09-01'")).rows[0];
  assert.equal(window.covered_sales_days, 7);
  assert.equal(window.is_complete, true);
});

test("item costs choose deterministic latest and prior distinct FOOD purchase prices without yields", async (t) => {
  const db = await setup(t);
  await db.exec("set role service_role");
  for (const [number, date, price] of [["10000001", "2026-09-01", 2], ["10000002", "2026-09-02", 3], ["10000003", "2026-09-03", 3]]) {
    const lines = [line({ unit_price: price, extended_amount: price * 10 })];
    await importInvoice(db, payload(number, date, lines), lines);
  }
  const cost = (await db.query("select * from public.cogs_item_cost where sku='100001' and uom='CS'")).rows[0];
  assert.equal(Number(cost.latest_unit_price), 3);
  assert.equal(isoDay(cost.latest_delivery_date), "2026-09-03");
  assert.equal(cost.latest_invoice_number, "10000003");
  assert.equal(Number(cost.prior_unit_price), 2);
  assert.equal(isoDay(cost.prior_delivery_date), "2026-09-01");
  assert.equal(Number(cost.food_spend), 80);
  const columns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='cogs_item_cost' order by column_name")).rows.map((r) => r.column_name);
  assert.equal(columns.some((name) => /portion|serving|yield/.test(name)), false);
});

test("catch-weight rows retain per-pound basis and cannot merge into case history", async (t) => {
  const db = await setup(t);
  await db.exec("set role service_role");
  const cases = [line({ sku: "232409", shipped_quantity: 2, unit_price: 30, extended_amount: 60 })];
  const weighted = [line({ sku: "232409", shipped_quantity: 2, unit_price: 3.25, price_basis: "catch_weight", price_uom: "LB", catch_weight: 20, extended_amount: 65 })];
  await importInvoice(db, payload("10000001", "2026-09-01", cases), cases);
  await importInvoice(db, payload("10000002", "2026-09-02", weighted), weighted);
  const costs = (await db.query("select * from public.cogs_item_cost where sku='232409' order by price_basis")).rows;
  assert.equal(costs.length, 2);
  assert.deepEqual(costs.map((r) => [r.price_basis, r.price_uom, Number(r.latest_unit_price)]), [
    ["catch_weight", "LB", 3.25], ["shipped_unit", "CS", 30],
  ]);
  const stored = (await db.query("select price_basis,price_uom,catch_weight from public.cogs_invoice_lines where price_basis='catch_weight'")).rows[0];
  assert.equal(stored.price_uom, "LB");
  assert.equal(Number(stored.catch_weight), 20);
});

test("batch import is atomic and parser upgrades require controlled same-SHA replacement", async (t) => {
  const db = await setup(t);
  await db.exec("set role service_role");
  const goodLines = [line()];
  const good = payload("10000001", "2026-09-01", goodLines);
  const bad = payload("10000002", "2026-09-02", goodLines, { subtotal: 999, total: 999 });
  await assert.rejects(importBatch(db, [{ invoice: good, lines: goodLines }, { invoice: bad, lines: goodLines }]), /arithmetic/);
  assert.equal(await scalar(db, "select count(*)::int as value from public.cogs_invoices"), 0);
  assert.equal((await importBatch(db, [{ invoice: good, lines: goodLines }])).results[0].status, "inserted");
  assert.equal((await importBatch(db, [{ invoice: good, lines: goodLines }])).results[0].status, "replayed");
  const upgradedLines = [line({ description: "Reparsed authoritative row" })];
  const upgraded = { ...good, parser_version: "synthetic-test-v2" };
  await assert.rejects(importBatch(db, [{ invoice: upgraded, lines: upgradedLines }]), /explicit parser-version replacement/);
  assert.equal((await importBatch(db, [{ invoice: upgraded, lines: upgradedLines }], true)).results[0].status, "replaced");
  assert.equal(await scalar(db, "select description as value from public.cogs_invoice_lines"), "Reparsed authoritative row");
  assert.equal(await scalar(db, "select count(*)::int as value from public.cogs_invoice_lines"), 1);
  await assert.rejects(importBatch(db, [{ invoice: { ...upgraded, source_sha256: "f".repeat(64) }, lines: upgradedLines }], true), /different source/);
});

test("mapping schema stores verification and rejects implicit weight conversion", async (t) => {
  const db = await setup(t);
  const columns = (await db.query("select column_name from information_schema.columns where table_name='cogs_item_mappings'")).rows.map((r) => r.column_name);
  for (const required of ["supplier_sku", "price_basis", "price_uom", "cost_multiplier", "verification_source", "mapping_version"]) assert.ok(columns.includes(required));
  await assert.rejects(db.exec(`insert into cogs_item_mappings(target_type,target_item_id,supplier_sku,supplier_uom,price_basis,price_uom,target_uom,verification_source)
    values ('inventory','item-1','232409','CS','catch_weight','LB','CS','packing slip')`), /cogs_mapping_conversion/);
  await db.exec(`insert into cogs_item_mappings(target_type,target_item_id,supplier_sku,supplier_uom,price_basis,price_uom,target_uom,cost_multiplier,is_verified,verification_source,verified_by,verified_at)
    values ('inventory','item-1','232409','CS','catch_weight','LB','CS',20,true,'packing slip','manager',now())`);
  assert.equal(await scalar(db, "select count(*)::int as value from cogs_item_mappings where is_verified"), 1);
});
