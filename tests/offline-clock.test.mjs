import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validateOfflineEvent, projectRoster, offlineActions, canCapture, encryptOfflinePin } from '../lib/offline-clock.js';
import { signOfflineLease, verifyOfflineLease, decryptOfflinePin } from '../lib/offline-clock-crypto.js';
const employee='11111111-1111-4111-8111-111111111111', device='a'.repeat(64);
const at=minutes=>new Date(Math.floor(Date.now()/1000)*1000-minutes*60000).toISOString();
const makeEvent=(kind='clock_in',extra={})=>({id:randomUUID(),employee_id:employee,kind,captured_at:at(1),occurred_at:at(1),reason:'',punch_id:null,break_id:null,previous_id:null,...extra});

test('offline state follows queued order and correction choices',()=>{
  const first=makeEvent(),br=makeEvent('break_start'),end=makeEvent('break_end'),out=makeEvent('clock_out');
  const snapshot={employees:[{id:employee,name:'Synthetic Crew',clocked_in:false,punch_id:null,break_id:null}]};
  const queued=[first,br,end,out].map((event,i)=>({sequence:i+1,event}));
  assert.deepEqual(offlineActions(projectRoster(snapshot,[])[0]),['clock_in','forgot_clock_in']);
  assert.equal(projectRoster(snapshot,queued.slice(0,1))[0].punch_id,`local:${first.id}`);
  assert.deepEqual(offlineActions(projectRoster(snapshot,queued.slice(0,2))[0]),['break_end','forgot_break_end']);
  assert.equal(projectRoster(snapshot,queued.slice(0,2))[0].break_start,br.occurred_at);
  assert.equal(projectRoster(snapshot,queued.slice(0,3))[0].on_break,false);
  assert.equal(projectRoster(snapshot,queued.slice(0,3))[0].break_start,null);
  assert.equal(projectRoster(snapshot,queued)[0].last_clock_out,out.occurred_at);
  assert.equal(projectRoster(snapshot,queued.reverse())[0].clocked_in,false);
  assert.equal(projectRoster(snapshot,queued)[0].previous_id,out.id);
  const valid=makeEvent();valid.occurred_at=valid.captured_at;assert.equal(validateOfflineEvent(valid),valid);
  for(const patch of [{kind:'delete'},{punch_id:'other'},{occurred_at:at(-3)},{kind:'forgot_clock_in',reason:''},{employee_id:'other'}])assert.throws(()=>validateOfflineEvent({...valid,...patch}));
});

test('capture leases are scoped to the paired device and encrypt PINs without exporting hashes',async()=>{
  process.env.SESSION_SECRET='synthetic-offline-clock-secret-32-characters';
  const now=Date.now(), lease=signOfflineLease(device,now), event=makeEvent();
  event.captured_at=new Date(now).toISOString();
  assert.equal(verifyOfflineLease(lease.lease,device,event.captured_at),true);
  assert.equal(verifyOfflineLease(lease.lease,'b'.repeat(64),event.captured_at),false);
  assert.equal(verifyOfflineLease(lease.lease+'tamper',device,event.captured_at),false);
  assert.equal(verifyOfflineLease(lease.lease,device,new Date(now+73*3600000).toISOString()),false);
  assert.equal(canCapture(lease,now+73*3600000),false);
  assert.equal(canCapture({...lease,lease:null},now),false);
  const pair=generateKeyPairSync('rsa',{modulusLength:2048}), pub=pair.publicKey.export({format:'jwk'}), priv=pair.privateKey.export({format:'jwk'});
  const sealed=await encryptOfflinePin(pub,event,'1234','5678');
  assert.equal(decryptOfflinePin(priv,sealed,event).pin,'1234');
  assert.equal(decryptOfflinePin(priv,sealed,event).manager_pin,'5678');
  assert.throws(()=>decryptOfflinePin(priv,sealed,{...event,id:randomUUID()}));
  assert.equal(pub.d,undefined);
});

