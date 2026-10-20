import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { clockWorkRequest, coverageChoices, selectCoverage, approvedClockWork, validateWorkRequest, cachedScheduledShift } from '../lib/clock-work.js';
import { buildAttendanceReport } from '../lib/attendance-records.js';
import { buildAttendanceExport } from '../lib/attendance-export.js';
import { timecardReview } from '../lib/timecard-approval.js';
import { getStoreToday, toStoreDateTimeLocal } from '../lib/store-time.js';
import { weekStartSunday } from '../lib/schedule.js';

const worker='11111111-1111-4111-8111-111111111111', owner='22222222-2222-4222-8222-222222222222', manager='33333333-3333-4333-8333-333333333333';
const shift={id:'44444444-4444-4444-8444-444444444444',employee_id:owner,employee_name:'Original Employee',shift_date:'2026-10-11',scheduled_start:'16:00:00',scheduled_end:'22:00:00',published:true};
const work={version:1,reason:'covering',approved_by:manager,covered_shift_id:shift.id,covered_employee_id:owner,covered_employee_name:shift.employee_name,expected_start:'2026-10-11T23:00:00Z',expected_end:'2026-10-12T04:00:00Z',absence:'unchanged',note:''};
const punch={id:'p',employee_id:worker,employee_name:'Covering Employee',clock_in:work.expected_start,clock_out:work.expected_end,authorized_by_id:manager,work_context:work};
const fixture={employees:[{id:worker,first_name:'Covering',last_name:'Employee',is_active:true},{id:owner,first_name:'Original',last_name:'Employee',is_active:true}],shifts:[shift],punches:[punch],weeks:[{week_start_date:'2026-10-11',status:'published'}],from:'2026-10-11',to:'2026-10-12',now:new Date('2026-10-12T18:00:00Z')};

test('coverage choice uses published, available shifts near now and never the worker’s own shift',()=>{
  assert.deepEqual(coverageChoices([shift,{...shift,id:'self',employee_id:worker},{...shift,id:'draft',published:false},{...shift,id:'claimed',coverage_taken:true},{...shift,id:'in',owner_clocked_in:true}],worker,new Date(work.expected_start)).map(s=>s.id),[shift.id]);
  assert.equal(coverageChoices([shift],worker,new Date('2026-10-12T05:00:00Z')).length,0);
  const request=clockWorkRequest(selectCoverage({reason:'covering',absence:'unchanged',note:''},shift,new Date(work.expected_start)));
  assert.equal(Date.parse(request.expected_start),Date.parse(work.expected_start));
  assert.equal(Date.parse(request.expected_end),Date.parse(work.expected_end));
  assert.throws(()=>clockWorkRequest({reason:'covering'}),/Choose the shift/);
  assert.throws(()=>validateWorkRequest({reason:'bypass',note:''}),/valid/);
  assert.equal(cachedScheduledShift({work_shifts:[{...shift,employee_id:worker}],used_shift_ids:[shift.id]}, {id:worker},[],new Date(work.expected_start)),null);
});

test('coverage credits its worker, keeps a real absence, and uses the agreed start instead of the original start',()=>{
  const result=buildAttendanceReport(fixture);
  const covering=result.employees.find(e=>e.id===worker), original=result.employees.find(e=>e.id===owner);
  assert.equal(covering.covered_count,1);assert.equal(covering.counts.late,0);assert.equal(covering.counts.unscheduled,0);
  assert.equal(original.counts.no_show,1);assert.equal(original.completed,0);
  assert.equal(covering.records[0].work_label,'Covered a shift');
  assert.equal(covering.records[0].actual[0].id,'p');
  const csv=buildAttendanceExport(result,{type:'details',scope:'all',from:fixture.from,to:fixture.to}).csv;
  assert.match(csv,/Covered a shift/);assert.match(csv,/Covering Original Employee/);assert.doesNotMatch(csv,/Needs matching/);
});

test('approved swap suppresses absence, while covered call-out remains a call-out',()=>{
  for(const absence of ['approved_swap','call_out']) {
    const result=buildAttendanceReport({...fixture,punches:[{...punch,work_context:{...work,absence}}]});
    const original=result.employees.find(e=>e.id===owner);
    assert.equal(original.counts.no_show,0);
    assert.equal(original.counts.call_out,absence==='call_out'?1:0);
    assert.equal(original.records[0].status,absence==='call_out'?'Call-out':'Approved shift swap');
  }
  const result=buildAttendanceReport({...fixture,punches:[{...punch,work_context:{...work,absence:'approved_swap'}}],events:[{id:'c',employee_id:owner,event_date:shift.shift_date,shift_id:shift.id,event_type:'call_out',auto_generated:false}]});
  assert.equal(result.employees.find(e=>e.id===owner).counts.call_out,1);
});

