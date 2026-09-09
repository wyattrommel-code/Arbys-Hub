import { requireFeature } from "@/lib/api-auth";
import { secureJson } from "@/lib/security/http";
import { loadTimecards } from "@/lib/timecards-server";
import { buildPayrollCsv, groupTimecards, payrollFilename } from "@/lib/timecards";

export async function GET(request) {
  const { error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const url = new URL(request.url);
    const data = await loadTimecards(url.searchParams.get("from"), url.searchParams.get("to"));
    const grouped = groupTimecards(data.groups.flatMap((group) => group.punches));
    if (grouped.groups.some((group) => group.punches.some((punch) => !punch.payroll_ready))) {
      return secureJson({ error: "Payroll export is on hold. Resolve open punches and approve every red flag in this period." }, { status: 409 });
    }
    return new Response(buildPayrollCsv(grouped, data.from, data.to), { headers: {
      "Content-Type": "text/csv;charset=utf-8", "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${payrollFilename(data.from, data.to)}"`,
    } });
  } catch (err) {
    return secureJson({ error: err.message || "Could not export payroll." }, { status: 500 });
  }
}
