import { createHmac, timingSafeEqual, generateKeyPairSync, createPrivateKey, privateDecrypt, constants } from 'node:crypto';
import { OFFLINE_HOURS } from './offline-clock';

function secret() {
  if (!process.env.SESSION_SECRET) throw new Error('Offline signing is not configured.');
  return process.env.SESSION_SECRET;
}
// An opaque change marker, scoped to this employee and paired browser. Never export employee_code.
export function offlinePinVersion(deviceHash, employee) {
  if (!deviceHash || !employee?.id || !employee.employee_code) return null;
  return createHmac('sha256',secret()).update(JSON.stringify(['offline-pin-v1',deviceHash,employee.id,employee.employee_code])).digest('base64url');
}
export function signOfflineLease(deviceHash, now = Date.now()) {
  const body={purpose:'offline-clock-v1',device:deviceHash,issued_at:new Date(now).toISOString(),expires_at:new Date(now+OFFLINE_HOURS*3600000).toISOString()};
  const payload=Buffer.from(JSON.stringify(body)).toString('base64url');
  return { ...body, lease:payload+'.'+createHmac('sha256',secret()).update(payload).digest('base64url') };
}
export function verifyOfflineLease(token, deviceHash, capturedAt) {
  try {
    const [payload,signature,...extra]=String(token).split('.');
    if(extra.length || !payload || !signature || token.length>2048) return false;
    const actual=Buffer.from(signature,'base64url'), expected=createHmac('sha256',secret()).update(payload).digest();
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return false;
    const body=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')), captured=Date.parse(capturedAt);
    return body.purpose==='offline-clock-v1' && body.device===deviceHash && Number.isFinite(captured) &&
      captured>=Date.parse(body.issued_at)-60000 && captured<=Date.parse(body.expires_at);
  } catch { return false; }
}
export async function offlineKeys(db) {
  let {data,error}=await db.from('clock_offline_keys').select('public_jwk,private_jwk').eq('id','v1').maybeSingle();
  if(error) throw error;
  if(!data) {
    const pair=generateKeyPairSync('rsa',{modulusLength:2048});
    const row={id:'v1',public_jwk:pair.publicKey.export({format:'jwk'}),private_jwk:pair.privateKey.export({format:'jwk'})};
    const inserted=await db.from('clock_offline_keys').upsert(row,{onConflict:'id',ignoreDuplicates:true});
    if(inserted.error) throw inserted.error;
    ({data,error}=await db.from('clock_offline_keys').select('public_jwk,private_jwk').eq('id','v1').single());
    if(error) throw error;
  }
  return data;
}
export function decryptOfflinePin(privateJwk, sealed, event) {
  if(typeof sealed!=='string' || sealed.length>600) throw new Error('Invalid saved PIN.');
  const plain=privateDecrypt({key:createPrivateKey({key:privateJwk,format:'jwk'}),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(sealed,'base64'));
  const data=JSON.parse(plain.toString('utf8'));
  if(data.id!==event.id || data.employee_id!==event.employee_id || !/^\d{4}$/.test(data.pin) || (data.manager_pin && !/^\d{4}$/.test(data.manager_pin))) throw new Error('Invalid saved PIN.');
  return data;
}
