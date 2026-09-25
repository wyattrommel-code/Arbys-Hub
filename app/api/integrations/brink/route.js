import { requireFeature } from "@/lib/api-auth";
import { secureJson } from "@/lib/security/http";
import { brinkStatus, syncBrink } from "@/lib/brink-server";
import { BrinkError } from "@/lib/brink";
import { getStoreToday } from "@/lib/store-time";
import { brinkOrderExport } from "@/lib/brink-order-data";
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
