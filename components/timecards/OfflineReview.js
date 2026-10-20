'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { OFFLINE_LABELS } from '@/lib/offline-clock';
import { formatStoreDateTime } from '@/lib/store-time';

export function OfflineReviewNotice(){
  const [count,setCount]=useState(0);
  useEffect(()=>{let active=true;fetch('/api/timecards/offline',{cache:'no-store'}).then(res=>res.json()).then(data=>{if(active)setCount(data.count || 0);}).catch(()=>{});return()=>{active=false;};},[]);
  return count>0?<Link href="/timeclock/offline" className="block border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">{count} offline {count===1?'punch needs':'punches need'} attention before payroll. Review saved times and photos →</Link>:null;
}
export default function OfflineReview(){
  const [events,setEvents]=useState([]),[count,setCount]=useState(0),[error,setError]=useState(''),[notes,setNotes]=useState({}),[busy,setBusy]=useState(null);
  const load=useCallback(async()=>{try{const res=await fetch('/api/timecards/offline',{cache:'no-store'}),data=await res.json();if(!res.ok)throw new Error(data.error);setEvents(data.events);setCount(data.count);setError('');}catch(err){setError(err.message);}},[]);
  useEffect(()=>{load();},[load]);
  async function resolve(event,action='resolve'){
    setBusy(event.id);setError('');
    try{const res=await fetch('/api/timecards/offline',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:event.id,note:notes[event.id] || '',action})}),data=await res.json();if(!res.ok)throw new Error(data.error);await load();}catch(err){setError(err.message);}finally{setBusy(null);}
  }
  return <section className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-bold">Offline punches to review</h1><button onClick={load} className="min-h-10 rounded border px-3 text-sm">Refresh</button></div>
    <p className="text-sm text-zinc-600 dark:text-zinc-300">These punches reached the Hub, but could not safely update a timecard. Verify the employee, photo and time, then apply the saved punch. For duplicates or times you corrected in Timecards, record a note and mark handled. Handle each employee’s punches in order.</p>
    <Link href="/timeclock/timecards" className="inline-block min-h-10 text-sm font-semibold text-[#C8102E] underline">Open timecards</Link>
    {error&&<p role="alert" className="rounded bg-red-100 p-3 text-red-900">{error}</p>}
    {!error && count===0 && <p className="rounded-lg border p-6 text-center">No offline punches need attention.</p>}
    {events.map(row=><article key={row.id} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{row.employee_name} · {OFFLINE_LABELS[row.event.kind]}</h2><a href={row.photo_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-[#C8102E] underline">View saved photo</a></div>
      <p className="text-sm"><strong>Actual time:</strong> {formatStoreDateTime(row.event.occurred_at)}</p>
      {row.event.kind.startsWith('forgot_')&&<p className="text-sm">Reason: {row.event.reason}</p>}
      <p className="rounded bg-amber-50 p-3 text-sm text-amber-950">{row.issue}</p>
      <p className="text-xs text-zinc-500">Photo taken {formatStoreDateTime(row.event.captured_at)} · Uploaded {formatStoreDateTime(row.received_at)}</p>
      <label className="block text-sm font-medium">How did you resolve this punch?<textarea value={notes[row.id] || ''} onChange={e=>setNotes({...notes,[row.id]:e.target.value})} maxLength={1000} className="mt-2 block w-full rounded-lg border p-3" placeholder="Corrected the timecard, or explain why this punch should not apply."/></label>
      <div className="flex flex-wrap gap-2"><button disabled={!!busy || (notes[row.id] || '').trim().length<3} onClick={()=>resolve(row,'apply')} className="min-h-11 rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy===row.id?'Saving…':'Apply saved punch'}</button>
      <button disabled={!!busy || (notes[row.id] || '').trim().length<3} onClick={()=>resolve(row)} className="min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">Mark handled</button></div>
      <p className="text-xs text-zinc-500">Marking handled saves your note. It does not change the employee’s hours.</p>
    </article>)}
    {count>events.length&&<p className="text-sm">Showing the first {events.length} of {count}. Handle these to see the next punches.</p>}
  </section>;
}
