import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { attendanceExportOptions, buildAttendanceExport } from '../lib/attendance-export.js';
import { buildAttendanceReport } from '../lib/attendance-records.js';
import { payPeriodFor } from '../lib/timecard-review.js';
import { addDaysISO } from '../lib/store-time.js';

const now = new Date('2026-10-12T21:00:00Z');
const source = {
  now, from:'2026-10-11',to:'2026-10-12',
  employees:[{id:'a',first_name:'Alex',last_name:'Rivera',is_active:true},{id:'b',first_name:'Blair',last_name:'Jones',is_active:true},{id:'c',first_name:'Casey',last_name:'Cole',is_active:true}],
  weeks:[{week_start_date:'2026-10-11',status:'published'}],
  shifts:[{id:'s',employee_id:'a',employee_name:'Alex Rivera',shift_date:'2026-10-11',scheduled_start:'09:00:00',scheduled_end:'17:00:00'},
    {id:'t',employee_id:'b',employee_name:'Blair Jones',shift_date:'2026-10-11',scheduled_start:'09:00:00',scheduled_end:'17:00:00'}],
  punches:[{id:'p',employee_id:'a',employee_name:'Alex Rivera',clock_in:'2026-10-11T15:13:13Z',clock_out:'2026-10-11T22:21:02Z'}],
  events:[{id:'old',employee_id:'a',employee_name:'Alex Rivera',shift_id:'s',event_date:'2026-10-11',event_type:'no_show',auto_generated:true,note:'Saved, "manager" note\nSecond line'}],
};
const report = buildAttendanceReport(source);
function options(extra={}) { return attendanceExportOptions(new URLSearchParams({from:source.from,to:source.to,...extra}),now); }
function parse(csv) {
  const rows=[]; let row=[],cell='',quoted=false;
  const text=csv.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted&&text[i+1]==='"') { cell+='"'; i++; } else quoted=!quoted; }
    else if(c===','&&!quoted) { row.push(cell);cell=''; }
    else if(c==='\r'&&!quoted&&text[i+1]==='\n') { row.push(cell);rows.push(row);row=[];cell='';i++; }
    else cell+=c;
  }
  return rows;
}

test('everyone summary matches workspace counts, includes zero-activity employees and adds correct totals',()=>{
  const output=buildAttendanceExport(report,options());
  const rows=parse(output.csv);
  assert.ok(output.csv.startsWith('\uFEFF'));
  assert.deepEqual(rows[1],['Alex Rivera','1','1','0','0','1','0','0','0','0']);
  assert.deepEqual(rows[2],['Blair Jones','0','0','0','1','0','0','0','0','0']);
  assert.deepEqual(rows[3],['Casey Cole','0','0','0','0','0','0','0','0','0']);
  assert.deepEqual(rows[4],['PERIOD TOTAL','1','1','0','1','1','0','0','0','0']);
  assert.match(output.filename,/attendance-summary-everyone-2026-10-11-to-2026-10-12\.csv$/);
});
test('single and multiple selection exports include only requested employees and correct selected totals',()=>{
  for(const ids of [['a'],['a','c']]) {
    const params=new URLSearchParams({from:source.from,to:source.to,scope:'selected'});
    ids.forEach(id=>params.append('employee_id',id));
    const output=buildAttendanceExport(report,attendanceExportOptions(params,now));
    const rows=parse(output.csv);
    assert.ok(!output.csv.includes('Blair Jones'));
    assert.equal(rows.find(row=>row[0]==='PERIOD TOTAL')[4],'0');
    assert.equal(rows.filter(row=>['Alex Rivera','Casey Cole'].includes(row[0])).length,ids.length);
  }
  assert.throws(()=>buildAttendanceExport(report,options({scope:'selected',employee_id:'other-store-id'})),/unavailable/);
});
test('detailed exports retain seconds, notes, actual punches, and corrected no-show results',()=>{
  const output=buildAttendanceExport(report,options({type:'details',scope:'selected',employee_id:'a'}));
  const rows=parse(output.csv);
  assert.equal(rows[1][1],'Oct 11, 2026');
  assert.equal(rows[1][3],'9:13:13 AM – 4:21:02 PM');
  assert.equal(rows[1][4],'Worked');
  assert.equal(rows[1][5],'Late; Left early');
  assert.equal(rows[1][6],'13');
  assert.match(rows[1][10],/Saved, "manager" note\nSecond line/);
  assert.equal(rows[1].length,rows[0].length);
});
test('overnight punches include their end date and split punches stay in separate pairs',()=>{
  const r=structuredClone(report);
  r.employees[0].records[0].actual=[{clock_in:'2026-10-12T04:00:00Z',clock_out:'2026-10-12T08:00:00Z'}, {clock_in:'2026-10-12T09:00:00Z',clock_out:null}];
  const output=buildAttendanceExport(r,options({type:'details',scope:'selected',employee_id:'a'}));
  assert.match(output.csv,/10:00:00 PM – Oct 12, 2026 2:00:00 AM; Oct 12, 2026 3:00:00 AM – Still clocked in/);
});
test('CSV escaping neutralizes spreadsheet formulas and preserves Unicode names and commas',()=>{
  const r=structuredClone(report);
  r.employees[0].name=' =HYPERLINK("bad", "link")';
  r.employees[1].name='Zoë, García';
  const rows=parse(buildAttendanceExport(r,options()).csv);
  assert.ok(rows.some(row=>row[0]==='\' =HYPERLINK("bad", "link")'));
  assert.ok(rows.some(row=>row[0]==='Zoë, García'));
});
test('pay-period boundaries and rolling 30/60/90 windows preserve selected dates and clamp future data',()=>{
  const current=payPeriodFor('2026-10-12');
  assert.deepEqual(current,{from:'2026-10-11',to:'2026-10-24'});
  assert.deepEqual(payPeriodFor(addDaysISO(current.from,-14)),{from:'2026-09-27',to:'2026-10-10'});
  const partial=attendanceExportOptions(new URLSearchParams(current),now);
  const output=buildAttendanceExport(report,partial);
  assert.equal(partial.through,'2026-10-12');
  assert.equal(parse(output.csv).find(row=>row[0]==='Period')[1],'Oct 11, 2026 – Oct 24, 2026');
  assert.equal(parse(output.csv).find(row=>row[0]==='Data through')[1],'Oct 12, 2026');
  for(const days of [30,60,90]) {
    const range={from:addDaysISO('2026-10-12',-(days-1)),to:'2026-10-12'};
    const selected=attendanceExportOptions(new URLSearchParams(range),now);
    assert.equal((Date.parse(selected.to)-Date.parse(selected.from))/86400000+1,days);
  }
});
test('invalid dates, unknown report types and empty selections fail instead of exporting everyone',()=>{
  for(const input of [{type:'payroll'},{scope:'bad'},{scope:'selected'},{scope:'all',employee_id:'a'},{from:'2026-02-30'},{from:'2026-10-13'},{to:'2099-10-24'}]) {
    assert.throws(()=>options(input),error=>error.status===400);
  }
  const empty={...report,employees:[]};
  assert.deepEqual(parse(buildAttendanceExport(empty,options()).csv)[1],['PERIOD TOTAL','0','0','0','0','0','0','0','0','0']);
  assert.match(buildAttendanceExport(report,options({type:'details',scope:'selected',employee_id:'c'})).csv,/No attendance activity/);
});

