import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKitchenResponse, fetchKitchen } from '../lib/brink-kitchen.js';
import { kitchenReport, staffingFor, queueStations } from '../lib/kitchen-report.js';
import { validateDeployment } from '../lib/deployment-validation.js';
const op='GetOrderBumpTimes';
const envelope=(rows='',code='0')=>`<s:Envelope xmlns:s="urn:test"><s:Body><${op}Response><${op}Result><ResultCode>${code}</ResultCode><Message>AccessToken=secret-access unavailable</Message><OrderBumpTimes>${rows}</OrderBumpTimes></${op}Result></${op}Response></s:Body></s:Envelope>`;
const row='<OrderBumpTime><OrderId>9223372036854775806</OrderId><KitchenQueueId>4</KitchenQueueId><SendNumber>1</SendNumber><SendTime><DateTime>2026-10-20T18:00:00Z</DateTime><OffsetMinutes>-360</OffsetMinutes></SendTime><BumpTime><DateTime>2026-10-20T18:02:00Z</DateTime></BumpTime></OrderBumpTime>';
test('kitchen parser preserves IDs, UTC and only removes exact duplicates',()=>{
  const parsed=parseKitchenResponse(envelope(row+row),op);
  assert.equal(parsed.records.length,1); assert.equal(parsed.duplicate_count,1);
  assert.equal(parsed.records[0].order_id,'9223372036854775806');
  assert.equal(parsed.records[0].sent_at,'2026-10-20T18:00:00.000Z');
  assert.equal(parsed.records[0].first_sent_at,null);
  assert.equal(parseKitchenResponse(envelope(row+row.replace('<SendNumber>1','<SendNumber>2')),op).records.length,2);
  assert.deepEqual(parseKitchenResponse(envelope(),op).records,[]);
});
test('malformed, missing and nil collections fail instead of erasing snapshots',()=>{
  for(const xml of ['bad','<!DOCTYPE a>'+envelope(),envelope().replace('<OrderBumpTimes></OrderBumpTimes>',''),envelope().replace('<OrderBumpTimes></OrderBumpTimes>','<OrderBumpTimes xmlns:i="urn:test" i:nil="true"/>'),envelope(row.replace('18:00:00Z','18:00:00'))]) assert.throws(()=>parseKitchenResponse(xml,op));
});
test('HTTP 200 with a PAR error retains a redacted error and result code',async()=>{
  const evidence={};
  await assert.rejects(fetchKitchen({config:{mode:'sandbox',host:'api-apiint.brinkpos.net',accessToken:'secret-access',locationToken:'secret-location'},date:'2026-10-20',operation:op,evidence,fetcher:async()=>new Response(envelope('','4'))}),/result 4/);
  assert.equal(evidence.http_status,200); assert.equal(evidence.result_code,'4');
  assert.ok(evidence.response_sha256); assert.ok(!evidence.response_xml.includes('secret-access'));
});
const bump={order_id:'1',queue_id:'4',send_number:'1',sent_at:'2026-10-20T18:00:00Z',bumped_at:'2026-10-20T18:02:00Z'};
const person=(id,stations=['Fryer'])=>({employee_id:id,employee_name:`Person ${id}`,stations});
const version=(at,assignments)=>({log_date:'2026-10-20',effective_at:at,assignments});
test('staffing must cover the entire interval and all mapped roles',()=>{
  const initial=version('2026-10-20T17:00:00Z',[person('a')]);
  assert.equal(staffingFor(bump,['Fryer'],[]).status,'no deployment');
  assert.equal(staffingFor(bump,['Fryer'],[initial]).status,'single assignment');
  assert.equal(staffingFor(bump,['Fryer'],[initial,version('2026-10-20T18:01:00Z',[person('b')])]).status,'staffing changed');
  assert.equal(staffingFor(bump,['Fryer'],[initial,version('2026-10-20T18:02:00Z',[])]).status,'staffing changed');
  assert.equal(staffingFor(bump,['Fryer'],[initial,version('2026-10-20T18:03:00Z',[])]).status,'single assignment');
  assert.equal(staffingFor(bump,['Fryer'],[version('2026-10-20T18:01:00Z',[person('a')])]).status,'no deployment');
  assert.equal(staffingFor(bump,['Fryer'],[initial,version('2026-10-20T18:01:00Z',[person('a'),person('b',['Front'])])]).status,'single assignment');
  assert.equal(staffingFor(bump,queueStations('Slicer'),[version('2026-10-20T17:00:00Z',[person('a',['Slicer'])])]).status,'partial coverage');
  assert.equal(staffingFor(bump,queueStations('Drive Thru'),[version('2026-10-20T17:00:00Z',[person('a',['DT Cashier']),person('b',['DT Order Taker'])])]).status,'shared assignment');
  assert.deepEqual(queueStations('Market Fresh'),[]);
});
test('missing, conflicting and negative durations never enter speed averages; resends remain separate',()=>{
  const other={...bump,send_number:'2',bumped_at:'2026-10-20T18:04:00Z'};
  const rows=[bump,other,{...bump,order_id:'2',sent_at:null},{...bump,order_id:'3',bumped_at:'2026-10-20T17:00:00Z'}];
  const report=kitchenReport({order_bumps:rows,item_bumps:[]},[{id:'4',name:'Fry'}],[]);
  assert.equal(report.unique_orders,3); assert.equal(report.order_events,4);
  assert.equal(report.queues[0].order.count,2); assert.equal(report.queues[0].order.invalid,2);
  assert.equal(report.queues[0].order.average_seconds,180);
  const conflict=kitchenReport({order_bumps:[bump,{...bump,bumped_at:other.bumped_at}],item_bumps:[]});
  assert.equal(conflict.queues[0].order.count,0);
});
test('deployment identity is roster-owned, requires active store employee and supports closing coverage',()=>{
  const id='11111111-1111-4111-8111-111111111111', roster=[{id,store_id:'07462',is_active:true,status:'active',first_name:'Test',last_name:'Crew'}];
  const body={id,date:'2026-10-20',shift:'Morning',base:null,assignments:[{employee_id:id,employee_name:'Spoofed',stations:['Fryer'],notes:''}]};
  const now=new Date('2026-10-20T18:00:00Z');
  assert.equal(validateDeployment(body,roster,now).assignments[0].employee_name,'Test Crew');
  assert.throws(()=>validateDeployment({...body,effective_at:'2026-10-20T19:00:00Z'},roster,now),/future/);
  assert.throws(()=>validateDeployment(body,[{...roster[0],store_id:'other'}],now),/active employee/);
  assert.throws(()=>validateDeployment({...body,assignments:[...body.assignments,...body.assignments]},roster,now),/once/);
  assert.deepEqual(validateDeployment({...body,assignments:[]},roster,now).assignments,[]);
});
