"use client";

import { useEffect, useRef } from "react";
import { parseCorrectionTime } from "@/lib/clock-corrections";
import { toStoreDateTimeLocal } from "@/lib/store-time";

function elapsed(start,end) {
  const a=parseCorrectionTime(start), b=parseCorrectionTime(end);
  return a && b && b>a ? Math.round((Date.parse(b)-Date.parse(a))/60000) : null;
}
function duration(minutes) {
  if (minutes == null) return "Open";
  return `${Math.floor(minutes/60)}h ${minutes%60}m`;
}
function stamp(value) { return value ? toStoreDateTimeLocal(value).replace("T"," ") : "Open"; }
function HistoryState({state}) {
  return <div className="space-y-1">
    <p>{stamp(state.clock_in)} → {stamp(state.clock_out)}</p>
    {(state.breaks || []).map(row=><p key={row.id}>Break: {stamp(row.start)} → {stamp(row.end)}</p>)}
    {!state.breaks?.length && <p>No breaks</p>}
    <p>{duration(state.worked_minutes)} paid</p>
  </div>;
}

export default function PunchEditor({editing,setEditing,saving,error,onSave,onCancel}) {
  const dialogRef=useRef(null);
  useEffect(() => {
    const dialog=dialogRef.current;
    const previous=document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  },[]);
  const active=editing.breaks.filter(row=>!row.removed);
  const shift=elapsed(editing.clock_in,editing.clock_out);
  const breakMinutes=active.reduce((sum,row)=>sum+(elapsed(row.start,row.end)||0),0);
  const incompleteBreak=active.some(row=>elapsed(row.start,row.end)==null);
  const unpaid=editing.scheduled_unpaid ?? breakMinutes;
  const paid=shift==null || incompleteBreak ? null : Math.max(0,shift-unpaid);
  const inputClass="mt-1 block min-h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";
  const updateBreak=(key,patch)=>setEditing(s=>({...s,breaks:s.breaks.map(row=>row.key===key?{...row,...patch}:row)}));
  return <dialog ref={dialogRef} aria-labelledby="edit-punch-title" onCancel={event=>{event.preventDefault();if(!saving)onCancel();}}
    className="m-auto max-h-[92dvh] w-[calc(100%_-_1.5rem)] max-w-2xl overflow-auto rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-black/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
    <form onSubmit={onSave}>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
        <div><h3 id="edit-punch-title" className="font-bold text-[#C8102E]">Edit punch &amp; breaks</h3><p className="text-sm">{editing.name}</p></div>
        <button type="button" disabled={saving} onClick={onCancel} className="min-h-10 rounded-md border px-3 text-sm font-semibold">Cancel</button>
      </header>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800" aria-live="polite">
          <div><span className="block text-xs text-zinc-500">Shift duration</span><strong>{duration(shift)}</strong></div>
          <div><span className="block text-xs text-zinc-500">Break duration</span><strong>{duration(breakMinutes)}{incompleteBreak?" + open":""}</strong></div>
          <div><span className="block text-xs text-zinc-500">Paid duration</span><strong>{duration(paid)}</strong></div>
        </div>
        <p className="text-xs text-zinc-500">All times are restaurant time (Mountain). Leave clock-out blank for an open shift.</p>
        <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-xs font-semibold">Clock in<input required type="datetime-local" step="1" value={editing.clock_in} onChange={e=>setEditing(s=>({...s,clock_in:e.target.value}))} className={inputClass}/></label>
          <label className="min-w-0 text-xs font-semibold">Clock out<input type="datetime-local" step="1" value={editing.clock_out} onChange={e=>setEditing(s=>({...s,clock_out:e.target.value}))} className={inputClass}/></label>
        </fieldset>
        <section aria-label="Breaks" className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
          <div className="flex items-center justify-between"><h4 className="text-sm font-bold">Breaks <span className="font-normal text-zinc-500">· unpaid</span></h4>
            <button type="button" disabled={saving || active.length>=50} onClick={()=>setEditing(s=>({...s,breaks:[...s.breaks,{key:crypto.randomUUID(),id:null,start:"",end:""}]}))} className="min-h-10 rounded-md border border-[#C8102E] px-3 text-sm font-semibold text-[#C8102E]">+ Add break</button></div>
          {!editing.breaks.length && <p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-500 dark:bg-zinc-800">No breaks recorded.</p>}
          {editing.breaks.map((row,index)=><fieldset key={row.key} disabled={saving} className={`rounded-lg border p-3 ${row.removed ? "border-red-200 bg-red-50 dark:bg-red-950" : "border-zinc-200 dark:border-zinc-700"}`}>
            <div className="mb-2 flex items-center justify-between gap-2 text-sm"><strong>Break {index+1}{row.removed?" · removed":""}</strong>
              <button type="button" onClick={()=>updateBreak(row.key,{removed:!row.removed})} className="min-h-8 px-2 font-semibold text-[#C8102E]">{row.removed?`Undo remove break ${index+1}`:`Remove break ${index+1}`}</button></div>
            {row.removed?<p className="text-xs text-zinc-600">Removed when you save. The original times remain in correction history.</p>:<>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="min-w-0 text-xs font-semibold">Start break {index+1}<input required type="datetime-local" step="1" value={row.start} onChange={e=>updateBreak(row.key,{start:e.target.value})} className={inputClass}/></label>
                <label className="min-w-0 text-xs font-semibold">End break {index+1}<input required={Boolean(editing.clock_out)} type="datetime-local" step="1" value={row.end} onChange={e=>updateBreak(row.key,{end:e.target.value})} className={inputClass}/></label>
              </div><p className="mt-2 text-xs text-zinc-500">{duration(elapsed(row.start,row.end))}{!editing.clock_out?" · leave end blank if still on break":""}</p>
            </>}
          </fieldset>)}
          {editing.scheduled_unpaid!=null && <p className="text-xs text-amber-800">Current settings deduct {editing.scheduled_unpaid} scheduled break minutes. Recorded breaks are saved separately.</p>}
        </section>
        <label className="block text-xs font-semibold">Reason for correction<textarea required minLength={3} maxLength={1000} disabled={saving} rows={2} value={editing.note} onChange={e=>setEditing(s=>({...s,note:e.target.value}))} className="mt-1 block w-full rounded-md border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
        {editing.edits.length>0 && <details className="border-t pt-3 text-sm"><summary className="cursor-pointer font-semibold">Correction history ({editing.edits.length})</summary>
          {[...editing.edits].reverse().map(entry=><div key={entry.id} className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800"><p className="font-semibold">{entry.edited_by_name} · {stamp(entry.edited_at)}</p><p className="my-2">{entry.note}</p>
            <div className="grid gap-3 sm:grid-cols-2"><div><p className="mb-1 font-bold">Before</p><HistoryState state={entry.before_state}/></div><div><p className="mb-1 font-bold">After</p><HistoryState state={entry.after_state}/></div></div>
          </div>)}
        </details>}
        {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </div>
      <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-xs text-zinc-500">Changes require a new payroll review.</p>
        <button type="submit" disabled={saving} className="min-h-10 shrink-0 rounded-md bg-[#C8102E] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Save changes"}</button>
      </footer>
    </form>
  </dialog>;
}
