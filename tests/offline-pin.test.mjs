import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import 'fake-indexeddb/auto';
import {readOfflineClock,saveOfflineSnapshot,rememberOnlinePin,verifyOfflineEmployeePin,enqueueOfflinePunch,syncOfflineClock} from '../lib/offline-clock-store.js';
import {offlinePinVersion} from '../lib/offline-clock-crypto.js';
import {projectRoster} from '../lib/offline-clock.js';
import {offlinePinReady} from '../lib/offline-pin.js';

test('offline PIN checks fail closed, persist throttling and invalidate changed credentials',async t=>{
  globalThis.window=new EventTarget();
  const id=randomUUID(),other=randomUUID();
  const snapshot={lease:'synthetic',issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),employees:[{id,pin_version:'device-employee-v1',clocked_in:true,punch_id:randomUUID()}]};
  const event=()=>({id:randomUUID(),employee_id:id,kind:'clock_out',captured_at:new Date().toISOString(),occurred_at:new Date().toISOString(),reason:'',punch_id:snapshot.employees[0].punch_id,break_id:null,previous_id:null});
  const item=()=>{const e=event();e.occurred_at=e.captured_at;return {event:e,photo:new Blob(['photo']),sealed_pin:'sealed',lease:snapshot.lease};};
  await saveOfflineSnapshot(snapshot);
  await assert.rejects(verifyOfflineEmployeePin(id,'1234'),/once while.*online/);
  await rememberOnlinePin(id,'1234','device-employee-v1');
  const originalRecord=(await readOfflineClock()).credentials[id];
  await rememberOnlinePin(id,'1234','device-employee-v1');
  assert.deepEqual((await readOfflineClock()).credentials[id],originalRecord,'Same verified PIN version reuses the original salted verifier');
  assert.equal(offlinePinReady(snapshot,(await readOfflineClock()).credentials,id),true);
  await assert.rejects(verifyOfflineEmployeePin(id,'9999'),/Incorrect PIN/);
  await assert.rejects(enqueueOfflinePunch(item(),{}),/PIN check expired/);
  assert.equal((await readOfflineClock()).events.length,0);
  const proof=await verifyOfflineEmployeePin(id,'1234');
  await assert.rejects(enqueueOfflinePunch({...item(),event:{...event(),employee_id:other}},proof),/PIN check expired/);
  const changed={...snapshot,employees:[{...snapshot.employees[0],pin_version:'device-employee-v2'}]};
  await saveOfflineSnapshot(changed);
  await assert.rejects(enqueueOfflinePunch(item(),proof),/PIN check expired/);
  await assert.rejects(verifyOfflineEmployeePin(id,'1234'),/once while.*online/);
  await rememberOnlinePin(id,'5678','device-employee-v2');
  assert.notEqual((await readOfflineClock()).credentials[id].salt,originalRecord.salt,'Changed PIN version gets a new verifier');
  const wrong=await Promise.allSettled(Array.from({length:7},()=>verifyOfflineEmployeePin(id,'1234')));
  assert.equal(wrong.filter(result=>/Incorrect PIN/.test(result.reason?.message)).length,5);
  assert.equal(wrong.filter(result=>/Too many/.test(result.reason?.message)).length,2);
  // Re-importing simulates a new page/module instance against the same IndexedDB.
  const reopened=await import('../lib/offline-clock-store.js?reopened');
  await assert.rejects(reopened.verifyOfflineEmployeePin(id,'5678'),/Too many/);
  const originalNow=Date.now;t.after(()=>{Date.now=originalNow;});
  Date.now=()=>originalNow()+5*60000+1;
  const accepted=await verifyOfflineEmployeePin(id,'5678');
  const punch=item();await enqueueOfflinePunch(punch,accepted);
  let state=await readOfflineClock();assert.equal(state.events.length,1);assert.equal(projectRoster(state.snapshot,state.events)[0].clocked_in,false);
  assert.equal(state.credentials[id].pin,undefined);assert.notEqual(state.credentials[id].verifier,'5678');
  let releaseBootstrap;const gate=new Promise(resolve=>{releaseBootstrap=resolve;});
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
  let readyToRefresh;const waiting=new Promise(resolve=>{readyToRefresh=resolve;});let syncFinished=false;
  window.addEventListener('clock-sync-complete',()=>{syncFinished=true;});
  globalThis.fetch=async url=>{
    if(url.endsWith('/sync'))return Response.json({ok:true,receipt:{id:punch.event.id,status:'applied'}});
    readyToRefresh();await gate;
    return Response.json({ok:true,snapshot:{...changed,issued_at:new Date(Date.now()).toISOString(),employees:[{...changed.employees[0],clocked_in:false,punch_id:null}]}});
  };
  const syncing=syncOfflineClock();await waiting;
  state=await readOfflineClock();assert.equal(state.events.length,1);assert.equal(state.events[0].receipt.status,'applied');assert.equal(syncFinished,false);
  releaseBootstrap();await syncing;state=await readOfflineClock();
  assert.equal(state.events.length,0);assert.equal(state.snapshot.employees[0].clocked_in,false);assert.equal(syncFinished,true);
});

test('credential change markers are bound to device, employee and PIN hash',()=>{
  process.env.SESSION_SECRET='synthetic-offline-pin-secret-32-characters';
  const employee={id:randomUUID(),employee_code:'synthetic-bcrypt-hash'};
  const version=offlinePinVersion('device-a',employee);
  assert.equal(version,offlinePinVersion('device-a',employee));
  assert.notEqual(version,offlinePinVersion('device-b',employee));
  assert.notEqual(version,offlinePinVersion('device-a',{...employee,id:randomUUID()}));
  assert.notEqual(version,offlinePinVersion('device-a',{...employee,employee_code:'changed-hash'}));
  assert.equal(offlinePinVersion('device-a',{id:employee.id}),null);
});

test('held receipts never claim a clock or break change was applied',()=>{
  const id=randomUUID(),first=randomUUID();
  const snapshot={employees:[{id,clocked_in:true,on_break:false,punch_id:randomUUID()}]};
  const events=[{sequence:1,event:{id:first,employee_id:id,kind:'break_start'},receipt:{status:'review'}},
    {sequence:2,event:{id:randomUUID(),employee_id:id,kind:'break_end',previous_id:first}}];
  const employee=projectRoster(snapshot,events)[0];
  assert.equal(employee.clocked_in,true);assert.equal(employee.on_break,false);assert.equal(employee.review,true);
});
