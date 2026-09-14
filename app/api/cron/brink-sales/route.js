import { secureJson } from "@/lib/security/http";
import { brinkConfig, BrinkError, validCronSecret } from "@/lib/brink";
import { syncBrink, brinkAutomationState, BRINK_SYNC_VERSION } from "@/lib/brink-server";
import { storageSession } from "@/lib/brink-storage";
import { addDaysISO, getStoreToday } from "@/lib/store-time";
import { getStoreMinutes } from "@/lib/store-time";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request) {
  if (!validCronSecret(request.headers.get("authorization"), process.env.CRON_SECRET)) return secureJson({ error: "Unauthorized" }, { status: 401 });
  try {
    const config = brinkConfig();
    if (!config.scheduled) return secureJson({ skipped: true });
    const session = storageSession({ deadline: Date.now() + 45000 });
    const state = await brinkAutomationState(config, session);
    if (!state?.automatic_enabled) return secureJson({ skipped: true });
    const today = getStoreToday();
    const yesterday = addDaysISO(today, -1);
    // Keep yesterday active through the overnight close, and reconcile it once
    // after 6 AM. One request per tick prevents daily/automatic collisions.
    const reconcile = getStoreMinutes() >= 360 && state.last_daily_date !== yesterday;
    const date = reconcile || getStoreMinutes() < 240 ? yesterday : today;
    const result = await syncBrink(date, reconcile ? "daily" : "automatic", { session, snapshotOnly: true });
    return secureJson({ ok: true, business_date: result.business_date, summary: result.day.summary, integration_version: BRINK_SYNC_VERSION, diagnostics: result.diagnostics });
  } catch (err) {
    if (err instanceof BrinkError && err.status === 429) return secureJson({ skipped: true, reason: "Another recent sync holds the cooldown." });
    return secureJson({ error: err instanceof BrinkError ? err.message : "Scheduled PAR sync failed.", integration_version: BRINK_SYNC_VERSION }, { status: err instanceof BrinkError ? err.status : 500 });
  }
}
