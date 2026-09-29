import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { clockRouteAllowed, clockCookies } from '../lib/clock-gateway-policy.js';

test('clock gateway exposes only punch operations and scoped profile photos', () => {
  for (const path of ['/api/clock/roster','/api/clock/status','/api/photos/profile-photos/payson/employee/photo.jpg']) assert.equal(clockRouteAllowed(path, 'GET'), true);
  for (const path of ['/api/clock/in','/api/clock/out','/api/clock/unlock','/api/clock/device/pair','/api/clock/break/start','/api/clock/break/end','/api/clock/identify']) assert.equal(clockRouteAllowed(path, 'POST'), true);
  for (const path of ['/api/data/employees','/api/auth/login','/api/settings/clock-station','/api/photos/punch-photos/payson/a.jpg','/api/photos/profile-photos/other/a.jpg','/api/photos/profile-photos/payson/../secret','/api/photos/profile-photos/payson/%2e%2e/a','/api/clock/roster/extra']) {
    assert.equal(clockRouteAllowed(path,'GET'), false, path); assert.equal(clockRouteAllowed(path,'POST'), false, path);
  }
  assert.equal(clockRouteAllowed('/api/clock/in','GET'), false);
  assert.equal(clockCookies('hub_session=private; hub_kiosk=shift; hub_clock_device=device; other=secret'), 'hub_kiosk=shift; hub_clock_device=device');
});

test('station enrollment is private, single-use, expiring, replaceable, revocable, and audited', async t => {
  const db = new PGlite(); t.after(() => db.close());
  const gm = '11111111-1111-4111-8111-111111111111';
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    create table public.employees(id uuid primary key); insert into public.employees values ('${gm}');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260928201406_registered_clock_station.sql', import.meta.url),'utf8'));
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    for (const sql of ['select * from clock_kiosk_stations','select * from clock_kiosk_events',"select hub_pair_clock_station('07462',repeat('a',64),repeat('b',64),null)","delete from clock_kiosk_stations"]) await assert.rejects(db.exec(sql),/permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  const issue = async (hash, expiry = "now() + interval '10 minutes'") => db.query(`insert into clock_kiosk_stations(store_id,pairing_hash,pairing_expires_at,pairing_by,changed_by) values ('07462',$1,${expiry},$2,$2) on conflict(store_id) do update set pairing_hash=excluded.pairing_hash,pairing_expires_at=excluded.pairing_expires_at,pairing_by=excluded.pairing_by,changed_by=excluded.changed_by`, [hash,gm]);
  const pair = async (hash, device = 'b'.repeat(64), issuer = gm) => (await db.query('select hub_pair_clock_station($1,$2,$3,$4) as ok',['07462',hash,device,issuer])).rows[0].ok;
  const row = async () => (await db.query('select * from clock_kiosk_stations')).rows[0];
  await issue('a'.repeat(64));
  assert.equal(await pair('z'.repeat(64)), false);
  assert.equal(await pair('a'.repeat(64),'b'.repeat(64),'22222222-2222-4222-8222-222222222222'), false);
  assert.deepEqual(await Promise.all([pair('a'.repeat(64)),pair('a'.repeat(64))]),[true,false]);
  assert.equal((await row()).device_hash,'b'.repeat(64));
  assert.equal((await row()).pairing_hash,null);
  await issue('c'.repeat(64),"now() - interval '1 second'");
  assert.equal(await pair('c'.repeat(64)),false);
  assert.equal((await row()).device_hash,'b'.repeat(64));
  await issue('d'.repeat(64));
  assert.equal(await pair('c'.repeat(64)),false);
  assert.equal(await pair('d'.repeat(64),'e'.repeat(64)),true);
  assert.equal((await row()).device_hash,'e'.repeat(64));
  await issue('f'.repeat(64));
  await db.exec("update clock_kiosk_stations set device_hash=null,device_expires_at=null,paired_at=null,pairing_hash=null,pairing_expires_at=null,pairing_by=null,revoked_at=now()");
  assert.equal((await row()).device_hash,null);
  assert.equal(await pair('f'.repeat(64)),false);
  const events = (await db.query('select action from clock_kiosk_events order by id')).rows.map(r=>r.action);
  assert.deepEqual(events,['code_issued','paired','code_issued','code_issued','paired','code_issued','revoked']);
  await assert.rejects(db.exec('delete from clock_kiosk_events'), /permission denied/);
  await assert.rejects(db.exec("update clock_kiosk_events set action='paired'"), /permission denied/);
  await db.exec('reset role');
  const policies = (await db.query("select * from pg_policies where tablename like 'clock_kiosk_%'")).rows;
  assert.equal(policies.length,0);
});
