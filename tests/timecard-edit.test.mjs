import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {parseTimecardEdit,timecardEditState} from '../lib/timecard-edit.js';
import {timecardEditVersion} from '../lib/timecard-edit-version.js';
import {serializeTimecardPunch} from '../lib/timecards.js';
import {timecardReview} from '../lib/timecard-approval.js';

test('manager edits validate restaurant times, breaks and reasons',()=>{
  const input={clock_in:'2026-09-28T22:00',clock_out:'2026-09-29T06:00',breaks:[{start:'2026-09-29T01:00',end:'2026-09-29T01:30'}],note:'Corrected missed break',version:'a'.repeat(64)};
  const valid=parseTimecardEdit(input);
  assert.equal(valid.clock_in,'2026-09-29T04:00:00.000Z');
  assert.equal(valid.breaks[0].start,'2026-09-29T07:00:00.000Z');
  for (const change of [
    {clock_in:'2026-02-30T10:00'},{clock_out:'invalid'}, {note:''},{version:'old'}, {breaks:null},
    {breaks:[null]}, {breaks:[{start:'2026-09-29T01:00',end:'bad'}]},
    {breaks:[{start:'2026-09-29T01:00',end:null}]},
    {breaks:[{start:'2026-09-28T21:00',end:'2026-09-28T21:30'}]},
    {breaks:[{start:'2026-09-29T01:00',end:'2026-09-29T02:00'},{start:'2026-09-29T01:30',end:'2026-09-29T02:30'}]},
  ]) assert.throws(()=>parseTimecardEdit({...input,...change}));
  assert.equal(parseTimecardEdit({...input,clock_out:null,breaks:[{start:'2026-09-29T01:00',end:null}]}).breaks[0].end,null);
});

