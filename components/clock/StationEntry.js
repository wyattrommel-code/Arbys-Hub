'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import ClockKiosk from './ClockKiosk';
import KioskUnlock from './KioskUnlock';
import OfflineClock from './OfflineClock';
import { offlinePinReady } from '@/lib/offline-pin';
import { canCapture } from '@/lib/offline-clock';
import { clockFetch, disableOfflineCapture, readOfflineClock, syncOfflineClock } from '@/lib/offline-clock-store';

export default function StationEntry() {
  const [status,setStatus]=useState(null), [error,setError]=useState(''), [code,setCode]=useState(''), [busy,setBusy]=useState(false);
  const [offline,setOffline]=useState(false), [state,setState]=useState({snapshot:null,events:[]});
  const [offlineBusy,setOfflineBusy]=useState(false), [syncError,setSyncError]=useState(''), [shellReady,setShellReady]=useState(false), [pinCacheError,setPinCacheError]=useState('');
  const checking=useRef(false), checkAgain=useRef(false);
  const read=useCallback(async()=>{try{const current=await readOfflineClock();setState(current);return current;}catch(err){setSyncError(err.message);return null;}},[]);
  const check=useCallback(async()=>{
    if(checking.current){checkAgain.current=true;return;}
    checking.current=true;
    try {
      const res=await clockFetch('/api/clock/status');
      if(!res.ok) throw new Error('Time clock connection unavailable.');
      const next=await res.json();setStatus(next);setError('');
      if(!next.unlocked){setOffline(false);await disableOfflineCapture();await read();return;}
      try {await syncOfflineClock();await read();setSyncError('');setOffline(false);}
      catch(err){setSyncError(err.message);if(err.status===401 || err.status===403){await disableOfflineCapture();}await read();}
    } catch(err){setOffline(true);setError(err.message);await read();}
    finally{checking.current=false;if(checkAgain.current){checkAgain.current=false;check();}}
  },[read]);
  useEffect(()=>{
    if(navigator.onLine===false)setOffline(true);
    read();check();
    const timer=setInterval(check,30000);
    const cacheFailed=event=>setPinCacheError(event.detail);
    const lost=()=>{setOffline(true);read();};
    const visible=()=>{if(document.visibilityState==='visible')check();};
    window.addEventListener('online',check);window.addEventListener('offline',lost);window.addEventListener('focus',check);
    window.addEventListener('clock-network-failed',lost);window.addEventListener('clock-storage',read);window.addEventListener('clock-punch-saved',check);
    window.addEventListener('clock-pin-cache-failed',cacheFailed);
    document.addEventListener('visibilitychange',visible);
    return ()=>{window.removeEventListener('clock-pin-cache-failed',cacheFailed);clearInterval(timer);window.removeEventListener('online',check);window.removeEventListener('offline',lost);window.removeEventListener('focus',check);window.removeEventListener('clock-network-failed',lost);window.removeEventListener('clock-storage',read);window.removeEventListener('clock-punch-saved',check);document.removeEventListener('visibilitychange',visible);};
  },[check,read]);
  useEffect(()=>{
    // Only this dedicated clock page registers a worker. It caches the public shell, never APIs.
    if(!('serviceWorker' in navigator)) return;
    let cancelled=false;
    async function prepare(){
      try{
        await navigator.serviceWorker.register('/clock-sw.js',{scope:'/',updateViaCache:'none'});
        const registration=await navigator.serviceWorker.ready;
        const channel=new MessageChannel();
        channel.port1.onmessage=event=>{if(!cancelled)setShellReady(event.data?.ready===true);channel.port1.close();};
        const assets=[...new Set([...document.querySelectorAll('script[src],link[rel="stylesheet"][href]')].map(el=>el.src || el.href).filter(url=>new URL(url,location.href).pathname.startsWith('/_next/static/')))];
        registration.active?.postMessage({type:'PREPARE_CLOCK',assets},[channel.port2]);
        await navigator.storage?.persist?.();
      }catch{if(!cancelled)setShellReady(false);}
    }
    prepare();return()=>{cancelled=true;};
  },[offline]);
  async function pair(event){
    event.preventDefault();setBusy(true);setError('');
    try{const res=await clockFetch('/api/clock/device/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const data=await res.json();if(!res.ok)throw new Error(data.error || 'Could not pair iPad.');setCode('');await check();}
    catch(err){setError(err.message);}finally{setBusy(false);}
  }
  const pending=state.events.filter(row=>!row.receipt).length;
  const awaitingRefresh=state.events.length>0 && pending===0;
  const pinReady=(state.snapshot?.employees || []).filter(employee=>offlinePinReady(state.snapshot,state.credentials,employee.id)).length;
  const pinTotal=state.snapshot?.employees?.length || 0;
  const allowOffline=!!state.snapshot && (offline || state.events.length>0 || offlineBusy);
  const available=status?.unlocked || (offline && state.snapshot);
  if(available) return <>
    <div role="status" className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm ${offline || pending || syncError ? 'bg-amber-100 text-amber-950' : 'bg-emerald-50 text-emerald-950'}`}>
      <span>{offline?'Offline':pending?'Uploading saved punches':awaitingRefresh?'Refreshing clock status':'Connected'} · {pending?`${pending} saved on this iPad` : canCapture(state.snapshot) && shellReady?pinReady===pinTotal && pinTotal>0?'Ready for offline clocking':`Offline PINs ready: ${pinReady}/${pinTotal}`:'Preparing offline clocking…'}{state.snapshot?.review_count>0?` · ${state.snapshot.review_count} need manager review in the Hub`:''}</span>
      <button onClick={check} className="min-h-9 px-2 font-semibold underline">Sync now</button>
      {pinReady<pinTotal && !pending && <p className="w-full text-xs">Each employee needs one successful PIN entry while online on this iPad to prepare offline access.</p>}
      {pinCacheError && <p role="alert" className="w-full text-xs">{pinCacheError}</p>}
      {syncError && <p className="w-full text-xs">{syncError}</p>}
    </div>
    {allowOffline?<OfflineClock state={state} onBusy={setOfflineBusy} onSaved={async()=>{await read();check();}}/>:<ClockKiosk/>}
  </>;
  if(status?.paired) return <><KioskUnlock/>{pending>0 && <p role="status" className="p-4 text-center">{pending} punches are saved on this iPad. Unlock to upload them.</p>}</>;
  if(!status || offline) return <div className="m-auto space-y-4 p-6 text-center"><h1 className="text-xl font-semibold">Store time clock</h1><p role="status">{error || 'Connecting…'}</p><p className="text-sm">{pending?`${pending} punches are still saved on this iPad.`:'Connect and unlock this iPad once to prepare offline clocking.'}</p>{error&&<button onClick={check} className="rounded bg-red-700 px-5 py-3 text-white">Try again</button>}</div>;
  return <form onSubmit={pair} className="m-auto w-full max-w-md space-y-5 rounded-xl border bg-white p-6 text-zinc-900">
    <h1 className="text-2xl font-semibold">Pair the store iPad</h1><p>Ask your GM to enter a pairing code from Hub Settings → Store iPad.</p>
    {pending>0 && <p role="alert">{pending} saved punches remain here. Ask your manager to recover them before changing this iPad’s pairing.</p>}
    <label className="block font-medium">Pairing code<input autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={30} value={code} onChange={e=>setCode(e.target.value)} className="mt-2 w-full rounded border p-3 font-mono"/></label>
    {error&&<p role="alert" className="text-red-700">{error}</p>}<button disabled={busy || code.replace(/[\s-]/g,'').length!==20} className="w-full rounded bg-red-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy?'Pairing…':'Authorize this iPad'}</button>
  </form>;
}
