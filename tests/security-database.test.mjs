import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

// Synthetic fixtures only. No production credentials, employee details or network.
test("security cutover preserves records and enforces database access", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema extensions; create extension pgcrypto with schema extensions;
    grant usage on schema public, extensions to service_role, anon, authenticated;
    create table public.employees (
      id uuid primary key default gen_random_uuid(), store_id text not null,
      first_name text, last_name text, employee_code text not null,
      is_active boolean default true, status text default 'active', unique(store_id, employee_code));
    create table public.employee_wages (id int primary key, hourly_rate numeric);
    create function public.set_updated_at() returns trigger language plpgsql as $$begin return new; end;$$;
    insert into public.employees (id,store_id,first_name,last_name,employee_code) values
      ('11111111-1111-4111-8111-111111111111','07462','Synthetic','Crew','1234'),
      ('22222222-2222-4222-8222-222222222222','07462','Synthetic','Manager','5678');
    insert into public.employee_wages values (1,15);
    alter table public.employees enable row level security;
    create policy "allow all" on public.employees using (true) with check (true);
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant select (employee_code) on public.employees to anon;
    create schema storage;
    create table storage.buckets (id text primary key, public boolean);
    create table storage.objects (id int, bucket_id text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on storage.objects to anon, authenticated, service_role;
    create policy accidentally_public on storage.objects using (true) with check (true);
    insert into storage.buckets values ('profile-photos',true),('punch-photos',true),('checklist-photos',true);
    insert into storage.objects values (1,'profile-photos'),(2,'punch-photos'),(3,'checklist-photos');
  `);
  const migration = await readFile(new URL("../supabase/migrations/20260908210505_secure_hub_data_access.sql", import.meta.url), "utf8");
  await db.exec(migration);
  const value = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
  assert.equal(await value("select count(*)::int as value from public.employees"), 2);
  assert.equal(await value("select count(*)::int as value from public.employee_wages"), 1);
  assert.equal(await value("select count(*)::int as value from public.employees where employee_code in ('1234','5678')"), 0);
  assert.equal(await value("select count(*)::int as value from storage.buckets where public"), 0);

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const sql of ["select * from public.employees", "select * from public.employee_wages", "delete from public.employees", "update public.employee_wages set hourly_rate=999", "insert into public.employee_wages values (9,999)", "select public.hub_employee_by_pin('1234','07462')", "select public.hub_consume_pin_attempt(repeat('a',64))"]) {
      await assert.rejects(db.exec(sql), /permission denied/);
    }
    assert.equal(await value("select count(*)::int as value from storage.objects"), 0);
    await assert.rejects(db.exec("insert into storage.objects values (4,'profile-photos')"), /row-level security/);
    await db.exec("reset role");
  }

  await db.exec("set role service_role");
  assert.equal(await value("select public.hub_employee_by_pin('1234','07462') as value"), "11111111-1111-4111-8111-111111111111");
  assert.equal(await value("select public.hub_employee_by_pin('0000','07462') as value"), null);
  assert.equal(await value("select public.hub_employee_by_pin('1234','other') as value"), null);
  await assert.rejects(db.exec("insert into public.employees(store_id,employee_code) values ('07462','1234')"), /already in use/);
  await db.exec("update public.employees set employee_code='9012' where first_name='Synthetic' and last_name='Crew'");
  assert.equal(await value("select public.hub_employee_by_pin('1234','07462') as value"), null);
  assert.equal(await value("select public.hub_employee_by_pin('9012','07462') as value"), "11111111-1111-4111-8111-111111111111");
  await db.exec("update public.employees set is_active=false where last_name='Crew'");
  assert.equal(await value("select public.hub_employee_by_pin('9012','07462') as value"), null);
  assert.equal(await value("select count(*)::int as value from storage.objects"), 3);

  // Limits are persisted in Postgres, not a per-process JavaScript map.
  for (let i = 0; i < 60; i++) assert.equal(await value("select public.hub_consume_pin_attempt(repeat('a',64)) as value"), true);
  assert.equal(await value("select public.hub_consume_pin_attempt(repeat('a',64)) as value"), false);
  assert.equal(await value("select public.hub_consume_pin_attempt(repeat('b',64)) as value"), true);
  await db.exec("reset role");
  assert.equal(await value("select count(*)::int as value from pg_policies where schemaname='public'"), 0);
  await db.exec("create function public.future_rpc() returns int language sql as 'select 1'; create table public.future_table(id int)");
  await db.exec("set role anon");
  await assert.rejects(db.exec("select public.future_rpc()"), /permission denied/);
  await assert.rejects(db.exec("select * from public.future_table"), /permission denied/);
  await db.exec("reset role");
});

test("timecard approval audit is private and append-only", async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table employees(id uuid primary key); create table time_punches(id uuid primary key);
    insert into employees values ('11111111-1111-4111-8111-111111111111');
    insert into time_punches values ('22222222-2222-4222-8222-222222222222');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260909161106_timecard_manager_approvals.sql', import.meta.url), 'utf8'));
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.exec('select * from timecard_approvals'), /permission denied/);
    await assert.rejects(db.exec('delete from timecard_approvals'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec(`set role service_role;
    insert into timecard_approvals(punch_id,snapshot_hash,approved_by,approved_by_name,note,review_flags,reviewed_snapshot)
    values ('22222222-2222-4222-8222-222222222222',repeat('a',64),'11111111-1111-4111-8111-111111111111','Synthetic Manager','Reviewed','[]','{}');`);
  assert.equal((await db.query('select count(*)::int as n from timecard_approvals')).rows[0].n, 1);
  await assert.rejects(db.exec("update timecard_approvals set note='rewritten'"), /permission denied/);
  await assert.rejects(db.exec('delete from timecard_approvals'), /permission denied/);
});
