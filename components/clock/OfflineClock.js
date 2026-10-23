'use client';
import { useEffect, useRef, useState } from 'react';
import PinPad from '@/components/PinPad';
import FaceCapture from './FaceCapture';
import CameraWarmup from './CameraWarmup';
import CorrectionContext from './CorrectionContext';
import ClockScheduleNotice from './ClockScheduleNotice';
import ClockWorkForm from './ClockWorkForm';
import { defaultClockWork, clockWorkRequest, cachedScheduledShift } from '@/lib/clock-work';
import { OFFLINE_LABELS, baseKind, canCapture, captureTime, encryptOfflinePin, offlineActions, projectRoster } from '@/lib/offline-clock';
import { offlinePinReady } from '@/lib/offline-pin';
import { enqueueOfflinePunch, verifyOfflineEmployeePin } from '@/lib/offline-clock-store';
import { parseCorrectionTime } from '@/lib/clock-corrections';
import { toStoreDateTimeLocal, formatStoreDateTime } from '@/lib/store-time';

export default function OfflineClock({ state, onBusy, onSaved }) {
  const [selected,setSelected]=useState(null), [pin,setPin]=useState(''), [managerPin,setManagerPin]=useState('');
  const [step,setStep]=useState('list'), [kind,setKind]=useState(null), [claimed,setClaimed]=useState(''), [reason,setReason]=useState('');
  const [query,setQuery]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false), [done,setDone]=useState(null);
  const [work,setWork]=useState(defaultClockWork), [managerId,setManagerId]=useState(''), [scheduledShift,setScheduledShift]=useState(null);
  const managerProof=useRef(null);
  const saving=useRef(false), pinProof=useRef(null), verifying=useRef(false);
  const snapshot=state.snapshot, roster=projectRoster(snapshot,state.events), ready=canCapture(snapshot);
  const selectedState=useRef(null), scrollRef=useRef(null);
  useEffect(()=>{scrollRef.current?.scrollTo({top:0});},[step]);
  useEffect(()=>{onBusy(step!=='list');},[step,onBusy]);
  useEffect(()=>{
    if(step!=='done') return;
    const timer=setTimeout(()=>{setStep('list');setSelected(null);setDone(null);},5000);
    return ()=>clearTimeout(timer);
  },[step]);
  function reset(){pinProof.current=null;managerProof.current=null;setWork(defaultClockWork());setManagerId('');setSelected(null);setPin('');setManagerPin('');setKind(null);setError('');setStep('list');}
  function choose(employee){pinProof.current=null;selectedState.current={...employee};setSelected(employee);setPin('');setError('');setStep('pin');}
  async function checkPin(){
    if(verifying.current) return;
    verifying.current=true;setBusy(true);setError('');
    try{pinProof.current=await verifyOfflineEmployeePin(selected.id,pin);setStep('actions');}
    catch(err){pinProof.current=null;setPin('');setError(err.message);}
    finally{verifying.current=false;setBusy(false);}
  }
  function action(value){
    setKind(value);setError('');setReason('');setManagerPin('');
    setWork(defaultClockWork());managerProof.current=null;setManagerId('');
    const shift=value==='clock_in' ? cachedScheduledShift(snapshot,selected,state.events,captureTime(snapshot)) : null;
    setScheduledShift(shift);
    setClaimed(toStoreDateTimeLocal(captureTime(snapshot)));
    setStep(value.startsWith('forgot_') ? 'correction' : value==='clock_in' && !shift ? 'work' : 'photo');
  }
  async function authorizeWork(){
    if(busy) return;
    setBusy(true);setError('');
    try {
      clockWorkRequest(work);
      if(!snapshot.employees.find(e=>e.id===managerId)?.can_authorize_work) throw new Error('Select an authorized manager.');
      managerProof.current=await verifyOfflineEmployeePin(managerId,managerPin);
      setStep('photo');
    } catch(err){managerProof.current=null;setError(err.message);}
    finally{setBusy(false);}
  }
  async function save(photo,face){
    if(saving.current) return false;
    saving.current=true;setBusy(true);setError('');
    try {
      const captured=captureTime(snapshot), occurred=kind.startsWith('forgot_') ? parseCorrectionTime(claimed) : captured;
      if(!occurred) throw new Error('Choose the actual missed time.');
      const current=selectedState.current;
      const event={id:crypto.randomUUID(),employee_id:selected.id,kind,captured_at:captured,occurred_at:occurred,reason,
        punch_id:current.punch_id || null,break_id:current.break_id || null,previous_id:current.previous_id || null};
      if(kind==='clock_in') {
        if(scheduledShift) event.scheduled_shift_id=scheduledShift.id;
        else { event.work_context=clockWorkRequest(work); event.manager_id=managerId; }
      }
      const sealed_pin=await encryptOfflinePin(snapshot.public_key,event,pin,managerPin);
      await enqueueOfflinePunch({event,sealed_pin,lease:snapshot.lease,photo,face_detected:!!face},pinProof.current,managerProof.current);
      pinProof.current=null;
      setDone({name:selected.name,label:OFFLINE_LABELS[kind],time:occurred});setPin('');setManagerPin('');setStep('done');
      await onSaved();
      return true;
    } catch(err){setError(err.message);return false;}
    finally{saving.current=false;setBusy(false);}
  }
  const button='min-h-11 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40';
  return <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
    <CameraWarmup active={step!=='list' && step!=='done'} />
    {step==='list' ? <>
      <div className="mx-auto mb-3 w-full max-w-none"><h1 className="text-lg font-bold">Store time clock</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Your PIN is checked in this browser before a punch or photo can be saved.</p>
        {!ready && <p role="alert" className="mt-3 rounded-lg bg-amber-100 p-3 text-amber-950">Reconnect the browser to renew offline access. Previously saved punches will stay here until uploaded.</p>}
        <input aria-label="Find your name" placeholder="Find your name" value={query} onChange={e=>setQuery(e.target.value)} className="mt-4 w-full rounded-lg border px-3 py-3" />
      </div>
      <div className="mx-auto grid w-full max-w-none grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {roster.filter(employee=>employee.name.toLowerCase().includes(query.toLowerCase())).map(employee=><button key={employee.id} onClick={()=>choose(employee)} disabled={!ready} className={`${button} flex items-center justify-between gap-2 text-left`}>
          <span>{employee.name}{!offlinePinReady(snapshot,state.credentials,employee.id) && <span className="block text-xs text-amber-800">Needs one online PIN entry</span>}{employee.review && <span className="block text-xs text-amber-800">Manager review needed</span>}</span>
          <span className="text-xs font-bold text-zinc-500">{employee.on_break?'BREAK':employee.clocked_in?'IN':'OUT'}{employee.waiting?' · Saved':''}</span>
        </button>)}
      </div>
    </> : <div className={`mx-auto w-full ${step==='pin' ? 'max-w-xs' : 'max-w-md'}`}>
      {step!=='done' && <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{selected?.name}</h2><button onClick={reset} disabled={busy} className="min-h-11 px-3 underline">Cancel</button></div>}
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-100 p-3 text-red-900">{error}</p>}
      {step==='pin' && <><PinPad size="compact" loading={busy} pin={pin} onChange={value=>{if(!busy)setPin(value);}} subtitle="Type your PIN or use the keypad" /><button disabled={busy || pin.length!==4} onClick={checkPin} className={`${button} mt-4 w-full`}>{busy?'Checking PIN…':'Continue'}</button></>}
      {step==='actions' && <div className="grid gap-3">{offlineActions(selected,snapshot.settings).map(value=><div key={value}>
        <button onClick={()=>action(value)} className={`${button} w-full`}>{OFFLINE_LABELS[value]}</button>
        {!value.startsWith('forgot_') && value!=='clock_in' && <ClockScheduleNotice action={value} context={selected.clock_schedule} settings={snapshot.settings} offline clockOffset={snapshot.clock_offset_ms || 0} />}
      </div>)}</div>}
      {step==='work' && <><h3 className="text-lg font-semibold">No shift scheduled</h3><ClockWorkForm value={work} onChange={setWork} shifts={snapshot.work_shifts} employeeId={selected.id} at={captureTime(snapshot)} offline /><button className={`${button} w-full`} disabled={!work.reason || (work.reason==='covering' && !work.covered_shift_id)} onClick={()=>setStep('authorization')}>Manager approve</button></>}
      {step==='authorization' && <div className="space-y-4"><h3 className="text-lg font-semibold">Manager approval</h3>
        <ClockWorkForm value={work} onChange={setWork} shifts={snapshot.work_shifts} employeeId={selected.id} at={captureTime(snapshot)} manager offline />
        <label className="block text-sm font-medium">Manager<select value={managerId} onChange={e=>{setManagerId(e.target.value);setManagerPin('');}} className="mt-2 block min-h-11 w-full rounded-lg border bg-white p-3 text-zinc-900"><option value="">Choose a manager</option>{snapshot.employees.filter(e=>e.can_authorize_work).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label className="block text-sm font-medium">Manager PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={managerPin} onChange={e=>setManagerPin(e.target.value.replace(/\D/g,''))} className="mt-2 block w-full rounded-lg border p-3" /></label>
        <p className="text-sm">The manager must have entered their PIN online in this browser before approving offline.</p>
        <button disabled={busy || !managerId || managerPin.length!==4} className={`${button} w-full`} onClick={authorizeWork}>{busy?'Checking PIN…':'Approve & continue to photo'}</button><button className={`${button} w-full`} disabled={busy} onClick={()=>setStep('work')}>Back</button></div>}
      {step==='correction' && <form className="space-y-4" onSubmit={e=>{e.preventDefault();setStep('photo');}}><h3 className="text-lg font-semibold">{OFFLINE_LABELS[kind]}</h3>
        <CorrectionContext type={kind} clockIn={selected?.clock_in} breakStart={selected?.break_start} lastClockOut={selected?.last_clock_out} />
        <label className="block text-sm font-medium">Actual time (restaurant time)<input type="datetime-local" required value={claimed} max={toStoreDateTimeLocal(captureTime(snapshot))} onChange={e=>setClaimed(e.target.value)} className="mt-2 block w-full rounded-lg border p-3" /></label>
        <label className="block text-sm font-medium">Reason<textarea required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} className="mt-2 block w-full rounded-lg border p-3" /></label>
        <button className={`${button} w-full`}>Continue to photo</button></form>}
      {step==='photo' && <>
        <ClockScheduleNotice action={kind} context={selected.clock_schedule} settings={snapshot.settings} offline clockOffset={snapshot.clock_offset_ms || 0} />
        <FaceCapture actionLabel={kind.startsWith('forgot_') ? 'Save missed time' : OFFLINE_LABELS[baseKind(kind)]} onConfirm={save} onCancel={()=>setStep('actions')} busy={busy} />
      </>}
      {step==='done' && <div className="py-6 text-center"><h2 className="text-xl font-bold">Saved in this browser</h2><p className="mt-4 text-lg">{done?.name} · {done?.label}</p><p className="mt-2">{formatStoreDateTime(done?.time)}</p><p className="mt-4 text-sm">Your PIN was checked. Uploads automatically when connected, using the time shown above.</p><button onClick={reset} className={`${button} mt-3 w-full`}>Done</button></div>}
    </div>}
  </div>;
}
