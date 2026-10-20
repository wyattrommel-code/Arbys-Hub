import { DEPLOYMENT_STATIONS } from './kitchen-report';
import { getStoreToday, addDaysISO } from './store-time';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function validateDeployment(body, roster, now=new Date()) {
  const date=body?.date, today=getStoreToday(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date||'') || date>today || date<addDaysISO(today,-14) || new Date(`${date}T12:00Z`).toISOString().slice(0,10)!==date) fail('Choose a valid date within the last 14 days.');
  if (!uuid.test(body.id||'') || (body.base!=null&&!uuid.test(body.base)) || !['Morning','Night'].includes(body.shift)) fail('Invalid deployment request.');
  let effective=null;
  if (body.effective_at) {
    if (typeof body.effective_at!=='string' || !/Z$/.test(body.effective_at) || !Number.isFinite(Date.parse(body.effective_at))) fail('Enter a valid effective time.');
    effective=new Date(body.effective_at);
  }
  if (getStoreToday(effective||now)!==date || (effective&&effective>now)) fail('The effective time must be on the selected date and cannot be in the future.');
  if (!Array.isArray(body.assignments) || body.assignments.length>100) fail('Invalid assignments.');
  const seen=new Set();
  const assignments=body.assignments.map(a=>{
    const employee=roster.find(e=>e.id===a.employee_id && e.store_id==='07462' && e.is_active && !['inactive','terminated'].includes(e.status));
    if (!employee || seen.has(employee.id)) fail('Choose each active employee once from the roster. Reload if the roster changed.');
    seen.add(employee.id);
    if (!Array.isArray(a.stations) || !a.stations.length || a.stations.some(s=>!DEPLOYMENT_STATIONS.includes(s))) fail('Choose valid stations.');
    if (typeof a.notes!=='string' || a.notes.length>500) fail('Notes must be 500 characters or fewer.');
    return {employee_id:employee.id,employee_name:`${employee.first_name||''} ${employee.last_name||''}`.trim(),stations:[...new Set(a.stations)].sort(),notes:a.notes.trim()};
  }).sort((a,b)=>a.employee_id.localeCompare(b.employee_id));
  return {id:body.id,date,shift:body.shift,effective_at:effective?.toISOString()||null,base:body.base||null,assignments};
}
