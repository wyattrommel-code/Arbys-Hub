import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { getSupabaseServer } from '../supabase-server';
import { DEVICE_COOKIE } from '../clock-gateway-policy';
export { DEVICE_COOKIE } from '../clock-gateway-policy';
export const CLOCK_STORE = '07462';
export const DEVICE_MAX_AGE = 180 * 24 * 60 * 60;
export const hashCredential = value => createHash('sha256').update(value).digest('hex');
export async function isClockGateway() {
  const expected = process.env.CLOCK_GATEWAY_SECRET;
  const actual = (await headers()).get('x-clock-gateway-key') || '';
  if (!expected || expected.length < 32) return false;
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function hasClockDevice() {
  try {
    if (!(await isClockGateway())) return false;
    const token = (await cookies()).get(DEVICE_COOKIE)?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
    const { data, error } = await getSupabaseServer().from('clock_kiosk_stations')
      .select('store_id').eq('store_id', CLOCK_STORE).eq('device_hash', hashCredential(token))
      .gt('device_expires_at', new Date().toISOString()).maybeSingle();
    return !error && !!data;
  } catch { return false; }
}
