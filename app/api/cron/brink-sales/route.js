import { secureJson } from "@/lib/security/http";
import { brinkConfig, BrinkError, validCronSecret } from "@/lib/brink";
import { syncBrink } from "@/lib/brink-server";
import { addDaysISO, getStoreToday } from "@/lib/store-time";
import { getStoreMinutes } from "@/lib/store-time";
import { getSupabaseServer } from "@/lib/supabase-server";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request) {
  if (!validCronSecret(request.headers.get("authorization"), process.env.CRON_SECRET)) return secureJson({ error: "Unauthorized" }, { status: 401 });
  try {
    const config = brinkConfig();
    if (!config.scheduled) return secureJson({ skipped: true });
    const db = getSupabaseServer();
    const { data: state, error } = await db.from("brink_sync_state").select("automatic_enabled,last_daily_date").eq("connection_id", config.connection).maybeSingle();
    if (error) throw new BrinkError("Could not read automation status.", 503);
    if (!state?.automatic_enabled) return secureJson({ skipped: true });
    const today = getStoreToday();
    const yesterday = addDaysISO(today, -1);
    // Keep yesterday active through the overnight close, and reconcile it once
    // after 6 AM. One request per tick prevents daily/automatic collisions.
    const reconcile = getStoreMinutes() >= 360 && state.last_daily_date !== yesterday;
    const date = reconcile || getStoreMinutes() < 240 ? yesterday : today;
    const result = await syncBrink(date, reconcile ? "daily" : "automatic");
    if (reconcile) {
      const saved = await db.from("brink_sync_state").update({ last_daily_date: yesterday }).eq("connection_id", config.connection);
      if (saved.error) throw new BrinkError("Sales saved but reconciliation status could not be recorded.", 503);
    }
    return secureJson({ ok: true, business_date: result.business_date, summary: result.day.summary });
  } catch (err) {
    if (err instanceof BrinkError && err.status === 429) return secureJson({ skipped: true, reason: "Another recent sync holds the cooldown." });
    return secureJson({ error: err instanceof BrinkError ? err.message : "Scheduled PAR sync failed." }, { status: err instanceof BrinkError ? err.status : 500 });
  }
}
