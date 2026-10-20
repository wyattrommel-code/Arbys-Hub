import 'server-only';
import { randomUUID } from 'node:crypto';
import { getSupabaseServer } from './supabase-server';
import { brinkConfig, BrinkError, validBusinessDate } from './brink';
import { storageSession } from './brink-storage';
import { fetchKitchen, kitchenRequest } from './brink-kitchen';
import { kitchenReport } from './kitchen-report';
import { getStoreToday, addDaysISO, getStoreMinutes } from './store-time';
const VERSION='2026-10-20.kitchen.1';
function checkDate(date) {
  if(!validBusinessDate(date) || date>getStoreToday() || date<addDaysISO(getStoreToday(),-90)) throw new BrinkError('Choose a business date within the past 90 days.',400);
}
export async function kitchenStatus(date) {
  checkDate(date);
  const config=brinkConfig(), db=getSupabaseServer(), {run}=storageSession();
  const [state,day,deployments]=await Promise.all([
    run('kitchen-state',()=>db.from('brink_kitchen_state').select('*').eq('connection_id',config.connection).maybeSingle()),
    run('kitchen-day',()=>db.from('brink_kitchen_days').select('*').eq('connection_id',config.connection).eq('business_date',date).maybeSingle()),
    run('kitchen-deployments',()=>db.from('deployment_versions').select('*').eq('store_id','payson').eq('log_date',date).order('effective_at').limit(1000)),
  ]);
  return {environment:config.mode,location:config.label,date,configured:config.configured,state:state.data,
    synced_at:day.data?.synced_at||null,report:day.data?kitchenReport(day.data,state.data?.queues,config.mode==='production'?deployments.data:[]):null};
}
export async function configureKitchen(enabled) {
  if(typeof enabled!=='boolean') throw new BrinkError('Invalid setting.',400);
  const config=brinkConfig(); if(!config.configured) throw new BrinkError('Configure PAR first.',503);
  await storageSession().run('configure-kitchen',()=>getSupabaseServer().from('brink_kitchen_state').upsert({connection_id:config.connection,enabled}));
  return {enabled};
}
// Receives the sales job's already-owned claim; never starts a competing timer.
// Kitchen errors have their own state and cannot invalidate a saved sales day.
export async function syncKitchenClaimed({config,date,attempt,session,source='automatic',force=false}) {
  const db=getSupabaseServer(), run=session.run;
  const state=await run('kitchen-config',()=>db.from('brink_kitchen_state').select('*').eq('connection_id',config.connection).maybeSingle());
  if(!force && !state.data?.enabled) return {skipped:true};
  if(session.deadline-Date.now()<18000) return {skipped:true,reason:'Sales used this run’s time budget. Kitchen will retry on the next scheduled run.'};
  const yesterday=addDaysISO(getStoreToday(),-1);
  const reconcile=!force && getStoreMinutes()>=360 && state.data?.last_daily_date!==yesterday;
  if(reconcile) date=yesterday;
  await run('kitchen-attempt',()=>db.from('brink_kitchen_state').upsert({connection_id:config.connection,last_attempt_at:new Date().toISOString()}));
  async function call(operation) {
    const id=randomUUID(), started=Date.now(), evidence={}, request=kitchenRequest(operation,date);
    await run(`${operation}-intent`,()=>db.from('brink_api_calls').upsert({id,connection_id:config.connection,environment:config.mode,business_date:date,
      operation,source,endpoint:`https://${config.host}/${request.service}.svc`,request_xml:request.body,integration_version:VERSION},{onConflict:'id',ignoreDuplicates:true}));
    try {
      const budget=session.deadline-Date.now()-6000;
      if(budget<1000) throw new BrinkError('Kitchen time budget exhausted before contacting PAR.',503);
      const result=await fetchKitchen({config,date,operation,evidence,timeout:Math.min(15000,budget)});
      await run(`${operation}-success`,()=>db.from('brink_api_calls').update({...evidence,status:'success',finished_at:new Date().toISOString(),duration_ms:Date.now()-started}).eq('id',id));
      return result;
    } catch(err) {
      const safe=err instanceof BrinkError?err:new BrinkError('Kitchen request could not complete. Previous timing data was preserved.');
      try { await run(`${operation}-error`,()=>db.from('brink_api_calls').update({...evidence,status:'error',error:safe.message,finished_at:new Date().toISOString(),duration_ms:Date.now()-started}).eq('id',id)); } catch { /* Preserve the initial audit intent if storage is down. */ }
      throw safe;
    }
  }
  try {
    // Queue names are settings, cached until an explicit configuration change.
    if(!state.data?.queues_fetched_at) {
      const queues=await call('GetKitchenQueues');
      await run('save-queues',()=>db.from('brink_kitchen_state').update({queues:queues.records,queues_fetched_at:new Date().toISOString()}).eq('connection_id',config.connection));
    }
    // Two concurrent read-only calls, below PAR's five-call concurrency limit.
    const results=await Promise.allSettled([call('GetOrderBumpTimes'),call('GetOrderItemBumpTimes')]);
    const failed=results.find(r=>r.status==='rejected'); if(failed) throw failed.reason;
    const [orders,items]=results.map(r=>r.value);
    const saved=await run('save-kitchen',()=>db.rpc('brink_finish_kitchen',{p_connection:config.connection,p_attempt:attempt,p_date:date,p_environment:config.mode,
      p_orders:orders.records,p_items:items.records,p_duplicates:orders.duplicate_count+items.duplicate_count}));
    if(!saved.data) throw new BrinkError('A newer PAR run started. Previous timing data was preserved.',409);
    if(reconcile) await run('kitchen-reconciliation',()=>db.from('brink_kitchen_state').update({last_daily_date:date}).eq('connection_id',config.connection));
    return {ok:true,business_date:date,orders:orders.records.length,items:items.records.length};
  } catch(err) {
    const safe=err instanceof BrinkError?err:new BrinkError('Kitchen sync failed. Previous timing data was preserved.');
    try { await run('kitchen-error',()=>db.from('brink_kitchen_state').update({last_error:safe.message}).eq('connection_id',config.connection)); } catch { /* Intent remains available. */ }
    throw safe;
  }
}
export async function syncKitchen(date) {
  checkDate(date);
  const config=brinkConfig(); if(!config.configured) throw new BrinkError('Configure PAR first.',503);
  const db=getSupabaseServer(), session=storageSession({deadline:Date.now()+45000}), attempt=randomUUID();
  const claim=await session.run('claim-kitchen',()=>db.rpc('brink_claim_kitchen',{p_connection:config.connection,p_attempt:attempt}));
  if(!claim.data) {
    const owned=await session.run('check-kitchen-claim',()=>db.from('brink_sync_state').select('attempt_id').eq('connection_id',config.connection).maybeSingle());
    if(owned.data?.attempt_id!==attempt) throw new BrinkError('A PAR sync was recently started. Wait two minutes before syncing again.',429);
  }
  return syncKitchenClaimed({config,date,attempt,session,source:'manual',force:true});
}
