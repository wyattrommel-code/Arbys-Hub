import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { correctionTypes, parseCorrectionTime } from '../lib/clock-corrections.js';
import { timecardReview } from '../lib/timecard-approval.js';

test('missed options use verified state and restaurant-local times', () => {
  assert.deepEqual(correctionTypes(null), []);
  assert.deepEqual(correctionTypes({ action:'clock_in' }), ['forgot_clock_in']);
  assert.deepEqual(correctionTypes({ action:'clock_out', settings:{use_break_punches:true} }), ['forgot_clock_out','forgot_break_start']);
  assert.deepEqual(correctionTypes({ action:'clock_out', on_break:true }), ['forgot_break_end']);
  assert.deepEqual(correctionTypes({ action:'clock_out', settings:{use_break_punches:false} }), ['forgot_clock_out']);
  assert.equal(parseCorrectionTime('2026-09-29T10:30'), '2026-09-29T16:30:00.000Z');
  for (const value of ['2026-02-30T10:30','2026-09-29T25:00','2026-03-08T02:30','tomorrow','2026-09-29T10:30Z',null]) assert.equal(parseCorrectionTime(value),null);
});

test('correction history requires review and changes invalidate approval', () => {
  const card={id:'p',clock_in:'2026-09-29T16:00:00Z',clock_out:'2026-09-29T20:00:00Z',worked_minutes:240,breaks:[],corrections:[{id:'c',reason:'Missed clock in'}]};
  const settings={};
  const first=timecardReview(card,null,settings);
  assert.ok(first.review_flags.includes('Missed punch correction'));
  assert.equal(first.payroll_ready,false);
  const approvals=[{punch_id:'p',snapshot_hash:first.review_version}];
  assert.equal(timecardReview(card,null,settings,approvals).payroll_ready,true);
  assert.equal(timecardReview({...card,corrections:[...card.corrections,{id:'d',reason:'Missed end break'}]},null,settings,approvals).payroll_ready,false);
});

test('missed punches update state, paid minutes and audit atomically', async t => {
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table employees(id uuid primary key,store_id text,first_name text,last_name text,jolt_employee_id text,is_active boolean,status text);
    create table attendance_settings(store_id text,use_break_punches boolean,subtract_scheduled_break boolean);
    create table schedule_shifts(id uuid,store_id text,unpaid_break_minutes integer);
    create table time_punches(id uuid primary key default gen_random_uuid(),employee_id uuid,employee_name text,jolt_employee_id text,
      shift_id uuid,clock_in timestamptz,clock_out timestamptz,status text,store_id text,unscheduled boolean,on_break boolean,
      total_break_minutes integer,needs_approval boolean,correction_type text,correction_note text,worked_minutes integer);
    create table break_punches(id uuid primary key default gen_random_uuid(),time_punch_id uuid,employee_id uuid,employee_name text,
      break_start timestamptz,break_end timestamptz,status text,store_id text,break_minutes integer);
    create table punch_corrections(id uuid primary key default gen_random_uuid(),time_punch_id uuid,break_punch_id uuid,
      employee_id uuid,employee_name text,correction_type text,claimed_time timestamptz,reason text,status text,store_id text);
    insert into employees values('11111111-1111-4111-8111-111111111111','07462','Test','Employee',null,true,'active');
    insert into attendance_settings values('payson',true,true);
    grant all on all tables in schema public to service_role;
  `);
  const migration=(await readdir(new URL('../supabase/migrations/',import.meta.url))).find(f=>f.endsWith('_missed_clock_corrections.sql'));
  await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
  const photoMigration=(await readdir(new URL('../supabase/migrations/',import.meta.url))).find(f=>f.endsWith('_correction_photos.sql'));
  await db.exec(await readFile(new URL('../supabase/migrations/'+photoMigration,import.meta.url),'utf8'));
  const id='11111111-1111-4111-8111-111111111111';
  const now=Date.now(); const at=mins=>new Date(now-mins*60000).toISOString();
  const call=async(type,time,punch=null,br=null)=> (await db.query('select hub_correct_missed_punch_photo($1,$2,$3,$4,$5,$6,$7,$8) as result',[id,type,time,'Forgot while busy',`https://synthetic.invalid/storage/v1/object/public/punch-photos/payson/${id}/photo.jpg`,true,punch,br])).rows[0].result;
  const count=async(table)=>(await db.query(`select count(*)::int as n from ${table}`)).rows[0].n;
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`); await assert.rejects(call('forgot_clock_in',at(240)),/permission denied/); await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await assert.rejects(db.query("select hub_correct_missed_punch($1,'forgot_clock_in',now(),'Missing photo',null,null)",[id]),/permission denied/);
  await assert.rejects(db.query("select hub_correct_missed_punch_photo($1,'forgot_clock_in',now(),'Missing photo',null,false,null,null)",[id]),/photo is required/);
  await assert.rejects(call('forgot_clock_in',at(-10)),/past 7 days/);
  await assert.rejects(call('forgot_clock_in',at(8*1440)),/past 7 days/);
  const first=await call('forgot_clock_in',at(240)); const punch=first.punch.id;
  assert.equal(first.punch.needs_approval,true); assert.equal(first.punch.clock_out,null);
  await assert.rejects(call('forgot_clock_in',at(240)),/status changed/);
  assert.equal(await count('time_punches'),1);
  await assert.rejects(call('forgot_break_end',at(60),punch),/No open break/);
  const start=await call('forgot_break_start',at(120),punch);
  assert.equal(start.punch.on_break,true);
  const br=(await db.query('select id from break_punches')).rows[0].id;
  await assert.rejects(call('forgot_clock_out',at(60),punch,br),/End your break/);
  await assert.rejects(call('forgot_break_end',at(130),punch,br),/after break start/);
  const end=await call('forgot_break_end',at(90),punch,br);
  assert.equal(end.punch.on_break,false); assert.equal(end.punch.total_break_minutes,30);
  await assert.rejects(call('forgot_break_end',at(85),punch,br),/status changed/);
  await assert.rejects(call('forgot_clock_out',at(100),punch),/existing break ended/);
  const out=await call('forgot_clock_out',at(60),punch);
  assert.equal(out.punch.worked_minutes,150); assert.equal(out.punch.status,'closed');
  assert.equal(await count('punch_corrections'),4);
  assert.equal((await db.query('select count(*)::int as n from punch_corrections where photo_url is not null and face_detected and photo_captured_at > claimed_time')).rows[0].n,4);
  await assert.rejects(call('forgot_clock_in' ,at(100)),/overlaps/);
  // A failed audit insert must roll back the status change too.
  await db.exec(`reset role; create function reject_audit() returns trigger language plpgsql as $$begin raise exception 'test audit failure'; end;$$;
    create trigger reject_audit before insert on punch_corrections for each row execute function reject_audit(); set role service_role;`);
  await assert.rejects(call('forgot_clock_in',at(30)),/test audit failure/);
  assert.equal(await count('time_punches'),1);
  assert.equal(await count('punch_corrections'),4);
});