test('extra hours are neutral, schedule issues need a timecard check, and unapproved data cannot erase flags',()=>{
  for(const reason of ['extra_hours','schedule_issue']) {
    const result=buildAttendanceReport({...fixture,punches:[{...punch,work_context:{version:1,reason,approved_by:manager,note:''}}]});
    const employee=result.employees.find(e=>e.id===worker);
    assert.equal(employee.counts.unscheduled,0);
    assert.equal(employee.extra_hours_count,reason==='extra_hours'?1:0);
    assert.equal(employee.check_count,reason==='schedule_issue'?1:0);
  }
  assert.equal(approvedClockWork({...punch,authorized_by_id:null}),null);
  assert.equal(buildAttendanceReport({...fixture,punches:[{...punch,authorized_by_id:null}]}).employees.find(e=>e.id===worker).counts.unscheduled,1);
  const reviewed={...punch,breaks:[],unscheduled:true};
  const settings={grace_minutes_late:10,grace_minutes_early_in:10,grace_minutes_early_out:10};
  assert.deepEqual(timecardReview(reviewed,null,settings).review_flags,[]);
  assert.ok(timecardReview({...reviewed,clock_out:'2026-10-12T03:00:00Z'},null,settings).review_flags.includes('Early clock-out'));
});

test('coverage migration enforces identity, manager/photo checks, conflicts, RLS access and atomic offline replay',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table employees(id uuid primary key,store_id text,first_name text,last_name text,jolt_employee_id text,is_active boolean,status text);
    create table attendance_settings(store_id text,use_break_punches boolean,subtract_scheduled_break boolean);
    create table schedule_shifts(id uuid primary key,store_id text,employee_id uuid,employee_name text,jolt_employee_id text,shift_date date,scheduled_start time,scheduled_end time,unpaid_break_minutes integer,role text,station text);
    create table schedule_weeks(store_id text,week_start_date date,status text);
    create table attendance_events(id uuid primary key default gen_random_uuid(),store_id text,employee_id uuid,shift_id uuid,event_date date,event_type text);
    create table time_punches(id uuid primary key default gen_random_uuid(),employee_id uuid,employee_name text,jolt_employee_id text,shift_id uuid,clock_in timestamptz,clock_out timestamptz,status text,store_id text,unscheduled boolean,on_break boolean,total_break_minutes integer,needs_approval boolean,correction_type text,correction_note text,worked_minutes integer,clock_in_photo_url text,clock_out_photo_url text,face_detected_in boolean,face_detected_out boolean,authorized_by_id uuid,authorized_by text);
    create table break_punches(id uuid primary key default gen_random_uuid(),time_punch_id uuid,employee_id uuid,employee_name text,break_start timestamptz,break_end timestamptz,status text,store_id text,break_minutes integer);
    create table punch_corrections(id uuid primary key default gen_random_uuid(),time_punch_id uuid,break_punch_id uuid,employee_id uuid,employee_name text,correction_type text,claimed_time timestamptz,reason text,status text,store_id text);
    insert into employees values('${worker}','07462','Working','Employee',null,true,'active'),('${owner}','07462','Original','Employee',null,true,'active'),('${manager}','07462','Store','Manager',null,true,'active');
    insert into attendance_settings values('payson',true,true);
    grant all on all tables in schema public to service_role;`);
  for(const path of ['20260929180900_missed_clock_corrections.sql','20260929225115_correction_photos.sql','20261005165404_offline_clock_queue.sql','20261013222727_clock_work_reasons.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+path,import.meta.url),'utf8'));
  const at=new Date(Date.now()-24*3600000), start=new Date(at.getTime()-2*3600000), end=new Date(at.getTime()+4*3600000), day=getStoreToday(start);
  await db.query('insert into schedule_shifts(id,store_id,employee_id,employee_name,shift_date,scheduled_start,scheduled_end,unpaid_break_minutes) values($1,\'payson\',$2,\'Original Employee\',$3,$4,$5,0)',[shift.id,owner,day,toStoreDateTimeLocal(start).slice(11),toStoreDateTimeLocal(end).slice(11)]);
  await db.query("insert into schedule_weeks values('payson',$1,'published')",[weekStartSunday(day)]);
  const context={reason:'covering',covered_shift_id:shift.id,expected_start:at.toISOString(),expected_end:end.toISOString(),absence:'unchanged',note:'Called in to cover'};
  const photo=`https://synthetic.invalid/storage/v1/object/public/punch-photos/payson/${worker}/photo.jpg`;
  const row={employee_id:worker,employee_name:'Working Employee',store_id:'payson',clock_in:at.toISOString(),authorized_by_id:manager,authorized_by:'Store Manager',clock_in_photo_url:photo,face_detected_in:true,unscheduled:true};
  const clockIn=async(p=row,w=context)=>(await db.query('select hub_clock_in_work($1,$2) result',[JSON.stringify(p),w?JSON.stringify(w):null])).rows[0].result;
  for(const role of ['anon','authenticated']) {await db.exec(`set role ${role}`);await assert.rejects(clockIn(),/permission denied/);await db.exec('reset role');}
  await db.exec('set role service_role');
  await assert.rejects(clockIn({...row,authorized_by_id:null}),/Manager authorization/);
  await assert.rejects(clockIn({...row,clock_in_photo_url:null}),/Photo/);
  await assert.rejects(clockIn({...row,employee_id:owner}),/another employee/);
  await assert.rejects(clockIn(row,{...context,covered_shift_id:randomUUID()}),/another employee/);
  await assert.rejects(clockIn(row,null),/Choose why/);
  await db.exec("update schedule_weeks set status='draft'"); await assert.rejects(clockIn(),/not published/); await db.exec("update schedule_weeks set status='published'");
  const saved=await clockIn();assert.equal(saved.employee_id,worker);assert.equal(saved.shift_id,null);assert.equal(saved.work_context.covered_employee_id,owner);assert.equal(saved.work_context.approved_by,manager);
  await assert.rejects(clockIn(),/Already clocked in/);
  await assert.rejects(clockIn({...row,employee_id:manager}),/already recorded as covering/);
  await db.exec('delete from time_punches');
  const event={id:randomUUID(),employee_id:worker,kind:'clock_in',captured_at:at.toISOString(),occurred_at:at.toISOString(),reason:'',punch_id:null,break_id:null,previous_id:null,work_context:context};
  const sync=async(e=event,m=manager)=>(await db.query('select hub_sync_offline_punch_work($1,$2,$3,$4,true,null,null,$5,$6) result',[JSON.stringify(e),'a'.repeat(64),'b'.repeat(64),photo,m,'Store Manager'])).rows[0].result;
  const first=await sync();assert.equal(first.status,'applied');assert.equal(first.punch.work_context.covered_shift_id,shift.id);
  assert.equal((await sync()).status,'applied');assert.equal((await db.query('select count(*)::int n from time_punches')).rows[0].n,1);
  const before=await db.query('select count(*)::int n from time_punches');
  assert.equal((await sync({...event,id:randomUUID()},null)).status,'review');
  assert.equal((await db.query('select count(*)::int n from time_punches')).rows[0].n,before.rows[0].n);
  assert.equal((await db.query("select event->'work_context' reason from clock_offline_events where status='review'")).rows[0].reason.reason,'covering');

  // A replacement can cover the remaining hours after the first worker clocks out.
  // Applying a held event must preserve its coverage context and actual payroll owner.
  const handoff=new Date(at.getTime()+3600000).toISOString();
  await db.query("update time_punches set clock_out=$1,status='closed' where id=$2",[handoff,first.punch.id]);
  const held={...event,id:randomUUID(),employee_id:manager,occurred_at:handoff,captured_at:handoff,work_context:{...context,expected_start:handoff}};
  const heldPhoto=photo.replace(worker,manager);
  const receipt=(await db.query('select hub_sync_offline_punch_work($1,$2,$3,$4,true,$5,null,null,null) result',[JSON.stringify(held),'a'.repeat(64),'c'.repeat(64),heldPhoto,'Manager authorization needs verification.'])).rows[0].result;
  assert.equal(receipt.status,'review');
  const applied=(await db.query('select hub_apply_offline_review_work($1,$2,$3) result',[held.id,manager,'Verified replacement coverage and photo.'])).rows[0].result;
  assert.equal(applied.employee_id,manager);
  assert.equal(applied.work_context.covered_shift_id,shift.id);
  assert.equal(applied.work_context.approved_by,manager);
  assert.equal(applied.authorized_by_id,manager);
  assert.ok((await db.query('select resolved_at from clock_offline_events where id=$1',[held.id])).rows[0].resolved_at);
});
