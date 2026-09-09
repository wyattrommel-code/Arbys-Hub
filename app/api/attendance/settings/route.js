import { secureJson } from "@/lib/security/http";
import { getAttendanceSettings, saveAttendanceSettings } from "@/lib/attendance";
import { requireFeature } from "@/lib/api-auth";
import { canEditPunches } from "@/lib/permissions";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET() {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const settings = await getAttendanceSettings(getSupabaseServer());
    return secureJson({
      ok: true,
      settings,
      can_edit: canEditPunches(employee.role),
    });
  } catch (err) {
    return secureJson({ ok: false, error: err.message || "Could not load settings." }, { status: 500 });
  }
}

export async function PATCH(request) {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  if (!canEditPunches(employee.role)) {
    return secureJson(
      { ok: false, error: "Only a GM or assistant manager can change time clock settings." },
      { status: 403 }
    );
  }
  try {
    const body = await request.json();
    const settings = await saveAttendanceSettings(getSupabaseServer(), body || {});
    return secureJson({ ok: true, settings, can_edit: true });
  } catch (err) {
    return secureJson({ ok: false, error: err.message || "Could not save settings." }, { status: 500 });
  }
}
