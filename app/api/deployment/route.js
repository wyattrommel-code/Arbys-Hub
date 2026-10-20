import { requireFeature, actorName } from '@/lib/api-auth';
import { secureJson } from '@/lib/security/http';
import { getSupabaseServer } from '@/lib/supabase-server';
import { validBusinessDate } from '@/lib/brink';
import { validateDeployment } from '@/lib/deployment-validation';
export const runtime='nodejs';
export async function GET(request) {
  const {error}=await requireFeature('deployment.view'); if(error) return error;
  const date=new URL(request.url).searchParams.get('date');
  if(!validBusinessDate(date)) return secureJson({error:'Invalid date.'},{status:400});
  const result=await getSupabaseServer().from('deployment_versions').select('*').eq('store_id','payson').eq('log_date',date).order('effective_at',{ascending:false}).limit(1000);
  if(result.error) return secureJson({error:'Could not load deployment history.'},{status:503});
  return secureJson({versions:result.data});
}
export async function POST(request) {
  const {employee,error}=await requireFeature('deployment.submit'); if(error) return error;
  try {
    const text=await request.text(); if(text.length>100000) return secureJson({error:'Deployment is too large.'},{status:413});
    let body; try { body=JSON.parse(text); } catch { return secureJson({error:'Invalid request.'},{status:400}); }
    const db=getSupabaseServer();
    const roster=await db.from('employees').select('id,first_name,last_name,is_active,status,store_id').eq('store_id','07462').eq('is_active',true);
    if(roster.error) throw new Error('roster');
    const value=validateDeployment(body,roster.data);
    const saved=await db.rpc('hub_save_deployment',{p_id:value.id,p_date:value.date,p_shift:value.shift,p_effective:value.effective_at,
      p_actor:employee.employee_id,p_actor_name:actorName(employee),p_assignments:value.assignments,p_base:value.base});
    if(saved.error?.code==='40001') return secureJson({error:'Another deployment was saved, or the effective time precedes the latest version. Reload and review before saving.'},{status:409});
    if(saved.error) throw new Error('save');
    return secureJson({version:saved.data});
  } catch(err) { return secureJson({error:err.status===400?err.message:'Could not save deployment. No partial update was applied.'},{status:err.status===400?400:503}); }
}
