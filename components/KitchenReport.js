'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getStoreToday, formatStoreDateTime, formatStoreTime } from '@/lib/store-time';
const endpoint='/api/integrations/brink/kitchen';
const duration=v=>v==null?'—':`${Math.floor(Math.round(v)/60)}:${String(Math.round(v)%60).padStart(2,'0')}`;
const box='rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900';
const button='rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50';
export default function KitchenReport() {
  const [date,setDate]=useState(()=>getStoreToday()), [data,setData]=useState(null), [error,setError]=useState('');
  const [busy,setBusy]=useState(false), [loading,setLoading]=useState(true), [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true); setError(''); setData(null);
    fetch(`${endpoint}?date=${date}`,{signal:controller.signal}).then(async r=>{const json=await r.json(); if(!r.ok) throw new Error(json.error); return json;})
      .then(setData).catch(e=>{if(e.name!=='AbortError') setError(e.message);}).finally(()=>{if(!controller.signal.aborted) setLoading(false);});
    return()=>controller.abort();
  },[date,refresh]);
  async function action(body) {
    setBusy(true); setError('');
    try {
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const json=await r.json(); if(!r.ok) throw new Error(json.error);
      setRefresh(n=>n+1);
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  const report=data?.report;
  return <section className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
    <div><Link href="/reports" className="text-sm text-[#C8102E]">← Reports</Link>
      <h1 className="mt-2 text-2xl font-bold">Kitchen timing &amp; deployments</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Compare station completion times with the staffing recorded in Deployment. Times run from send to bump; they include queue waiting and preparation. They do not measure drive-through car or window time.</p></div>
    <div className={box}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">Business date<input type="date" value={date} max={getStoreToday()} onChange={e=>setDate(e.target.value)} disabled={busy} className="mt-1 block rounded-lg border p-2 dark:bg-zinc-950" /></label>
        <button className={button} disabled={busy||loading} onClick={()=>setRefresh(n=>n+1)}>Refresh saved report</button>
        <button className={button} disabled={busy||loading||!data?.configured} onClick={()=>action({action:'sync',date})}>{busy?'Working…':'Sync this date from PAR'}</button>
        <Link className={`${button} text-[#C8102E]`} href="/deployment">Update deployment →</Link>
      </div>
      {data&&<div className="mt-4 text-sm"><p>{data.location} · {data.environment} · Last saved: {data.synced_at?formatStoreDateTime(data.synced_at):'No snapshot yet'} (Mountain time)</p>
        <p className="mt-1">Kitchen collection: <strong>{data.state?.enabled?'Enabled with automatic sales sync':'Off'}</strong></p>
        <button className={`${button} mt-2`} disabled={busy||!data.configured} onClick={()=>action({action:'configure',enabled:!data.state?.enabled})}>{data.state?.enabled?'Pause kitchen collection':'Enable kitchen collection'}</button>
        <p className="mt-2 text-zinc-500">Uses the existing sales schedule and shared two-minute cooldown. Reading this report makes no PAR calls. Sales continue if a kitchen request fails.</p>
      </div>}
    </div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {data?.state?.last_error&&<p className="rounded-lg bg-amber-50 p-3 text-amber-900">Latest kitchen sync issue: {data.state.last_error} The report below is the last saved snapshot.</p>}
    {loading?<p>Loading saved kitchen data…</p>:!report?<p className={box}>No saved kitchen data for this date. Enable collection or sync the date to start.</p>:<>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[[report.unique_orders,'Unique orders'],[report.order_events,'Order / queue / send events'],[report.item_events,'Item bump events'],[report.deployment_versions,'Deployment versions']].map(([value,label])=><div key={label} className={box}><p className="text-2xl font-bold">{value.toLocaleString()}</p><p className="text-sm text-zinc-500">{label}</p></div>)}</div>
      {!report.deployment_versions&&<p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">No timestamped deployments exist for this date. Station timings are available; employee comparisons begin only after coverage is recorded. Earlier shift summaries are not treated as timed assignments.</p>}
      <div className={box}><h2 className="font-bold">Station overview</h2><p className="mt-1 text-sm text-zinc-500">Minutes:seconds · P90 means 90% of measured events completed within that time. Empty or invalid durations are excluded, never counted as zero.</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b">{['Kitchen queue → Hub station','Orders / events','Average','Median','P90','Item average','Invalid'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>
          {report.queues.map(q=><tr key={q.id} className="border-b"><td className="p-2"><strong>{q.name}</strong><p className="text-xs text-zinc-500">{q.stations.join(' + ')||'Mapping unconfirmed'}</p></td><td className="p-2">{q.order.orders} / {q.order.events}</td><td className="p-2">{duration(q.order.average_seconds)}</td><td className="p-2">{duration(q.order.median_seconds)}</td><td className="p-2">{duration(q.order.p90_seconds)}</td><td className="p-2">{duration(q.item.average_seconds)} <span className="text-xs">({q.item.count})</span></td><td className="p-2">{q.order.invalid} order / {q.item.invalid} item</td></tr>)}
        </tbody></table></div>
      </div>
      {report.queues.filter(q=>q.order.events>0).map(q=><details key={q.id} className={box} open={q.name==='Drive Thru'}><summary className="cursor-pointer font-bold">{q.name} · Staffing and half-hour timing</summary>
        <p className="mt-2 text-sm text-zinc-500">Shared assignments show everyone assigned to this queue’s roles. A single assignment is recorded coverage, not proof that one person performed every action. Staffing changes and gaps stay unassigned.</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b">{['Coverage throughout event','Events','Average','Median','P90'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{q.staffing.map((g,i)=><tr key={i} className="border-b"><td className="p-2">{g.people.length?g.people.map(p=>p.name).join(' + '):g.status}<p className="text-xs text-zinc-500">{g.people.length?g.status:''}</p></td><td className="p-2">{g.events}</td><td className="p-2">{duration(g.average_seconds)}</td><td className="p-2">{duration(g.median_seconds)}</td><td className="p-2">{duration(g.p90_seconds)}</td></tr>)}</tbody></table></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b">{['Sent in half-hour starting','Orders','Events','Average','P90'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{q.periods.map(p=><tr key={p.start} className="border-b"><td className="p-2">{formatStoreTime(p.start)}</td><td className="p-2">{p.orders}</td><td className="p-2">{p.events}</td><td className="p-2">{duration(p.average_seconds)}</td><td className="p-2">{duration(p.p90_seconds)}</td></tr>)}</tbody></table></div>
        {q.order.over_30_minutes>0&&<p className="mt-3 text-sm text-amber-700">{q.order.over_30_minutes} events over 30 minutes are included. Review delayed bumps and order complexity before judging performance.</p>}
      </details>)}
      <p className="text-sm text-zinc-500">The same order may visit multiple queues or be resent; queue event counts are not sales counts. {report.exact_duplicates} exact duplicate records removed. Comparing averages alone does not establish which station caused a delay.</p>
    </>}
  </section>;
}
