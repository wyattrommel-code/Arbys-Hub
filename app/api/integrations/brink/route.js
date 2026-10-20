import { requireFeature } from "@/lib/api-auth";
import { secureJson } from "@/lib/security/http";
import { brinkStatus, syncBrink } from "@/lib/brink-server";
import { BrinkError } from "@/lib/brink";
import { getStoreToday } from "@/lib/store-time";
import { brinkOrderExport } from "@/lib/brink-order-data";
import { salesReports, reportsCsv } from "@/lib/brink-sales-reports";
export const runtime = "nodejs";
export const maxDuration = 60;
function failure(err) {
  return secureJson({ error: err instanceof BrinkError ? err.message : "Could not complete the PAR request." }, { status: err instanceof BrinkError ? err.status : 500 });
}
export async function GET(request) {
  const { error } = await requireFeature("import");
  if (error) return error;
  try {
    const params = new URL(request.url).searchParams;
    const status = await brinkStatus(params.get("date") || getStoreToday());
    if (["reports", "report-csv"].includes(params.get("export"))) {
      if (!status.day) return secureJson({error:"No saved sales snapshot for this date. Import the date first."}, {status:404});
      const reports = salesReports(status);
      if (params.get("export") === "reports") return secureJson(reports, {
        headers: { "Content-Disposition": `attachment; filename="par-reports-${status.business_date}.json"` },
      });
      const type = params.get("type");
      if (!["employee_meal","manager_meal","discounts","voids"].includes(type)) return secureJson({error:"Invalid report type."},{status:400});
      return new Response(reportsCsv(reports,type), { headers:{
        "Content-Type":"text/csv; charset=utf-8", "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff",
        "Content-Disposition":`attachment; filename="par-${type}-${status.business_date}.csv"`,
      }});
    }
    if (params.get("export") === "orders") return secureJson(brinkOrderExport(status), {
      headers: { "Content-Disposition": `attachment; filename="par-orders-${status.business_date}.json"` },
    });
    return secureJson(status);
  }
  catch (err) { return failure(err); }
}
export async function POST(request) {
  const { error } = await requireFeature("import");
  if (error) return error;
  let body;
  try { body = await request.json(); } catch { return secureJson({ error: "Invalid request." }, { status: 400 }); }
  try { return secureJson(await syncBrink(body?.date)); }
  catch (err) { return failure(err); }
}