let authorized=true, reads=0, seenRange;
const mocks={
  '@/lib/api-auth':{requireFeature:async feature=>{ assert.equal(feature,'timeclock.full'); return {error:authorized?null:Response.json({error:'Sign in required'},{status:401})}; }},
  '@/lib/security/http':{secureJson:(data,init)=>Response.json(data,init)},
  '@/lib/supabase-server':{getSupabaseServer:()=>({})},
  '@/lib/attendance':{attendanceReport:async(_db,from,to)=>{reads++;seenRange={from,to};return {report};}},
  '@/lib/attendance-export':{attendanceExportOptions,buildAttendanceExport},
};
globalThis.__attendanceExportMocks=mocks;
registerHooks({
  resolve(specifier,context,next) { return mocks[specifier]?{url:`attendance-export-test:${specifier}`,shortCircuit:true}:next(specifier,context); },
  load(url,context,next) {
    if(!url.startsWith('attendance-export-test:')) return next(url,context);
    const name=url.slice('attendance-export-test:'.length);
    return {format:'module',shortCircuit:true,source:`const mock=globalThis.__attendanceExportMocks[${JSON.stringify(name)}];`+Object.keys(mocks[name]).map(key=>`export const ${key}=mock.${key};`).join('\n')};
  },
});
const GET=(await import('../app/api/attendance/export/route.js')).GET;
test('download route requires attendance access before reading employee data',async()=>{
  authorized=false;reads=0;
  const result=await GET(new Request('https://synthetic.invalid/api/attendance/export'));
  assert.equal(result.status,401);assert.equal(reads,0);authorized=true;
});
test('download route returns private CSV and honors exact dates and employee selection',async()=>{
  const result=await GET(new Request('https://synthetic.invalid/api/attendance/export?from=2026-10-11&to=2026-10-12&type=details&scope=selected&employee_id=a'));
  assert.equal(result.status,200);
  assert.deepEqual(seenRange,{from:'2026-10-11',to:'2026-10-12'});
  assert.equal(result.headers.get('cache-control'),'private, no-store');
  assert.match(result.headers.get('content-disposition'),/attendance-details-alex-rivera/);
  const csv=await result.text();assert.ok(csv.includes('Alex Rivera'));assert.ok(!csv.includes('Blair Jones'));
  assert.equal((await GET(new Request('https://synthetic.invalid/api/attendance/export?scope=selected'))).status,400);
});
