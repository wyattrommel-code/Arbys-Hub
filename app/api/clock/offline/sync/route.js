import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { requireKiosk } from '@/lib/security/kiosk';
import { guardPinAttempt } from '@/lib/security/pin-guard';
import { DEVICE_COOKIE, hashCredential } from '@/lib/security/clock-device';
import { secureJson } from '@/lib/security/http';
import { getSupabaseServer } from '@/lib/supabase-server';
import { fetchClockEmployeeByPin, fetchTodaysShiftsForEmployee, fetchRecentPunches, pickClockInShift, canAuthorizeUnscheduled, clockEmployeeName, ensurePunchPhotosBucket } from '@/lib/clock';
import { attachEffectiveAccess } from '@/lib/roles';
import { evaluatePunchAndSweep } from '@/lib/attendance';
import { baseKind, validateOfflineEvent } from '@/lib/offline-clock';
import { decryptOfflinePin, offlineKeys, verifyOfflineLease } from '@/lib/offline-clock-crypto';

export async function POST(request) {
  const denied=await requireKiosk(); if(denied) return denied;
  let event,form,photo,bytes;
  try {
    form=await request.formData(); event=validateOfflineEvent(JSON.parse(form.get('event'))); photo=form.get('file');
    if(!photo || typeof photo==='string' || photo.type!=='image/jpeg' || photo.size<4 || photo.size>3*1024*1024) throw new Error('Invalid photo.');
    bytes=Buffer.from(await photo.arrayBuffer());
    if(bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255 || bytes.at(-2)!==255 || bytes.at(-1)!==217) throw new Error('Invalid photo.');
  } catch { return secureJson({ok:false,error:'The saved punch or photo could not be read. Keep it on this iPad and ask your manager for help.'},{status:400}); }
  try {
    const db=getSupabaseServer(), deviceHash=hashCredential((await cookies()).get(DEVICE_COOKIE).value);
    if(!verifyOfflineLease(form.get('lease'),deviceHash,event.captured_at)) return secureJson({ok:false,error:'This offline punch belongs to a different or invalid iPad authorization. Keep it saved for your manager.'},{status:403});
    const fingerprint=createHash('sha256').update(JSON.stringify(event)).update(bytes).update(String(form.get('sealed_pin'))).update(String(form.get('face_detected'))).digest('hex');
    const existing=await db.from('clock_offline_events').select('id,status,device_hash,fingerprint').eq('id',event.id).maybeSingle();
    if(existing.error) throw existing.error;
    if(existing.data) {
      if(existing.data.device_hash!==deviceHash || existing.data.fingerprint!==fingerprint) return secureJson({ok:false,error:'A different punch already uses this receipt ID. Ask your manager for help.'},{status:409});
      return secureJson({ok:true,receipt:{id:event.id,status:existing.data.status}});
    }
    const rateError=await guardPinAttempt(request,'offline-sync');if(rateError)return rateError;
    let issue=null, employee=null, manager=null, shift=null;
    let credentials;
    try { credentials=decryptOfflinePin((await offlineKeys(db)).private_jwk,form.get('sealed_pin'),event); }
    catch { issue='The saved PIN could not be verified.'; }
    if(credentials) {
      employee=await fetchClockEmployeeByPin(db,credentials.pin);
      if(!employee || employee.id!==event.employee_id) issue='The employee PIN did not match. Verify the photo and employee before entering this time.';
      else if(baseKind(event.kind)==='clock_in' && !event.kind.startsWith('forgot_')) {
        const at=new Date(event.occurred_at);
        const [shifts,punches]=await Promise.all([fetchTodaysShiftsForEmployee(db,employee,at),fetchRecentPunches(db,employee.id,at)]);
        shift=pickClockInShift(shifts,punches,at);
        if(!shift) {
          manager=credentials.manager_pin ? await attachEffectiveAccess(db,await fetchClockEmployeeByPin(db,credentials.manager_pin)) : null;
          if(!manager || !canAuthorizeUnscheduled(manager)) issue='Unscheduled offline clock-in needs manager authorization.';
        }
      }
    }
    if(Date.parse(event.captured_at)>Date.now()+120000) issue='The iPad clock was ahead of the server. Check the recorded time.';
    const photoHash=createHash('sha256').update(bytes).digest('hex');
    const path=`payson/${event.employee_id}/offline-${event.id}-${photoHash}.jpg`;
    const bucket=db.storage.from('punch-photos');
    const upload=()=>bucket.upload(path,bytes,{contentType:'image/jpeg',upsert:false});
    let uploaded=await upload();
    if(uploaded.error && /bucket.*not found/i.test(uploaded.error.message || '')) { await ensurePunchPhotosBucket(db); uploaded=await upload(); }
    if(uploaded.error && !/already exists|duplicate/i.test(uploaded.error.message || '')) throw uploaded.error;
    const photoUrl=bucket.getPublicUrl(path).data.publicUrl;
    const saved=await db.rpc('hub_sync_offline_punch',{p_event:event,p_device:deviceHash,p_fingerprint:fingerprint,p_photo:photoUrl,
      p_face:form.get('face_detected')==='true',p_issue:issue,p_shift:shift?.id || null,p_manager:manager?.id || null,p_manager_name:manager ? clockEmployeeName(manager) : null});
    if(saved.error) throw saved.error;
    if(saved.data.punch) after(async()=>{try{await evaluatePunchAndSweep(getSupabaseServer(),saved.data.punch);}catch{console.error('Offline punch attendance evaluation failed.');}});
    return secureJson({ok:true,receipt:{id:event.id,status:saved.data.status}});
  } catch {
    return secureJson({ok:false,error:'The Hub has not confirmed this punch yet. It is still saved on the iPad and will retry.'},{status:503});
  }
}
