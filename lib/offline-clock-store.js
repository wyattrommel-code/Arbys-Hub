import { canCapture, projectRoster, stateMatches, validateOfflineEvent } from './offline-clock';

import { createOfflinePinRecord, matchesOfflinePin, offlinePinReady } from './offline-pin';

const verifiedEntries = new WeakMap();
const DB_NAME = 'arbys-clock-offline-v1';
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('meta');
      request.result.createObjectStore('events', { keyPath: 'id' });
    };
    request.onerror = () => reject(new Error('This iPad could not open its saved punches. Keep this screen open and ask your manager for help.'));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function readOfflineClock() {
  const db = await openDb();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(['meta','events'], 'readonly');
    const snapshot = tx.objectStore('meta').get('snapshot'), credentials = tx.objectStore('meta').get('pin-credentials'), events = tx.objectStore('events').getAll();
    tx.oncomplete = () => { db.close(); resolve({ snapshot: snapshot.result || null, credentials: credentials.result || {}, events: (events.result || []).sort((a,b)=>a.sequence-b.sequence) }); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function writeTransaction(run) {
  const db = await openDb();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(['meta','events'], 'readwrite');
    let failure;
    const fail = error => { failure=error; tx.abort(); };
    try { run(tx, fail); } catch(error) { fail(error); }
    tx.oncomplete = () => { db.close(); window.dispatchEvent(new Event('clock-storage')); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(failure || new Error('Punch was NOT saved. The iPad storage may be full or unavailable. Ask your manager for help.')); };
  });
}
export async function rememberOnlinePin(employeeId, pin, version) {
  const record=await createOfflinePinRecord(pin,version);
  await writeTransaction(tx=>{
    const meta=tx.objectStore('meta'), request=meta.get('pin-credentials');
    request.onsuccess=()=>meta.put({...request.result,[employeeId]:record},'pin-credentials');
    meta.delete(`pin-attempts:${employeeId}`);
  });
}
export async function verifyOfflineEmployeePin(employeeId, pin) {
  let record, attempt;
  // Reserve an attempt in a transaction BEFORE the slow hash. Reloads and other tabs share this limit.
  await writeTransaction((tx,fail)=>{
    const meta=tx.objectStore('meta'), snap=meta.get('snapshot'), credentials=meta.get('pin-credentials');
    const attempts=meta.get(`pin-attempts:${employeeId}`);
    attempts.onsuccess=()=>{
      if(!canCapture(snap.result)) return fail(new Error('Reconnect this iPad to renew offline access.'));
      if(!offlinePinReady(snap.result,credentials.result,employeeId)) return fail(new Error('Enter your PIN once while this iPad is online to enable offline clocking.'));
      const now=Date.now(), previous=attempts.result;
      attempt=previous && now<previous.until ? previous : {count:0,until:now+5*60000};
      if(attempt.count>=5) return fail(new Error('Too many PIN attempts. Wait 5 minutes or reconnect and try online.'));
      attempt={...attempt,count:attempt.count+1,id:crypto.randomUUID()};
      meta.put(attempt,`pin-attempts:${employeeId}`);
      record=credentials.result[employeeId];
    };
  });
  if(!(await matchesOfflinePin(pin,record))) throw new Error('Incorrect PIN. Nothing was saved. Try again.');
  await writeTransaction((tx,fail)=>{
    const meta=tx.objectStore('meta'), snap=meta.get('snapshot'), credentials=meta.get('pin-credentials');
    const attempts=meta.get(`pin-attempts:${employeeId}`);
    attempts.onsuccess=()=>{
      if(!canCapture(snap.result) || !offlinePinReady(snap.result,credentials.result,employeeId) || credentials.result[employeeId].version!==record.version)
        return fail(new Error('Your PIN or offline access changed. Select your name again.'));
      if(attempts.result?.id===attempt.id) meta.delete(`pin-attempts:${employeeId}`);
    };
  });
  const proof={};
  verifiedEntries.set(proof,{employeeId,version:record.version,expires:Date.now()+5*60000});
  return proof;
}
export function saveOfflineSnapshot(snapshot, acknowledgedIds = []) {
  return writeTransaction(tx => {
    tx.objectStore('meta').put(snapshot, 'snapshot');
    for (const id of acknowledgedIds) tx.objectStore('events').delete(id);
  });
}
export function disableOfflineCapture() {
  // Revocation/unlock failures must not delete unsent punches or photos.
  return writeTransaction(tx => {
    const store=tx.objectStore('meta'), request=store.get('snapshot');
    request.onsuccess=()=>{ if(request.result) store.put({...request.result, lease:null},'snapshot'); };
  });
}
export function enqueueOfflinePunch(item, pinProof) {
  validateOfflineEvent(item.event);
  if (!(item.photo instanceof Blob) || !item.photo.size) throw new Error('Take a photo first.');
  return writeTransaction((tx,fail) => {
    const meta=tx.objectStore('meta'), events=tx.objectStore('events');
    const snapshotRequest=meta.get('snapshot'), allRequest=events.getAll();
    allRequest.onsuccess=()=> {
      const snapshot=snapshotRequest.result, all=allRequest.result;
      if (!canCapture(snapshot) || item.lease !== snapshot.lease) return fail(new Error('Reconnect this iPad to renew offline access. Your saved punches are safe.'));
      const proof=verifiedEntries.get(pinProof);
      const pinVersion=snapshot.employees.find(e=>e.id===item.event.employee_id)?.pin_version;
      if(!proof || proof.employeeId!==item.event.employee_id || proof.version!==pinVersion || Date.now()>=proof.expires)
        return fail(new Error('PIN check expired. Cancel and enter your PIN again.'));
      const employee=projectRoster(snapshot,all).find(e=>e.id===item.event.employee_id);
      if(employee?.sync_review) return fail(new Error('This saved punch needs manager review. Reconnect to refresh your status.'));
      if (!employee || !stateMatches(employee,item.event)) return fail(new Error('Clock status changed. Select your name again.'));
      if (all.filter(row=>!row.receipt).length >= 500) return fail(new Error('500 punches are waiting. Reconnect this iPad before recording more.'));
      const sequenceRequest=meta.get('sequence');
      sequenceRequest.onsuccess=()=> {
        const sequence=(sequenceRequest.result || 0)+1;
        meta.put(sequence,'sequence'); events.add({...item,id:item.event.id,sequence});
      };
    };
  });
}
export function acknowledgeOfflinePunch(id, receipt) {
  return writeTransaction(tx=>{
    const store=tx.objectStore('events'), request=store.get(id);
    request.onsuccess=()=>{ if(request.result) store.put({...request.result,receipt}); };
  });
}
export async function clockFetch(url, init = {}) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch(url,{...init,signal:controller.signal,cache:'no-store'});
    if(response.status>=500)window.dispatchEvent(new Event('clock-network-failed'));
    return response;
  } catch(error) {window.dispatchEvent(new Event('clock-network-failed'));throw error;}
  finally { clearTimeout(timer); }
}
let syncPromise;
export function syncOfflineClock() {
  if (syncPromise) return syncPromise;
  const run=async()=>{
    let state=await readOfflineClock();
    for(const item of state.events.filter(row=>!row.receipt)) {
      const form=new FormData();
      form.set('event',JSON.stringify(item.event)); form.set('lease',item.lease);
      form.set('sealed_pin',item.sealed_pin); form.set('face_detected',String(item.face_detected));
      form.set('file',item.photo,'offline-punch.jpg');
      const res=await clockFetch('/api/clock/offline/sync',{method:'POST',body:form});
      const data=await res.json();
      if(!res.ok || !data.ok) throw Object.assign(new Error(data.error || 'Saved punches are waiting for the connection.'),{status:res.status});
      // Only discard a photo after an explicit, durable server receipt.
      if(data.receipt?.id !== item.id || !['applied','review'].includes(data.receipt.status)) throw new Error('The Hub did not confirm this punch. It is still saved on the iPad.');
      await acknowledgeOfflinePunch(item.id,data.receipt);
    }
    state=await readOfflineClock();
    const acknowledged=state.events.filter(row=>row.receipt).map(row=>row.id);
    const started=Date.now();
    const res=await clockFetch('/api/clock/offline/bootstrap');
    const data=await res.json();
    if(!res.ok || !data.ok) throw Object.assign(new Error(data.error || 'Could not refresh offline readiness.'),{status:res.status});
    data.snapshot.clock_offset_ms=Date.parse(data.snapshot.issued_at)-(started+Date.now())/2;
    await saveOfflineSnapshot(data.snapshot,acknowledged);
    window.dispatchEvent(new Event('clock-sync-complete'));
    return readOfflineClock();
  };
  syncPromise=(navigator.locks ? navigator.locks.request('arbys-clock-sync',run) : run()).finally(()=>{syncPromise=null;});
  return syncPromise;
}
