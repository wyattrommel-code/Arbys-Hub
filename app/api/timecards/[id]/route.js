import { secureJson } from "@/lib/security/http";
import { after } from "next/server";
import { evaluatePunchAndSweep } from "@/lib/attendance";
import { actorName, requireFeature } from "@/lib/api-auth";
import { canEditPunches } from "@/lib/permissions";
import { TIMECARD_STORE_ID } from "@/lib/timecards";
import { fetchBreaksForPunches } from "@/lib/break-punches";
import { getSupabaseServer } from "@/lib/supabase-server";
import { parseTimecardEdit, timecardEditState } from "@/lib/timecard-edit";
import { timecardEditVersion } from "@/lib/timecard-edit-version";

export async function PATCH(request, context) {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  if (!canEditPunches(employee.role)) return secureJson({ok:false,error:"Only a GM or assistant manager can edit punches."},{status:403});
  try {
    const { id } = await context.params;
    let body;
    try { body = await request.json(); } catch { return secureJson({ok:false,error:"Invalid correction."},{status:400}); }
    const input = parseTimecardEdit(body || {});
    const supabase = getSupabaseServer();
    const {data:punch,error:fetchErr} = await supabase.from("time_punches").select("*").eq("id",id).eq("store_id",TIMECARD_STORE_ID).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!punch) return secureJson({ok:false,error:"Punch not found."},{status:404});
    const breaks = await fetchBreaksForPunches(supabase,[id]);
    if (input.version !== timecardEditVersion(punch,breaks)) return secureJson({ok:false,error:"This punch changed. Close the editor, refresh and try again."},{status:409});
    const {data:updated,error:saveError} = await supabase.rpc("hub_edit_timecard",{
      p_id:id,p_clock_in:input.clock_in,p_clock_out:input.clock_out,p_breaks:input.breaks,
      p_expected:timecardEditState(punch,breaks),p_actor:employee.employee_id,p_actor_name:actorName(employee),p_note:input.note,
    });
    if (saveError) throw Object.assign(new Error(saveError.message),{status:({ '40001':409,'22023':400,'22P02':400,'22007':400,'P0002':404,'42501':403 })[saveError.code] || 500});
    after(async () => {
      try { await evaluatePunchAndSweep(getSupabaseServer(),updated); }
      catch (err) { console.error("attendance flags (punch edit)",err); }
    });
    return secureJson({ok:true,punch:updated});
  } catch (err) { return secureJson({ok:false,error:err.message || "Could not save punch."},{status:err.status || 500}); }
}
