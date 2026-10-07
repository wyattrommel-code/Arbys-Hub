import { secureJson } from "@/lib/security/http";
import { requireFeature } from "@/lib/api-auth";
import { canEditPunches, isGm } from "@/lib/permissions";
import { loadTimecards } from "@/lib/timecards-server";
export async function GET(request) {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const url = new URL(request.url);
    const data = await loadTimecards(url.searchParams.get("from"), url.searchParams.get("to"), null, { includeLabor: true });
    const { punches: _punches, ...reportSummary } = data.labor_report;
    return secureJson({ ...data, labor_report: reportSummary, can_edit: canEditPunches(employee.role), can_export_pay: isGm(employee.role) });
  } catch (err) {
    return secureJson({ ok: false, error: err.message || "Could not load timecards." }, { status: 500 });
  }
}
