import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDefinitions, definitionsRequest, definitionDirectory, attachDefinitions } from '../lib/brink-definitions.js';
import { orderMatches, brinkOrderExport } from '../lib/brink-order-data.js';
const xml = '<Envelope><Body><GetDiscountsResponse><GetDiscountsResult><Discount><Id>779958009</Id><Name>$12 Employee Meal</Name><PrivateNotes>do-not-retain</PrivateNotes></Discount><Discount><Id>640220904</Id><Name>Manager Meal</Name></Discount></GetDiscountsResult></GetDiscountsResponse></Body></Envelope>';
const destination = '<Envelope><Body><GetDestinationsResponse><GetDestinationsResult><Destination><Id>640933890</Id><Name>DoorDash</Name></Destination></GetDestinationsResult></GetDestinationsResponse></Body></Envelope>';

test('Settings v1 contract: arrays, empty lists, XML escaping, allowlist and fail-closed malformed results', () => {
  const result = parseDefinitions(xml, 'GetDiscounts');
  assert.equal(result.entries.length, 2); assert.ok(!result.responseXml.includes('do-not-retain'));
  assert.deepEqual(parseDefinitions(result.responseXml, 'GetDiscounts').entries, result.entries);
  assert.deepEqual(parseDefinitions(xml.replace(/<Discount>.*<\/Discount>/, ''), 'GetDiscounts').entries, []);
  for (const bad of [xml.replace('<Id>640220904</Id>', '<Id>779958009</Id>'), xml.replace('GetDiscountsResult', 'Other'), xml.replace('<GetDiscountsResult>', '<GetDiscountsResult><ResultCode>1</ResultCode>'), '<!DOCTYPE x>'+xml,
    '<Envelope><Body><GetDiscountsResponse><GetDiscountsResult xmlns:i="x" i:nil="true"/></GetDiscountsResponse></Body></Envelope>']) {
    assert.throws(() => parseDefinitions(bad, 'GetDiscounts'));
  }
  assert.match(definitionsRequest('GetDiscounts', 'a<&', 'loc'), /<accessToken>a&lt;&amp;<\/accessToken>/);
  assert.match(definitionsRequest('GetDestinations'), /\[REDACTED\]/);
  assert.throws(() => definitionsRequest('SaveDiscounts'));
});

function setup(rows = [], failIntent = false) {
  const writes = [], filters = []; let calls = 0;
  const now = Date.parse('2026-09-25T18:00:00Z');
  const db = {from(){const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},upsert(v){writes.push(v);return q},update(v){writes.push(v);return q}};return q}};
  const options = { operation:'GetDiscounts', config:{connection:'sandbox-a', mode:'sandbox',host:'api-apiint.brinkpos.net',accessToken:'private-access',locationToken:'private-location'},
    db, now:()=>now, deadline:now+20000,date:'2026-09-25',source:'automatic',version:'test',
    run:async(stage,build)=>{if(failIntent && stage.endsWith('-intent')) throw Error('cannot log');build();return {data:rows}},
    fetcher:async(url,init)=>{calls++;assert.match(url,/Settings\.svc$/);assert.equal(init.redirect,'error');assert.equal(init.headers.AccessToken,undefined);assert.match(init.body,/<accessToken>private-access<\/accessToken>/);return new Response(xml)} };
  return {options,writes,filters,count:()=>calls};
}
test('lookups log redacted evidence and only refresh twice daily, scoped to connection and operation',async()=>{
  const a=setup();const result=await definitionDirectory(a.options);assert.equal(result.entries.length,2);assert.equal(a.count(),1);
  assert.ok(a.filters.some(([k,v])=>k==='connection_id'&&v==='sandbox-a'));
  assert.ok(a.filters.some(([k,v])=>k==='operation'&&v==='GetDiscounts'));
  assert.equal(a.writes.at(-1).status,'success');assert.equal(a.writes.at(-1).result_code,undefined);
  assert.ok(!JSON.stringify(a.writes).includes('private-'));assert.ok(!JSON.stringify(a.writes).includes('do-not-retain'));
  for (const status of ['success','error','started']) {
    const b=setup([{status,started_at:'2026-09-25T17:00:00Z',response_xml:a.writes.at(-1).response_xml}]);
    await definitionDirectory(b.options);assert.equal(b.count(),0);
  }
  const c=setup();await definitionDirectory({...c.options,cacheOnly:true});assert.equal(c.count(),0);
  const d=setup([],true);await assert.rejects(definitionDirectory(d.options));assert.equal(d.count(),0);
  const e=setup();await definitionDirectory({...e.options,deadline:e.options.now()+7000});assert.equal(e.count(),0);
});
test('SOAP faults redact secrets, retain prior cache and do not fabricate ResultCode or zero sales',async()=>{
  const a=setup([{status:'success',started_at:'2026-09-24T18:00:00Z',response_xml:xml}]);
  a.options.fetcher=async()=>new Response('<Envelope><Body><Fault><faultstring>Denied private-access private-location</faultstring><detail>private-data</detail></Fault></Body></Envelope>',{status:500});
  const result=await definitionDirectory(a.options);assert.equal(result.entries.length,2);
  assert.equal(a.writes.at(-1).status,'error');assert.equal(a.writes.at(-1).http_status,500);
  assert.ok(!JSON.stringify(a.writes).includes('private-'));
  assert.match(a.writes.at(-1).error,/Denied/);
});
test('enrichment joins definition IDs, preserves amounts and transaction names, leaves unknowns unresolved, searches/exports labels',()=>{
  const orders=[{number:'113',destination_id:'640933890',net_sales:0,items:[],discounts:[{id:'2',definition_id:'779958009',amount:6.59,name:''},{definition_id:'unknown',name:''},{definition_id:'640220904',name:'Historical name',amount:1}]}];
  attachDefinitions(orders,'GetDiscounts',{...parseDefinitions(xml,'GetDiscounts'),fetched_at:'2026-09-25T18:00:00Z'});
  attachDefinitions(orders,'GetDestinations',{...parseDefinitions(destination,'GetDestinations'),fetched_at:'2026-09-25T18:00:00Z'});
  assert.equal(orders[0].discounts[0].name,'$12 Employee Meal');assert.equal(orders[0].discounts[0].amount,6.59);
  assert.equal(orders[0].discounts[1].name,'');assert.equal(orders[0].discounts[2].name,'Historical name');
  assert.equal(orders[0].destination_name,'DoorDash');assert.equal(orders[0].net_sales,0);
  assert.ok(orderMatches(orders[0],'doordash'));assert.ok(orderMatches(orders[0],'employee meal'));
  assert.equal(brinkOrderExport({day:{orders}}).orders[0].destination_name_source,'Settings.GetDestinations');
});