test('shift/break edits are atomic, audited, scoped and require fresh payroll review',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table employees(id uuid primary key,store_id text,is_active boolean,status text);
    create table attendance_settings(store_id text,use_break_punches boolean,subtract_scheduled_break boolean);
    create table schedule_shifts(id uuid,store_id text,unpaid_break_minutes integer);
    create table time_punches(id uuid primary key,employee_id uuid,employee_name text,store_id text,shift_id uuid,
      clock_in timestamptz,clock_out timestamptz,worked_minutes integer,total_break_minutes integer,on_break boolean,status text,needs_approval boolean);
    create table break_punches(id uuid primary key default gen_random_uuid(),time_punch_id uuid references time_punches(id),employee_id uuid,employee_name text,store_id text,
      break_start timestamptz,break_end timestamptz,break_minutes integer,status text);
    create table punch_corrections(id uuid primary key default gen_random_uuid(),break_punch_id uuid references break_punches(id) on delete cascade,reason text,photo_url text);
    insert into employees values('22222222-2222-4222-8222-222222222222','07462',true,'active');
    insert into attendance_settings values('payson',true,true);
    insert into time_punches values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Synthetic Crew','payson',null,'2026-09-28 22:00Z','2026-09-29 06:00Z',480,0,false,'closed',false);
    grant all on all tables in schema public to service_role;`);
  const file=(await readdir(new URL('../supabase/migrations/',import.meta.url))).find(f=>f.endsWith('_timecard_break_editing.sql'));
  await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  const pid='44444444-4444-4444-8444-444444444444',gm='22222222-2222-4222-8222-222222222222';
  const state=async()=>{const p=(await db.query('select * from time_punches where id=$1',[pid])).rows[0];const b=(await db.query('select * from break_punches where time_punch_id=$1 order by id',[pid])).rows;return {p,b,expected:timecardEditState(p,b)};};
  const save=async(breaks,changes={})=>{const s=await state();return (await db.query('select hub_edit_timecard($1,$2,$3,$4,$5,$6,$7,$8) as p',[
    pid,changes.clock_in ?? s.p.clock_in,Object.hasOwn(changes,'clock_out')?changes.clock_out:s.p.clock_out,JSON.stringify(breaks),
    JSON.stringify(changes.expected ?? s.expected),gm,'Synthetic Manager','Corrected forgotten break'])).rows[0].p;};
  for (const role of ['anon','authenticated']) { await db.exec(`set role ${role}`);await assert.rejects(db.query('select hub_edit_timecard(null,null,null,null,null,null,null,null)'),/permission denied/);await db.exec('reset role'); }
  await db.exec('set role service_role');
  const before=await state();
  const added=await save([{start:'2026-09-29T01:00Z',end:'2026-09-29T01:30Z'}]);
  assert.equal(added.worked_minutes,450);assert.equal(added.total_break_minutes,30);assert.equal(added.status,'edited');
  assert.notEqual(timecardEditVersion(added,(await state()).b),timecardEditVersion(before.p,before.b));
  const br=(await state()).b[0];
  await db.query('insert into punch_corrections(break_punch_id,reason,photo_url) values($1,$2,$3)',[br.id,'Missed break','protected-photo.jpg']);
  const changed=await save([{id:br.id,start:'2026-09-29T01:00Z',end:'2026-09-29T01:45Z'},{start:'2026-09-29T03:00Z',end:'2026-09-29T03:15Z'}]);
  assert.equal(changed.worked_minutes,420);assert.equal(changed.total_break_minutes,60);
  const serial=serializeTimecardPunch(changed,null,{breaks:(await state()).b});const review=timecardReview(serial,null,{});
  const approvals=[{punch_id:pid,snapshot_hash:review.review_version}];assert.equal(timecardReview(serial,null,{},approvals).payroll_ready,true);
  const noBreak=await save([]);assert.equal(noBreak.worked_minutes,480);assert.equal((await state()).b.length,0);
  const correction=(await db.query('select * from punch_corrections')).rows[0];assert.equal(correction.break_punch_id,null);assert.equal(correction.photo_url,'protected-photo.jpg');
  assert.equal(timecardReview(serializeTimecardPunch(noBreak,null,{breaks:[]}),null,{},approvals).payroll_ready,false);
  const history=(await db.query('select * from timecard_edits order by edited_at,id')).rows;
  assert.equal(history.length,3);assert.ok(history.some(h=>h.before_state.breaks.length===2&&h.after_state.breaks.length===0));
  const stable=await state();
  for (const rows of [
    [{start:'2026-09-29T01:00Z',end:'2026-09-29T02:00Z'},{start:'2026-09-29T01:30Z',end:'2026-09-29T02:30Z'}],
    [{start:'2026-09-28T21:00Z',end:'2026-09-28T22:30Z'}],
    [{start:'2026-09-29T05:00Z',end:'2026-09-29T07:00Z'}],
    [{start:'2026-09-29T01:00Z',end:null}],
    [{id:'99999999-9999-4999-8999-999999999999',start:'2026-09-29T01:00Z',end:'2026-09-29T01:30Z'}],
  ]) await assert.rejects(save(rows));
  await assert.rejects(save([],{expected:before.expected}),/changed/);
  assert.deepEqual(await state(),stable);
  await db.exec(`reset role;create function reject_edit() returns trigger language plpgsql as $$begin raise exception 'audit failure';end;$$;
    create trigger reject_edit before insert on timecard_edits for each row execute function reject_edit();set role service_role;`);
  await assert.rejects(save([{start:'2026-09-29T01:00Z',end:'2026-09-29T01:30Z'}]),/audit failure/);assert.deepEqual(await state(),stable);
  await db.exec('reset role;drop trigger reject_edit on timecard_edits;set role service_role;');
  const opened=await save([{start:'2026-09-29T01:00Z',end:null}],{clock_out:null});
  assert.equal(opened.on_break,true);assert.equal(opened.status,'open');assert.equal(opened.worked_minutes,null);
  const openBreak=(await state()).b[0];
  const ended=await save([{id:openBreak.id,start:'2026-09-29T01:00Z',end:'2026-09-29T01:30Z'}],{clock_out:'2026-09-29T06:00Z'});
  assert.equal(ended.on_break,false);assert.equal(ended.worked_minutes,450);
  // A kiosk break update occurring after the editor read must reject the stale save.
  const old=(await state()).expected;
  await db.query('update break_punches set break_end=$1 where id=$2',['2026-09-29T01:40Z',openBreak.id]);
  await assert.rejects(save([],{expected:old}),/changed/);
  await db.exec(`insert into time_punches(id,employee_id,store_id,clock_in,clock_out) values('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','payson','2026-09-29 07:00Z','2026-09-29 08:00Z');`);
  await assert.rejects(save([],{clock_out:'2026-09-29T09:00Z'}),/overlap/);
  await db.exec(`update attendance_settings set use_break_punches=false;update time_punches set shift_id='77777777-7777-4777-8777-777777777777' where id='${pid}';insert into schedule_shifts values('77777777-7777-4777-8777-777777777777','payson',20);`);
  assert.equal((await save([])).worked_minutes,460);
});
