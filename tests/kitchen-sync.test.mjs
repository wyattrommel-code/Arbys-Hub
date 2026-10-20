import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { storageSession } from '../lib/brink-storage.js';
import { getStoreToday, addDaysISO } from '../lib/store-time.js';
registerHooks({resolve(specifier,context,next){
  if(specifier==='server-only') return {url:'data:text/javascript,export {};',shortCircuit:true};
  if(specifier==='./supabase-server') return {url:'data:text/javascript,export function getSupabaseServer(){return globalThis.kitchenDb}',shortCircuit:true};
  return next(specifier,context);
}});
const {syncKitchenClaimed}=await import('../lib/brink-kitchen-server.js');
const {syncBrink}=await import('../lib/brink-server.js');
function setup(t,{fail=null,intentFailure=false,cached=true,enabled=true,stale=false}={}) {
  const previousFetch=globalThis.fetch, env={...process.env};
  Object.assign(process.env,{BRINK_API_HOST:'api-apiint.brinkpos.net',BRINK_ACCESS_TOKEN:'synthetic-access',BRINK_LOCATION_TOKEN:'synthetic-location',BRINK_ENVIRONMENT:'sandbox',BRINK_EMPLOYEE_LOOKUP_ENABLED:'false'});
  const state={enabled,queues:[],queues_fetched_at:cached?'2026-10-19T18:00:00Z':null,last_daily_date:addDaysISO(getStoreToday(),-1)};
  const calls=new Map(), snapshot={prior:true}, sales={saved:false}, requests=[];
  let attempt='owned';
  function query(table,rpc,args) {
    let method='select',payload,filter={};
    const q={select(){return q;},eq(k,v){filter[k]=v;return q;},maybeSingle(){return q;},limit(){return q;},order(){return q;},retry(){return q;},abortSignal(){return q;},
      update(p){method='update';payload=p;return q;},upsert(p){method='upsert';payload=p;return q;},
      then(resolve,reject){try {
        let data=null;
        if(rpc==='brink_claim_sync') {attempt=args.p_attempt;data=true;}
        else if(rpc==='brink_finish_sync') {sales.saved=true;data=true;}
        else if(rpc==='brink_finish_kitchen') {data=!stale&&args.p_attempt===attempt;if(data){snapshot.prior=false;snapshot.args=args;state.last_error=null;}}
        else if(table==='brink_kitchen_state') {if(method==='select')data={...state};else Object.assign(state,payload);}
        else if(table==='brink_api_calls') {
          if(method==='upsert') {if(intentFailure&&payload.operation) return resolve({error:{code:'42501'},status:403});calls.set(payload.id,{...payload});}
          else if(method==='update') Object.assign(calls.get(filter.id),payload);
          else data=[];
        }
        resolve({data,error:null});
      }catch(e){reject(e);}}
    };return q;
  }
  globalThis.kitchenDb={from:t=>query(t),rpc:(r,a)=>query(null,r,a)};
  globalThis.fetch=async(url,init)=>{
    const op=init.headers.SOAPAction.replaceAll('"','').split('/').at(-1);
    assert.ok([...calls.values()].some(c=>c.operation===op || (!c.operation&&op==='GetOrders')),'intent saved first');
    requests.push(op);
    const collection=op==='GetKitchenQueues'?'Collection':op==='GetOrderBumpTimes'?'OrderBumpTimes':op==='GetOrders'?'Orders':'OrderItemBumpTimes';
    return new Response(`<Envelope><Body><${op}Response><${op}Result><ResultCode>${op===fail?'4':'0'}</ResultCode><${collection}/></${op}Result></${op}Response></Body></Envelope>`);
  };
  t.after(()=>{globalThis.fetch=previousFetch;process.env=env;delete globalThis.kitchenDb;});
  const session=storageSession({report(){},sleep:async()=>{}});
  const options={config:{mode:'sandbox',host:'api-apiint.brinkpos.net',accessToken:'synthetic-access',locationToken:'synthetic-location',connection:'test'},date:getStoreToday(),attempt:'owned',session};
  return {options,calls,snapshot,state,requests,sales,session};
}
test('both successful kitchen methods atomically replace a snapshot with audited calls',async t=>{
  const s=setup(t,{cached:false});
  assert.equal((await syncKitchenClaimed(s.options)).ok,true);
  assert.deepEqual(s.requests,['GetKitchenQueues','GetOrderBumpTimes','GetOrderItemBumpTimes']);
  assert.equal(s.snapshot.prior,false); assert.equal(s.calls.size,3);
  assert.ok([...s.calls.values()].every(c=>c.status==='success'));
});
test('one method failing preserves the complete prior day and does not repeat queue settings',async t=>{
  const s=setup(t,{fail:'GetOrderItemBumpTimes'});
  await assert.rejects(syncKitchenClaimed(s.options),/result 4/);
  assert.equal(s.snapshot.prior,true); assert.match(s.state.last_error,/result 4/);
  assert.deepEqual(s.requests,['GetOrderBumpTimes','GetOrderItemBumpTimes']);
});
test('audit outage fails closed before contacting PAR',async t=>{
  const s=setup(t,{intentFailure:true});
  await assert.rejects(syncKitchenClaimed(s.options));
  assert.equal(s.requests.length,0); assert.equal(s.snapshot.prior,true);
});
test('disabled collection and insufficient time do not call PAR',async t=>{
  const s=setup(t,{enabled:false});
  assert.equal((await syncKitchenClaimed(s.options)).skipped,true);
  s.state.enabled=true;s.options.session.deadline=Date.now()+1000;
  assert.equal((await syncKitchenClaimed(s.options)).skipped,true);assert.equal(s.requests.length,0);
});
test('a kitchen error never turns saved sales into a failed sales run',async t=>{
  const s=setup(t,{fail:'GetOrderBumpTimes'});
  const result=await syncBrink(getStoreToday(),'automatic',{session:s.session,snapshotOnly:true,kitchen:true});
  assert.equal(s.sales.saved,true);assert.ok(result.kitchen.error);assert.equal(s.snapshot.prior,true);
  assert.equal([...s.calls.values()].find(c=>!c.operation).status,'success');
});
