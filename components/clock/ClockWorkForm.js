'use client';
import { WORK_REASONS, COVERAGE_OUTCOMES, coverageChoices, selectCoverage } from '@/lib/clock-work';
import { formatClock } from '@/lib/schedule';

export default function ClockWorkForm({ value, onChange, shifts = [], employeeId, at, manager = false, offline = false }) {
  const choices = coverageChoices(shifts,employeeId,at);
  const field = 'mt-1 block min-h-11 w-full rounded-xl border border-zinc-300 bg-white p-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100';
  const selected = shifts.find(s=>s.id===value.covered_shift_id);
  return <div className="my-3 space-y-3 text-left">
    {!manager && <fieldset><legend className="mb-2 font-semibold">Why are you clocking in?</legend>{Object.entries(WORK_REASONS).map(([reason,label])=><label key={reason} className="my-2 flex min-h-11 items-center gap-3 rounded-xl border border-zinc-300 px-3 py-2 dark:border-zinc-600"><input type="radio" name="work-reason" value={reason} checked={value.reason===reason} onChange={()=>onChange({...value,reason,covered_shift_id:'',start:'',end:'',absence:'unchanged'})} />{label}</label>)}</fieldset>}
    {manager && <p className="font-semibold">{WORK_REASONS[value.reason]}</p>}
    {value.reason==='covering' && <>
      {!manager ? <label className="block text-sm font-medium">Whose shift?<select className={field} value={value.covered_shift_id} onChange={e=>{const shift=choices.find(s=>s.id===e.target.value);onChange(shift?selectCoverage(value,shift,at):{...value,covered_shift_id:''});}}><option value="">Choose a shift</option>{choices.map(s=><option value={s.id} key={s.id}>{s.employee_name} · {formatClock(s.scheduled_start)}–{formatClock(s.scheduled_end)}{s.station||s.role?` · ${s.station||s.role}`:''}</option>)}</select></label> : <p>{selected?.employee_name || 'Selected shift'} · {selected ? `${formatClock(selected.scheduled_start)}–${formatClock(selected.scheduled_end)}` : ''}</p>}
      {!manager && !choices.length && <p className="text-sm text-zinc-600 dark:text-zinc-300">{offline?'No eligible shift is saved in this browser.':'No eligible shift is available.'} Choose “My schedule is incorrect” so the manager can record the details.</p>}
      {manager && <><p className="text-sm text-zinc-600 dark:text-zinc-300">Confirm the agreed coverage hours. These do not change the actual clock-in time.</p><label className="block text-sm font-medium">Coverage starts (restaurant time)<input className={field} type="datetime-local" value={value.start} onChange={e=>onChange({...value,start:e.target.value})} /></label><label className="block text-sm font-medium">Coverage ends (restaurant time)<input className={field} type="datetime-local" value={value.end} onChange={e=>onChange({...value,end:e.target.value})} /></label><label className="block text-sm font-medium">Original employee’s attendance<select className={field} value={value.absence} onChange={e=>onChange({...value,absence:e.target.value})}>{Object.entries(COVERAGE_OUTCOMES).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><p className="text-sm text-zinc-600 dark:text-zinc-300">Coverage alone does not excuse an absence. Only an approved swap removes that shift obligation.</p></>}
    </>}
    {(value.reason==='schedule_issue' || manager) && <label className="block text-sm font-medium">Note for the manager (optional)<textarea className={field} rows={2} maxLength={500} value={value.note} onChange={e=>onChange({...value,note:e.target.value})} /></label>}
  </div>;
}
