import { randomBytes } from 'node:crypto';
import { requireFeature } from '@/lib/api-auth';
import { getSupabaseServer } from '@/lib/supabase-server';
import { CLOCK_STORE, hashCredential } from '@/lib/security/clock-device';
import { secureJson } from '@/lib/security/http';
export async function GET() {
  const { error } = await requireFeature('settings');
  if (error) return error;
  try {
    const { data, error: dbError } = await getSupabaseServer().from('clock_kiosk_stations')
      .select('paired_at,device_expires_at,pairing_expires_at,revoked_at').eq('store_id', CLOCK_STORE).maybeSingle();
    if (dbError) throw dbError;
    return secureJson({ station: data });
  } catch { return secureJson({ error: 'Could not load clock station.' }, { status: 503 }); }
}
export async function POST(request) {
  const { employee, error } = await requireFeature('settings');
  if (error) return error;
  try {
    const { action } = await request.json();
    if (!['issue', 'revoke'].includes(action)) return secureJson({ error: 'Invalid action' }, { status: 400 });
    const db = getSupabaseServer();
    const common = { store_id: CLOCK_STORE, changed_by: employee.employee_id };
    if (action === 'revoke') {
      const { error: dbError } = await db.from('clock_kiosk_stations').upsert({ ...common,
        device_hash: null, device_expires_at: null, paired_at: null, pairing_hash: null, pairing_by: null,
        pairing_expires_at: null, revoked_at: new Date().toISOString(),
      });
      if (dbError) throw dbError;
      return secureJson({ ok: true });
    }
    const code = randomBytes(10).toString('hex');
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: dbError } = await db.from('clock_kiosk_stations').upsert({ ...common,
      pairing_hash: hashCredential(code), pairing_expires_at: expires, pairing_by: employee.employee_id,
    });
    if (dbError) throw dbError;
    return secureJson({ ok: true, code: code.toUpperCase().match(/.{5}/g).join('-'), expires });
  } catch { return secureJson({ error: 'Could not update clock station.' }, { status: 503 }); }
}