test('offline sync applies original times once, preserves photos and sends conflicts to review atomically',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table employees(id uuid primary key,store_id text,first_name text,last_name text,jolt_employee_id text,is_active boolean,status text);
    create table attendance_settings(store_id text,use_break_punches boolean,subtract_scheduled_break boolean);
    create table schedule_shifts(id uuid primary key,store_id text,unpaid_break_minutes integer);
    create table time_punches(id uuid primary key default gen_random_uuid(),employee_id uuid,employee_name text,jolt_employee_id text,shift_id uuid,clock_in timestamptz,clock_out timestamptz,status text,store_id text,unscheduled boolean,on_break boolean,total_break_minutes integer,needs_approval boolean,correction_type text,correction_note text,worked_minutes integer,clock_in_photo_url text,clock_out_photo_url text,face_detected_in boolean,face_detected_out boolean,authorized_by_id uuid,authorized_by text);
    create table break_punches(id uuid primary key default gen_random_uuid(),time_punch_id uuid,employee_id uuid,employee_name text,break_start timestamptz,break_end timestamptz,status text,store_id text,break_minutes integer);
    create table punch_corrections(id uuid primary key default gen_random_uuid(),time_punch_id uuid,break_punch_id uuid,employee_id uuid,employee_name text,correction_type text,claimed_time timestamptz,reason text,status text,store_id text);
    insert into employees values('${employee}','07462','Synthetic','Crew',null,true,'active');
    insert into attendance_settings values('payson',true,true);
    grant all on all tables in schema public to service_role;`);
  for(const path of ['20260929180900_missed_clock_corrections.sql','20260929225115_correction_photos.sql','20261005165404_offline_clock_queue.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+path,import.meta.url),'utf8'));
  const photo=`https://synthetic.invalid/storage/v1/object/public/punch-photos/payson/${employee}/photo.jpg`;
  const call=async(event,issue=null,hash='b'.repeat(64))=>(await db.query('select hub_sync_offline_punch($1,$2,$3,$4,true,$5) as result',[JSON.stringify(event),device,hash,photo,issue])).rows[0].result;
  const count=async table=>(await db.query(`select count(*)::int as n from ${table}`)).rows[0].n;
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);await assert.rejects(call(makeEvent()),/permission denied/);
    for(const table of ['clock_offline_keys','clock_offline_events'])await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  const first=makeEvent('clock_in',{occurred_at:at(360),captured_at:at(360)});
  const responses=await Promise.all([call(first),call(first)]);
  assert.ok(responses.every(row=>row.status==='applied'));assert.equal(await count('time_punches'),1);
  await assert.rejects(call(first,null,'c'.repeat(64)),/receipt does not match/);
  const start=makeEvent('break_start',{occurred_at:at(180),captured_at:at(180),punch_id:`local:${first.id}`,previous_id:first.id});
  assert.equal((await call(start)).status,'applied');
  const end=makeEvent('break_end',{occurred_at:at(150),captured_at:at(150),punch_id:`local:${first.id}`,break_id:`local:${start.id}`,previous_id:start.id});
  assert.equal((await call(end)).status,'applied');
  const out=makeEvent('clock_out',{occurred_at:at(60),captured_at:at(60),punch_id:`local:${first.id}`,previous_id:end.id});
  const closed=await call(out);assert.equal(closed.status,'applied');assert.equal(closed.punch.worked_minutes,270);assert.equal(closed.punch.total_break_minutes,30);
  assert.ok(Math.abs(Date.parse(closed.punch.clock_in)-Date.parse(first.occurred_at))<1000);assert.equal(closed.punch.clock_out_photo_url,photo);assert.equal(closed.punch.needs_approval,true);
  const audits=(await db.query('select * from punch_corrections order by claimed_time')).rows;
  assert.equal(audits.length,4);assert.ok(audits.every(row=>row.source==='offline' && row.photo_url===photo));
  assert.equal(Date.parse(audits[0].photo_captured_at),Date.parse(first.captured_at));
  const conflict=makeEvent('clock_in',{occurred_at:at(200),captured_at:at(200)});
  assert.equal((await call(conflict)).status,'review');assert.equal(await count('time_punches'),1);
  const invalid=makeEvent();assert.equal((await call(invalid,'PIN did not match')).status,'review');
  const dependent=makeEvent('clock_out',{punch_id:`local:${invalid.id}`,previous_id:invalid.id});
  assert.equal((await call(dependent)).status,'review');
  assert.equal((await db.query("select count(*)::int as n from clock_offline_events where status='review' and photo_url is not null")).rows[0].n,3);
  await assert.rejects(call(makeEvent('break_start',{previous_id:randomUUID()})),/has not arrived/);
  await assert.rejects(db.exec('delete from clock_offline_events'),/permission denied/);
  await assert.rejects(db.exec("update clock_offline_events set event='{}'"),/permission denied/);
  // A failed receipt commit must not leave a new shift behind.
  await db.exec(`reset role;create function reject_receipt() returns trigger language plpgsql as $$begin raise exception 'receipt storage failed';end;$$;
    create trigger reject_receipt before insert on clock_offline_events for each row execute function reject_receipt();set role service_role;`);
  await assert.rejects(call(makeEvent()),/receipt storage failed/);
  assert.equal(await count('time_punches'),1);
  await db.exec('reset role;drop trigger reject_receipt on clock_offline_events;set role service_role;');
  // Discard the overlapping event with an audited note, then verify/apply a PIN mismatch.
  await db.query('update clock_offline_events set resolved_at=now(),resolved_by=$1,resolution_note=$2 where id=$3',[employee,'Duplicate of existing hours',conflict.id]);
  const applied=(await db.query('select hub_apply_offline_review($1,$2,$3) as punch',[invalid.id,employee,'Photo verified; employee mistyped their PIN'])).rows[0].punch;
  assert.equal(applied.clock_in_photo_url,photo);assert.equal(await count('time_punches'),2);
  await assert.rejects(db.query('select hub_apply_offline_review($1,$2,$3)',[invalid.id,employee,'Repeat click']),/already been handled/);
  const resolved=(await db.query('select resolved_at,resolved_by,resolution_punch_id from clock_offline_events where id=$1',[invalid.id])).rows[0];
  assert.ok(resolved.resolved_at);assert.equal(resolved.resolved_by,employee);assert.equal(resolved.resolution_punch_id,applied.id);
});
