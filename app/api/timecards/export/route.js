import { requireFeature } from "@/lib/api-auth";
import { secureJson } from "@/lib/security/http";
import { loadTimecards } from "@/lib/timecards-server";
import { buildPayrollCsv, groupTimecards, payrollFilename } from "@/lib/timecards";
import { buildTimecardReportCsv, timecardReportFilename } from "@/lib/timecard-reports";
import { isGm } from "@/lib/permissions";

export async function GET(request) {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "payroll";
    if (!["payroll", "summary", "punches"].includes(type)) return secureJson({ error: "Unknown report type." }, { status: 400 });
    const data = await loadTimecards(url.searchParams.get("from"), url.searchParams.get("to"), null, { includeLabor: type !== "payroll", includePay: type === "summary" && isGm(employee.role) });
    if (data.offline_review_count > 0) return secureJson({ error: "Payroll export is on hold. Resolve the offline punches in this period first." }, { status: 409 });
    if (type !== "payroll") return new Response(buildTimecardReportCsv(data.labor_report, type), { headers: {
      "Content-Type": "text/csv;charset=utf-8", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${timecardReportFilename(type, data.from, data.to)}"`,
      "X-Content-Type-Options": "nosniff",
    } });
    const grouped = groupTimecards(data.groups.flatMap((group) => group.punches));
    if (grouped.groups.some((group) => group.punches.some((punch) => !punch.payroll_ready))) {
      return secureJson({ error: "Payroll export is on hold. Resolve open punches and approve every red flag in this period." }, { status: 409 });
    }
    return new Response(buildPayrollCsv(grouped, data.from, data.to), { headers: {
      "Content-Type": "text/csv;charset=utf-8", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${payrollFilename(data.from, data.to)}"`,
    } });
  } catch (err) {
    return secureJson({ error: err.message || "Could not export payroll." }, { status: err.status || 500 });
  }
}
