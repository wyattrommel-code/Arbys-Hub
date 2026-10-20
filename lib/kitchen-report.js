import { getStoreToday, addDaysISO, storeWallClockToDate } from './store-time';

export const DEPLOYMENT_STATIONS = ['DT Order Taker','DT Cashier','Runner','Front','Fryer','Slicer','Backline','Floater'];
// Store manager's confirmed physical mapping. Unknown/combined queues stay visible.
export function queueStations(name) {
  return ({ dt:['DT Cashier','DT Order Taker'], 'drive thru':['DT Cashier','DT Order Taker'],
    'dt expo':['Runner'], expo:['Runner'], fryer:['Fryer'], fry:['Fryer'], slicer:['Backline','Slicer'] })[String(name || '').trim().toLowerCase()] || [];
}
const ms = value => value ? Date.parse(value) : NaN;
function coverage(version, stations) {
  const people = (version?.assignments || []).filter(a => a.stations.some(s => stations.includes(s)))
    .map(a => ({ id:a.employee_id, name:a.employee_name, stations:a.stations.filter(s=>stations.includes(s)).sort() }))
    .sort((a,b)=>a.id.localeCompare(b.id));
  return { people, complete:stations.every(s=>people.some(p=>p.stations.includes(s))),
    signature:JSON.stringify(people.map(p=>[p.id,p.stations])) };
}
export function staffingFor(bump, stations, versions) {
  if (!stations.length) return {status:'unmapped',people:[]};
  const start=ms(bump.sent_at), end=ms(bump.bumped_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end<start) return {status:'invalid timing',people:[]};
  const date=getStoreToday(new Date(start));
  const timeline=versions.filter(v=>v.log_date===date).sort((a,b)=>ms(a.effective_at)-ms(b.effective_at));
  const current=timeline.filter(v=>ms(v.effective_at)<=start).at(-1);
  if (!current) return {status:'no deployment',people:[]};
  const initial=coverage(current,stations);
  const changed=timeline.some(v=>ms(v.effective_at)>start && ms(v.effective_at)<=end && coverage(v,stations).signature!==initial.signature);
  const dayEnd=storeWallClockToDate(addDaysISO(date,1),'00:00:00').getTime();
  if (changed || end>=dayEnd) return {status:'staffing changed',people:initial.people};
  if (!initial.complete) return {status:'partial coverage',people:initial.people};
  return {status:initial.people.length===1?'single assignment':'shared assignment',people:initial.people};
}
export function timingStats(values) {
  const sorted=values.slice().sort((a,b)=>a-b), n=sorted.length;
  return {count:n, average_seconds:n?sorted.reduce((a,b)=>a+b,0)/n:null,
    median_seconds:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null,
    p90_seconds:n?sorted[Math.ceil(n*.9)-1]:null};
}
function aggregate(rows) {
  return {...timingStats(rows.filter(r=>r.seconds!=null).map(r=>r.seconds)), events:rows.length,
    orders:new Set(rows.map(r=>r.order_id)).size, invalid:rows.filter(r=>r.seconds==null).length,
    over_30_minutes:rows.filter(r=>r.seconds>1800).length};
}
export function kitchenReport(day, queues=[], versions=[]) {
  const prepare=(records, items=false)=>{
    const identities=new Map();
    for (const r of records) {
      const key=JSON.stringify([r.order_id,r.queue_id,r.send_number,items?r.item_id:null]);
      identities.set(key,(identities.get(key)||0)+1);
    }
    return records.map(r=>{
      const key=JSON.stringify([r.order_id,r.queue_id,r.send_number,items?r.item_id:null]);
      const elapsed=(ms(r.bumped_at)-ms(r.sent_at))/1000;
      const invalid=identities.get(key)>1 || !Number.isFinite(elapsed) || elapsed<0;
      return {...r, seconds:invalid?null:elapsed};
    });
  };
  const orders=prepare(day?.order_bumps||[]), items=prepare(day?.item_bumps||[],true);
  const ids=[...new Set([...queues.map(q=>q.id),...orders.map(r=>r.queue_id),...items.map(r=>r.queue_id)])];
  return {unique_orders:new Set(orders.map(o=>o.order_id)).size, order_events:orders.length,item_events:items.length,
    deployment_versions:versions.length, exact_duplicates:day?.exact_duplicates||0,
    queues:ids.map(id=>{
      const name=queues.find(q=>q.id===id)?.name||`Queue ${id}`, stations=queueStations(name);
      const rows=orders.filter(r=>r.queue_id===id).map(r=>({...r, staffing:r.seconds==null?{status:'invalid timing',people:[]}:staffingFor(r,stations,versions)}));
      const groups=new Map(), periods=new Map();
      for (const r of rows) {
        const match=['single assignment','shared assignment'].includes(r.staffing.status);
        const key=JSON.stringify([r.staffing.status,match?r.staffing.people.map(p=>p.id):[]]);
        if (!groups.has(key)) groups.set(key,{status:r.staffing.status,people:match?r.staffing.people:[],rows:[]});
        groups.get(key).rows.push(r);
        if (Number.isFinite(ms(r.sent_at))) {
          const bucket=new Date(Math.floor(ms(r.sent_at)/1800000)*1800000).toISOString();
          if (!periods.has(bucket)) periods.set(bucket,[]);
          periods.get(bucket).push(r);
        }
      }
      return {id,name,stations,order:aggregate(rows),item:aggregate(items.filter(r=>r.queue_id===id)),
        staffing:[...groups.values()].map(g=>({status:g.status,people:g.people,...aggregate(g.rows)})),
        periods:[...periods].sort(([a],[b])=>a.localeCompare(b)).map(([start,rs])=>({start,...aggregate(rs)}))};
    }).sort((a,b)=>a.name.localeCompare(b.name))};
}
