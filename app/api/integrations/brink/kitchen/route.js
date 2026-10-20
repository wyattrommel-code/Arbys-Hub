import { requireFeature } from '@/lib/api-auth';
import { secureJson } from '@/lib/security/http';
import { BrinkError } from '@/lib/brink';
import { getStoreToday } from '@/lib/store-time';
import { kitchenStatus, syncKitchen, configureKitchen } from '@/lib/brink-kitchen-server';
export const runtime='nodejs';
export const maxDuration=60;
const failure=err=>secureJson({error:err instanceof BrinkError?err.message:'Could not complete the kitchen request.'},{status:err instanceof BrinkError?err.status:503});
export async function GET(request) {
  const {error}=await requireFeature('reports'); if(error) return error;
  try { return secureJson(await kitchenStatus(new URL(request.url).searchParams.get('date')||getStoreToday())); }
  catch(err) { return failure(err); }
}
export async function POST(request) {
  const {error}=await requireFeature('import'); if(error) return error;
  try {
    let body; try { body=await request.json(); } catch { throw new BrinkError('Invalid request.',400); }
    if(body.action==='configure') return secureJson(await configureKitchen(body.enabled));
    if(body.action!=='sync') throw new BrinkError('Invalid action.',400);
    return secureJson(await syncKitchen(body.date));
  } catch(err) { return failure(err); }
}
