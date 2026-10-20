import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { roastUsage, salesForDay, storeToday, salesUpdatedLabel } from '../public/store-sales.mjs';

const date = '2026-10-19';
const row = (hour, amount, day = date) => ({ sale_date: day, hour_of_day: hour, net_sales: amount, updated_at: '2026-10-20T18:56:14Z' });
const actual = [0,0,0,0,0,0,0,6.79,49.3,20.56,59.38,292.48,446.12,259.93,192.54,231.77,222.83,180.59,403.62,214.49,111.2,92.88,0,0].map((n,h)=>row(h,n));

test('reconciled Oct 19 daily sales and nonoverlapping shifts match to the cent', () => {
  const sales = salesForDay(actual, date);
  assert.equal(sales.total, 2784.48);
  assert.equal(sales.am, 1134.56);
  assert.equal(sales.pm, 1649.92);
  assert.equal(sales.windows['6am'], 1134.56);
  assert.equal(sales.windows['10am'], 1885.64);
  assert.equal(sales.windows['2pm'], 1649.92);
  assert.equal(sales.windows['5pm'], 1002.78);
  assert.equal(sales.updatedAt, '2026-10-20T18:56:14Z');
});

test('overnight sales stay on their business date and refunds retain their signs', () => {
  const sales = salesForDay([row(0,10),row(1,2),row(9,0.1),row(10,0.2),row(14,-3),row(17,5),row(0,999,'2026-10-20')],date);
  assert.equal(sales.total,14.3);
  assert.equal(sales.am,0.3);
  assert.equal(sales.pm,14);
  assert.equal(sales.windows['5pm'],15);
});

test('missing dates are absent, while valid zero and negative sales remain real data', () => {
  assert.equal(salesForDay(actual,'2026-10-20'),null);
  assert.equal(salesForDay([row(24,9),row(8,null)],date),null);
  assert.equal(salesForDay([row(8,0)],date).total,0);
  assert.equal(salesForDay([row(8,-5)],date).total,-5);
  assert.equal(storeToday(new Date('2026-10-20T03:00:00Z')),'2026-10-19');
});

test('incomplete roast counts cannot become usage or imply that missing stock was sold', () => {
  const morning = [
    {daypart:'6am',on_hand:1,put_in:4},
    {daypart:'10am',on_hand:null,put_in:null},
    {daypart:'2pm',on_hand:null,put_in:null},
  ];
  assert.equal(roastUsage(morning).totalRoastUsed,null);
  assert.equal(roastUsage(morning).usedAm,null);
  assert.equal(roastUsage(morning).ohClose,null);
  morning[1] = {daypart:'10am',on_hand:3,put_in:2};
  morning[2] = {daypart:'2pm',on_hand:1,put_in:0};
  assert.equal(roastUsage(morning).usedAm,6);
  assert.equal(roastUsage(morning).usedPm,null);
  assert.equal(roastUsage(morning).totalRoastUsed,null);
  morning.push({daypart:'5pm',on_hand:0,put_in:1},{daypart:'close',on_hand:0});
  assert.equal(roastUsage(morning).usedPm,2);
  assert.equal(roastUsage(morning).totalRoastUsed,8);
});

test('explicit zero roast counts are valid; blank and invalid counts stay unknown', () => {
  const rows = ['6am','10am','2pm','5pm','close'].map(daypart=>({daypart,on_hand:0,put_in:0}));
  assert.equal(roastUsage(rows).totalRoastUsed,0);
  for (const missing of ['',null,undefined,'invalid',-1]) {
    rows[0].on_hand=missing;
    assert.equal(roastUsage(rows).usedAm,null);
    assert.equal(roastUsage(rows).usedPm,0);
  }
});

function sheet() {
  const html = fs.readFileSync(new URL('../lib/roast-beef-sheet-template.html',import.meta.url),'utf8');
  const code = html.split('<script type="module">')[1].split('</script>')[0]
    .replace(/^import .*;$/m,'').replace('__NEXT_PUBLIC_SUPABASE_URL_JSON__','"test"')
    .replace('__NEXT_PUBLIC_SUPABASE_ANON_KEY_JSON__','"test"').replace(/\binit\(\);\s*$/, '');
  const ctx = vm.createContext({salesForDay,storeToday,salesUpdatedLabel,console,
    document:{hidden:false,activeElement:null},actual,Date});
  vm.runInContext(code,ctx);
  return {ctx,run:code=>vm.runInContext(code,ctx)};
}

test('roast forecasts use business-date hours; daily projection never adds overlapping windows', () => {
  const {run} = sheet();
  run('importedSalesRows=actual; mergeHourlySalesRowsIntoSalesByDate(actual);');
  assert.equal(run("totalForecastSalesForTemperingDay('2026-10-26')"),2784.48);
  assert.equal(run("dayTotal('2026-10-18')"),0);
  run("mergeHourlySalesRowsIntoSalesByDate([{sale_date:'2026-10-19',hour_of_day:0,net_sales:10},{sale_date:'2026-10-19',hour_of_day:17,net_sales:5},{sale_date:'2026-10-20',hour_of_day:0,net_sales:999}]);");
  assert.equal(run("windowSales('2026-10-19',17,24,1)"),15);
});

test('roast sales refresh is read-only and preserves crew entries and previous good data on failure', async () => {
  const {ctx,run} = sheet();
  const calls=[];
  let fail=false;
  ctx.fakeHub={from(table){calls.push(table);const q={select(){return q;},gte(){return q;},lte(){return Promise.resolve(fail?{error:{message:'Offline'}}:{data:actual});}};return q;}};
  run("hub=fakeHub; recalcSheet=()=>{}; ensureSheetState('2026-10-19'); sheetState['2026-10-19'].rows[0]={onHandStr:'3',putIn:2,actualStr:'17'};");
  await run('refreshSales()');
  assert.deepEqual(calls,['hourly_sales']);
  assert.equal(run("dayTotal('2026-10-19')"),2784.48);
  assert.equal(run("JSON.stringify(sheetState['2026-10-19'].rows[0])"),JSON.stringify({onHandStr:'3',putIn:2,actualStr:'17'}));
  fail=true; await run('refreshSales()');
  assert.equal(run('salesReadFailed'),true);
  assert.equal(run("dayTotal('2026-10-19')"),2784.48);
  ctx.document.activeElement={tagName:'INPUT'};
  await run('refreshSales()');
  assert.equal(calls.length,2);
});
