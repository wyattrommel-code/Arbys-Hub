import { randomBytes } from 'node:crypto';
import { CLOCK_STORE, DEVICE_COOKIE, DEVICE_MAX_AGE, hashCredential, isClockGateway } from '@/lib/security/clock-device';
import { currentActor } from '@/lib/security/current-actor';
import { canAccess } from '@/lib/permissions';
import { getSupabaseServer } from '@/lib/supabase-server';
import { secureJson } from '@/lib/security/http';
import { guardPinAttempt } from '@/lib/security/pin-guard';
import { sessionCookieOptions } from '@/lib/session';
export async function POST(request) {
  if (!(await isClockGateway())) return secureJson({ error: 'Use the dedicated time clock site.' }, { status: 403 });
  const limited = await guardPinAttempt(request, "clock-pairing");
  if (limited) return limited;
  try {
    const { code } = await request.json();
    const normalized = String(code || '').replace(/[\s-]/g, '').toLowerCase();
    if (!/^[a-f0-9]{20}$/.test(normalized)) return secureJson({ error: 'Enter the pairing code from your GM.' }, { status: 400 });
    const db = getSupabaseServer();
    const hash = hashCredential(normalized);
    const { data: station, error } = await db.from('clock_kiosk_stations').select('pairing_by')
      .eq('store_id', CLOCK_STORE).eq('pairing_hash', hash).gt('pairing_expires_at', new Date().toISOString()).maybeSingle();
    if (error) throw error;
    const actor = station && await currentActor(db, { employee_id: station.pairing_by });
    if (!actor || !canAccess(actor.role, 'settings')) return secureJson({ error: 'Pairing code expired or invalid. Ask your GM for a new code.' }, { status: 403 });
    const token = randomBytes(32).toString('hex');
    const { data: paired, error: pairError } = await db.rpc('hub_pair_clock_station', {
      p_store: CLOCK_STORE, p_pairing_hash: hash, p_device_hash: hashCredential(token), p_issuer: actor.employee_id,
    });
    if (pairError) throw pairError;
    if (!paired) return secureJson({ error: 'Pairing code expired or already used.' }, { status: 403 });
    const response = secureJson({ ok: true });
    response.cookies.set(DEVICE_COOKIE, token, { ...sessionCookieOptions(DEVICE_MAX_AGE), sameSite: 'strict' });
    response.cookies.set('hub_kiosk', '', sessionCookieOptions(0));
    return response;
  } catch { return secureJson({ error: 'Pairing is temporarily unavailable.' }, { status: 503 }); }
}
