import { cookies } from 'next/headers';
import { requireKiosk } from '@/lib/security/kiosk';
import { DEVICE_COOKIE, hashCredential } from '@/lib/security/clock-device';
import { secureJson } from '@/lib/security/http';
import { getSupabaseServer } from '@/lib/supabase-server';
import { fetchClockRoster, fetchRecentClockOuts, fetchPunchSchedules, getAttendanceSettings, publicSettings } from '@/lib/clock';
import { STORE_ID } from '@/lib/constants';
import { fetchEmployees } from '@/lib/employees';
import { offlineKeys, offlinePinVersion, signOfflineLease } from '@/lib/offline-clock-crypto';

export async function GET() {
  const denied=await requireKiosk(); if(denied) return denied;
  try {
    const db=getSupabaseServer();
    const [employees,settings,keys,punches,breaks,reviews,clockOuts,pinEmployees]=await Promise.all([
      fetchClockRoster(db),getAttendanceSettings(db),offlineKeys(db),
      db.from('time_punches').select('id,employee_id,clock_in,on_break,shift_id,unscheduled').eq('store_id','payson').is('clock_out',null),
      db.from('break_punches').select('id,time_punch_id,break_start').eq('store_id','payson').is('break_end',null),
      db.from('clock_offline_events').select('employee_id').eq('store_id','payson').eq('status','review').is('resolved_at',null),
      fetchRecentClockOuts(db),
      fetchEmployees(db,{storeId:STORE_ID,select:'id,employee_code',orderBy:{column:'id'}}),
    ]);
    for(const result of [punches,breaks,reviews]) if(result.error) throw result.error;
    const schedules=await fetchPunchSchedules(db,punches.data);
    const deviceHash=hashCredential((await cookies()).get(DEVICE_COOKIE).value);
    const lease=signOfflineLease(deviceHash);
    const versions=new Map(pinEmployees.map(employee=>[employee.id,offlinePinVersion(deviceHash,employee)]));
    return secureJson({ok:true,snapshot:{lease:lease.lease,issued_at:lease.issued_at,expires_at:lease.expires_at,public_key:keys.public_jwk,
      settings:publicSettings(settings),review_count:reviews.data.length,
      employees:employees.map(employee=>{
        const punch=punches.data.find(p=>p.employee_id===employee.id), br=breaks.data.find(b=>b.time_punch_id===punch?.id);
        return {...employee,pin_version:versions.get(employee.id) || null,clocked_in:!!punch,clock_in:punch?.clock_in || null,on_break:!!br,punch_id:punch?.id || null,break_id:br?.id || null,
          break_start:br?.break_start || null,last_clock_out:clockOuts.get(employee.id) || null,
          clock_schedule:punch ? schedules.get(punch.id) : null,
          review:reviews.data.some(row=>row.employee_id===employee.id)};
      })}});
  } catch {
    return secureJson({ok:false,error:'Offline preparation is unavailable. Online clocking still works.'},{status:503});
  }
}
