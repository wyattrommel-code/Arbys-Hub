// Device-local PIN verifier, created only after a successful online identity check.
// This never contains the PIN or the database's password hash.
const ITERATIONS = 600000;
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
async function derive(pin, salt, version) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', iterations:ITERATIONS,
    salt:new TextEncoder().encode(`arbys-offline-pin-v1:${version}:${salt}`)}, key, 256);
  return hex(new Uint8Array(bits));
}
export async function createOfflinePinRecord(pin, version) {
  if (!/^\d{4}$/.test(pin) || !version) throw new Error('Offline PIN preparation is unavailable.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return {format:1, version, salt, verifier:await derive(pin,salt,version)};
}
export async function matchesOfflinePin(pin, record) {
  if (!/^\d{4}$/.test(pin) || record?.format!==1 || !record.version || !/^[a-f0-9]{32}$/.test(record.salt) || !/^[a-f0-9]{64}$/.test(record.verifier)) return false;
  const actual = await derive(pin,record.salt,record.version);
  let different=0;
  for(let i=0;i<actual.length;i++) different |= actual.charCodeAt(i)^record.verifier.charCodeAt(i);
  return different===0;
}
export function offlinePinReady(snapshot, credentials, employeeId) {
  const employee=snapshot?.employees?.find(row=>row.id===employeeId), record=credentials?.[employeeId];
  return !!employee?.pin_version && record?.format===1 && record.version===employee.pin_version;
}
