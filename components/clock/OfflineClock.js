'use client';
import { useEffect, useRef, useState } from 'react';
import PinPad from '@/components/PinPad';
import FaceCapture from './FaceCapture';
import CameraWarmup from './CameraWarmup';
import CorrectionContext from './CorrectionContext';
import ClockScheduleNotice from './ClockScheduleNotice';
import { OFFLINE_LABELS, baseKind, canCapture, captureTime, encryptOfflinePin, offlineActions, projectRoster } from '@/lib/offline-clock';
import { offlinePinReady } from '@/lib/offline-pin';
import { enqueueOfflinePunch, verifyOfflineEmployeePin } from '@/lib/offline-clock-store';
import { parseCorrectionTime } from '@/lib/clock-corrections';
import { toStoreDateTimeLocal, formatStoreDateTime } from '@/lib/store-time';

export default function OfflineClock({ state, onBusy, onSaved }) {
  const [selected,setSelected]=useState(null), [pin,setPin]=useState(''), [managerPin,setManagerPin]=useState('');
  const [step,setStep]=useState('list'), [kind,setKind]=useState(null), [claimed,setClaimed]=useState(''), [reason,setReason]=useState('');
  const [query,setQuery]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false), [done,setDone]=useState(null);
  const saving=useRef(false), pinProof=useRef(null), verifying=useRef(false);
  const snapshot=state.snapshot, roster=projectRoster(snapshot,state.events), ready=canCapture(snapshot);
  const selectedState=useRef(null);
  useEffect(()=>{onBusy(step!=='list');},[step,onBusy]);
  useEffect(()=>{
    if(step!=='done') return;
    const timer=setTimeout(()=>{setStep('list');setSelected(null);setDone(null);},5000);
    return ()=>clearTimeout(timer);
  },[step]);
  function reset(){pinProof.current=null;setSelected(null);setPin('');setManagerPin('');setKind(null);setError('');setStep('list');}
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
    setClaimed(toStoreDateTimeLocal(captureTime(snapshot)));
    setStep(value.startsWith('forgot_') ? 'correction' : value==='clock_in' ? 'authorization' : 'photo');
  }
  async function save(photo,face){
    if(saving.current) return;
    saving.current=true;setBusy(true);setError('');
    try {
      const captured=captureTime(snapshot), occurred=kind.startsWith('forgot_') ? parseCorrectionTime(claimed) : captured;
      if(!occurred) throw new Error('Choose the actual missed time.');
      const current=selectedState.current;
      const event={id:crypto.randomUUID(),employee_id:selected.id,kind,captured_at:captured,occurred_at:occurred,reason,
        punch_id:current.punch_id || null,break_id:current.break_id || null,previous_id:current.previous_id || null};
      const sealed_pin=await encryptOfflinePin(snapshot.public_key,event,pin,managerPin);
      await enqueueOfflinePunch({event,sealed_pin,lease:snapshot.lease,photo,face_detected:!!face},pinProof.current);
      pinProof.current=null;
      setDone({name:selected.name,label:OFFLINE_LABELS[kind],time:occurred});setPin('');setManagerPin('');setStep('done');
      await onSaved();
    } catch(err){setError(err.message);}
    finally{saving.current=false;setBusy(false);}
  }
  const button='min-h-12 rounded-xl border border-zinc-300 bg-white px-4 py-3 font-semibold text-zinc-900 disabled:opacity-40';
  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6">
    <CameraWarmup active={step!=='list' && step!=='done'} />
    {step==='list' ? <>
      <div className="mx-auto mb-4 w-full max-w-4xl"><h1 className="text-2xl font-bold">Store time clock</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Your PIN is checked on this iPad before a punch or photo can be saved.</p>
        {!ready && <p role="alert" className="mt-3 rounded-lg bg-amber-100 p-3 text-amber-950">Reconnect the iPad to renew offline access. Previously saved punches will stay here until uploaded.</p>}
        <input aria-label="Find your name" placeholder="Find your name" value={query} onChange={e=>setQuery(e.target.value)} className="mt-4 w-full rounded-lg border px-3 py-3" />
      </div>
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {roster.filter(employee=>employee.name.toLowerCase().includes(query.toLowerCase())).map(employee=><button key={employee.id} onClick={()=>choose(employee)} disabled={!ready} className={`${button} flex items-center justify-between gap-2 text-left`}>
          <span>{employee.name}{!offlinePinReady(snapshot,state.credentials,employee.id) && <span className="block text-xs text-amber-800">Needs one online PIN entry</span>}{employee.review && <span className="block text-xs text-amber-800">Manager review needed</span>}</span>
          <span className="text-xs font-bold text-zinc-500">{employee.on_break?'BREAK':employee.clocked_in?'IN':'OUT'}{employee.waiting?' · Saved':''}</span>
        </button>)}
      </div>
    </> : <div className="mx-auto w-full max-w-lg">
      {step!=='done' && <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">{selected?.name}</h2><button onClick={reset} disabled={busy} className="min-h-11 px-3 underline">Cancel</button></div>}
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-100 p-3 text-red-900">{error}</p>}
      {step==='pin' && <><PinPad pin={pin} onChange={value=>{if(!busy)setPin(value);}} subtitle="Enter your PIN" /><button disabled={busy || pin.length!==4} onClick={checkPin} className={`${button} mt-4 w-full`}>{busy?'Checking PIN…':'Continue'}</button></>}
      {step==='actions' && <div className="grid gap-3">{offlineActions(selected,snapshot.settings).map(value=><div key={value}>
        <button onClick={()=>action(value)} className={`${button} w-full`}>{OFFLINE_LABELS[value]}</button>
        {!value.startsWith('forgot_') && value!=='clock_in' && <ClockScheduleNotice action={value} context={selected.clock_schedule} settings={snapshot.settings} offline clockOffset={snapshot.clock_offset_ms || 0} />}
      </div>)}</div>}
      {step==='authorization' && <div className="space-y-4"><h3 className="text-lg font-semibold">Clock in</h3><p className="text-sm">If you are working outside your scheduled shift, have a manager enter their PIN. Scheduled shifts can continue.</p>
        <label className="block text-sm font-medium">Manager PIN (unscheduled work only)<input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={managerPin} onChange={e=>setManagerPin(e.target.value.replace(/\D/g,''))} className="mt-2 block w-full rounded-lg border p-3" /></label>
        <button disabled={managerPin.length>0 && managerPin.length!==4} className={`${button} w-full`} onClick={()=>setStep('photo')}>Continue to photo</button></div>}
      {step==='correction' && <form className="space-y-4" onSubmit={e=>{e.preventDefault();setStep('photo');}}><h3 className="text-lg font-semibold">{OFFLINE_LABELS[kind]}</h3>
        <CorrectionContext type={kind} clockIn={selected?.clock_in} breakStart={selected?.break_start} lastClockOut={selected?.last_clock_out} />
        <label className="block text-sm font-medium">Actual time (restaurant time)<input type="datetime-local" required value={claimed} max={toStoreDateTimeLocal(captureTime(snapshot))} onChange={e=>setClaimed(e.target.value)} className="mt-2 block w-full rounded-lg border p-3" /></label>
        <label className="block text-sm font-medium">Reason<textarea required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} className="mt-2 block w-full rounded-lg border p-3" /></label>
        <button className={`${button} w-full`}>Continue to photo</button></form>}
      {step==='photo' && <>
        <ClockScheduleNotice action={kind} context={selected.clock_schedule} settings={snapshot.settings} offline clockOffset={snapshot.clock_offset_ms || 0} />
        <FaceCapture actionLabel={`Save ${baseKind(kind).replaceAll('_',' ')} on iPad`} onCaptured={save} onCancel={()=>setStep('actions')} busy={busy} />
      </>}
      {step==='done' && <div className="py-12 text-center"><h2 className="text-3xl font-bold">Saved on this iPad</h2><p className="mt-4 text-lg">{done?.name} · {done?.label}</p><p className="mt-2">{formatStoreDateTime(done?.time)}</p><p className="mt-4 text-sm">Your PIN was checked. Uploads automatically when connected, using the time shown above.</p><button onClick={reset} className={`${button} mt-6 w-full`}>Done</button></div>}
    </div>}
  </div>;
}
