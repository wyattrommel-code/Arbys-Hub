import { secureJson } from "@/lib/security/http";
import { requireFeature } from "@/lib/api-auth";
import { canEditPunches } from "@/lib/permissions";
import { loadTimecards } from "@/lib/timecards-server";
export async function GET(request) {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const url = new URL(request.url);
    const data = await loadTimecards(url.searchParams.get("from"), url.searchParams.get("to"));
    return secureJson({ ...data, can_edit: canEditPunches(employee.role) });
  } catch (err) {
    return secureJson({ ok: false, error: err.message || "Could not load timecards." }, { status: 500 });
  }
}
