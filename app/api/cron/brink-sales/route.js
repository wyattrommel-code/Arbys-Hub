import { secureJson } from "@/lib/security/http";
import { brinkConfig, BrinkError, validCronSecret } from "@/lib/brink";
import { syncBrink } from "@/lib/brink-server";
import { addDaysISO, getStoreToday } from "@/lib/store-time";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request) {
  if (!validCronSecret(request.headers.get("authorization"), process.env.CRON_SECRET)) return secureJson({ error: "Unauthorized" }, { status: 401 });
  try {
    if (!brinkConfig().scheduled) return secureJson({ skipped: true });
    const result = await syncBrink(addDaysISO(getStoreToday(), -1));
    return secureJson({ ok: true, business_date: result.business_date, summary: result.day.summary });
  } catch (err) {
    return secureJson({ error: err instanceof BrinkError ? err.message : "Scheduled PAR sync failed." }, { status: err instanceof BrinkError ? err.status : 500 });
  }
}
