import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import 'fake-indexeddb/auto';
import { readOfflineClock,saveOfflineSnapshot,enqueueOfflinePunch,syncOfflineClock,disableOfflineCapture,rememberOnlinePin,verifyOfflineEmployeePin } from '../lib/offline-clock-store.js';
import { projectRoster } from '../lib/offline-clock.js';

test('durable photo queue survives reopening, lost replies, retries and concurrent tabs',async()=>{
  globalThis.window=new EventTarget();
  const employee='11111111-1111-4111-8111-111111111111';
  const snapshot={lease:'synthetic-lease',issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),employees:[{id:employee,pin_version:'synthetic-v1',name:'Synthetic Crew',punch_id:null,break_id:null}]};
  await saveOfflineSnapshot(snapshot);
  await rememberOnlinePin(employee,'1234','synthetic-v1');
  const proof=await verifyOfflineEmployeePin(employee,'1234');
  const enqueue=item=>enqueueOfflinePunch(item,proof);
  function item(kind='clock_in',refs={}){
    const time=new Date().toISOString();
    return {event:{id:randomUUID(),employee_id:employee,kind,captured_at:time,occurred_at:time,reason:'',punch_id:null,break_id:null,previous_id:null,...refs},photo:new Blob([new Uint8Array([255,216,255,0,255,217])],{type:'image/jpeg'}),sealed_pin:'ciphertext',lease:snapshot.lease,face_detected:false};
  }
  const first=item();await enqueue(first);
  let state=await readOfflineClock();assert.equal(state.events.length,1);assert.equal(state.events[0].photo.size,6);assert.equal(projectRoster(state.snapshot,state.events)[0].clocked_in,true);
  // Stale state / double tap cannot append a second clock-in from another tab.
  await assert.rejects(enqueue(item()),/status changed/);
  const refs={punch_id:`local:${first.event.id}`,previous_id:first.event.id};
  const competitors=await Promise.allSettled([enqueue(item('break_start',refs)),enqueue(item('break_start',refs))]);
  assert.equal(competitors.filter(row=>row.status==='fulfilled').length,1);
  state=await readOfflineClock();assert.equal(state.events.length,2);
  const originalFetch=globalThis.fetch,serverReceipts=new Set();let dropReply=true,uploads=0;
  globalThis.fetch=async(url,options)=>{
    if(url.endsWith('/sync')){
      const event=JSON.parse(options.body.get('event'));uploads++;serverReceipts.add(event.id);
      assert.equal(options.body.get('file').size,6);
      if(dropReply){dropReply=false;throw new TypeError('Simulated connection lost after commit');}
      return Response.json({ok:true,receipt:{id:event.id,status:'applied'}});
    }
    return Response.json({ok:true,snapshot:{...snapshot,employees:[{...snapshot.employees[0],clocked_in:true,on_break:true,punch_id:randomUUID(),break_id:randomUUID()}]}});
  };
  try{
    await assert.rejects(syncOfflineClock(),/connection lost/);
    state=await readOfflineClock();assert.equal(state.events.length,2);assert.ok(state.events.every(row=>!row.receipt));
    await syncOfflineClock();state=await readOfflineClock();assert.equal(state.events.length,0);assert.equal(serverReceipts.size,2);assert.equal(uploads,3);assert.equal(state.snapshot.employees[0].on_break,true);
    const second=item('break_end',{punch_id:state.snapshot.employees[0].punch_id,break_id:state.snapshot.employees[0].break_id});await enqueue(second);
    globalThis.fetch=async()=>Response.json({ok:false,error:'Unlock the iPad.'},{status:401});
    await assert.rejects(syncOfflineClock(),/Unlock/);assert.equal((await readOfflineClock()).events.length,1);
    await disableOfflineCapture();assert.equal((await readOfflineClock()).events.length,1);
    await assert.rejects(enqueue(item()),/renew offline/);
  }finally{globalThis.fetch=originalFetch;}
});

test('offline work reasons require a verified authorized manager and survive durable queue storage',async()=>{
  globalThis.window=new EventTarget();
  const employee=randomUUID(), manager=randomUUID();
  const previous=await readOfflineClock();
  const snapshot={lease:'work-lease',issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),employees:[
    {id:employee,pin_version:'crew-work',punch_id:null,break_id:null},
    {id:manager,pin_version:'manager-work',can_authorize_work:true,punch_id:null,break_id:null},
  ]};
  await saveOfflineSnapshot(snapshot,previous.events.map(e=>e.id));
  await rememberOnlinePin(employee,'1234','crew-work');await rememberOnlinePin(manager,'5678','manager-work');
  const employeeProof=await verifyOfflineEmployeePin(employee,'1234');
  await assert.rejects(verifyOfflineEmployeePin(manager,'1111'),/Incorrect PIN/);
  const time=new Date().toISOString();
  const item={event:{id:randomUUID(),employee_id:employee,kind:'clock_in',occurred_at:time,captured_at:time,reason:'',punch_id:null,break_id:null,previous_id:null,
    manager_id:manager,work_context:{reason:'extra_hours',note:'Called in'}},photo:new Blob(['photo']),sealed_pin:'encrypted',lease:snapshot.lease};
  await assert.rejects(enqueueOfflinePunch(item,employeeProof),/manager must verify/);
  await assert.rejects(enqueueOfflinePunch(item,employeeProof,employeeProof),/manager must verify/);
  const managerProof=await verifyOfflineEmployeePin(manager,'5678');
  await enqueueOfflinePunch(item,employeeProof,managerProof);
  const saved=await readOfflineClock();assert.equal(saved.events.length,1);
  assert.deepEqual(saved.events[0].event.work_context,item.event.work_context);
  assert.equal(saved.events[0].event.manager_id,manager);
});
