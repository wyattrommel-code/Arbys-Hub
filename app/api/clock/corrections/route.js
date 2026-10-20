import { after } from 'next/server';
import { requireKiosk } from '@/lib/security/kiosk';
import { guardPinAttempt } from '@/lib/security/pin-guard';
import { secureJson } from '@/lib/security/http';
import { fetchClockEmployeeByPin, parsePin, uploadPunchPhoto } from '@/lib/clock';
import { parseCorrectionTime, CORRECTION_LABELS } from '@/lib/clock-corrections';
import { getSupabaseServer } from '@/lib/supabase-server';
import { evaluatePunchAndSweep } from '@/lib/attendance';

export async function POST(request) {
  const kioskError = await requireKiosk();
  if (kioskError) return kioskError;
  const pinError = await guardPinAttempt(request);
  if (pinError) return pinError;
  let body, photo;
  try {
    const form = await request.formData();
    body = Object.fromEntries(form.entries());
    body.punch_id ||= null; body.break_id ||= null;
    photo = form.get('file');
  } catch { return secureJson({ error: 'A new photo is required. Refresh the clock and try again.' }, { status: 400 }); }
  const claimed = parseCorrectionTime(body?.claimed_time);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!claimed || !Object.hasOwn(CORRECTION_LABELS, body?.type) || reason.length < 3 || reason.length > 1000) {
    return secureJson({ error: 'Choose the actual time and enter a reason (3–1000 characters).' }, { status: 400 });
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(body.employee_id || '') || !parsePin(body.pin) ||
      [body.punch_id, body.break_id].some(id => id != null && !uuid.test(id))) {
    return secureJson({ error: 'Select your name and enter your PIN again.' }, { status: 400 });
  }
  try {
    const db = getSupabaseServer();
    const employee = await fetchClockEmployeeByPin(db, body.pin, body.employee_id);
    if (!employee || employee.id !== body.employee_id) return secureJson({ error: 'Invalid PIN' }, { status: 401 });
    if (!photo || typeof photo === 'string' || photo.type !== 'image/jpeg' || photo.size < 4 || photo.size > 3 * 1024 * 1024) {
      return secureJson({ error: 'Take a new photo before saving this correction.' }, { status: 400 });
    }
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) {
      return secureJson({ error: 'Could not read the photo. Take it again.' }, { status: 400 });
    }
    const photoUrl = await uploadPunchPhoto(db, employee.id, photo, body.type === 'forgot_clock_out' ? 'out' : 'in');
    const { data, error } = await db.rpc('hub_correct_missed_punch_photo', {
      p_photo_url: photoUrl, p_face_detected: body.face_detected === "true",
      p_employee: employee.id, p_type: body.type, p_claimed: claimed, p_reason: reason,
      p_expected_punch: body.punch_id || null, p_expected_break: body.break_id || null,
    });
    if (error) {
      if (['P0001', '22023', '23505'].includes(error.code)) return secureJson({ error: error.code === '23505' ? 'This punch has already changed. Select your name again.' : error.message }, { status: 409 });
      throw error;
    }
    after(async () => { try { await evaluatePunchAndSweep(getSupabaseServer(), data.punch); } catch (err) { console.error('attendance flags (missed punch)', err); } });
    return secureJson({ ok: true, action: body.type, clocked_in: !data.punch.clock_out, on_break: Boolean(data.punch.on_break) });
  } catch (err) {
    console.error('missed punch', err);
    return secureJson({ error: 'Could not save the missed time. Select your name again to check your status before retrying.' }, { status: 500 });
  }
}
