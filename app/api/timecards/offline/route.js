import { requireFeature } from '@/lib/api-auth';
import { canEditPunches } from '@/lib/permissions';
import { secureJson } from '@/lib/security/http';
import { getSupabaseServer } from '@/lib/supabase-server';
import { uuid } from '@/lib/offline-clock';
import { after } from 'next/server';
import { evaluatePunchAndSweep } from '@/lib/attendance';
export async function GET() {
  const {employee,error}=await requireFeature('timeclock.full');if(error)return error;
  if(!canEditPunches(employee.role))return secureJson({error:'Manager access required.'},{status:403});
  const {data,error:readError,count}=await getSupabaseServer().from('clock_offline_events')
    .select('id,employee_id,employee_name,event,photo_url,issue,received_at',{count:'exact'})
    .eq('store_id','payson').eq('status','review').is('resolved_at',null).order('received_at').limit(100);
  if(readError)return secureJson({error:'Could not load offline punch review.'},{status:503});
  return secureJson({ok:true,events:data,count});
}
export async function PATCH(request) {
  const {employee,error}=await requireFeature('timeclock.full');if(error)return error;
  if(!canEditPunches(employee.role))return secureJson({error:'Manager access required.'},{status:403});
  let body;try{body=await request.json();}catch{return secureJson({error:'Invalid resolution.'},{status:400});}
  if(!uuid(body.id) || typeof body.note!=='string' || body.note.trim().length<3 || body.note.length>1000)return secureJson({error:'Enter how you resolved this punch (3–1000 characters).'},{status:400});
  if(body.action==='apply'){
    const {data,error:applyError}=await getSupabaseServer().rpc('hub_apply_offline_review',{p_id:body.id,p_actor:employee.employee_id,p_note:body.note.trim()});
    if(applyError)return secureJson({error:applyError.message || 'Could not apply this punch.'},{status:['P0001','22023','40001'].includes(applyError.code)?409:503});
    after(async()=>{try{await evaluatePunchAndSweep(getSupabaseServer(),data);}catch{console.error('Offline review attendance evaluation failed.');}});
    return secureJson({ok:true});
  }
  if(body.action && body.action!=='resolve')return secureJson({error:'Invalid resolution action.'},{status:400});
  const {data,error:saveError}=await getSupabaseServer().from('clock_offline_events')
    .update({resolved_at:new Date().toISOString(),resolved_by:employee.employee_id,resolution_note:body.note.trim()})
    .eq('id',body.id).eq('store_id','payson').eq('status','review').is('resolved_at',null).select('id').maybeSingle();
  if(saveError)return secureJson({error:'Could not save the resolution.'},{status:503});
  if(!data)return secureJson({error:'This punch has already been handled. Refresh the list.'},{status:409});
  return secureJson({ok:true});
}
