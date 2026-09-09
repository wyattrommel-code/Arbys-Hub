import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseServer } from "./supabase-server";
import { brinkConfig, BrinkError, fetchOrders, summarizeOrders, validBusinessDate } from "./brink";
import { addDaysISO, getStoreToday } from "./store-time";

function check(error) { if (error) throw new BrinkError("Could not access PAR sync storage. Please try again.", 503); }
export async function brinkStatus(date) {
  if (!validBusinessDate(date)) throw new BrinkError("Choose a valid business date.", 400);
  const config = brinkConfig();
  const status = { configured: config.configured, environment: config.mode, host: config.host, label: config.label,
    scheduled: config.scheduled, publishing: config.publish, business_date: date, day: null, state: null };
  if (!config.configured) return status;
  const db = getSupabaseServer();
  const [state, day] = await Promise.all([
    db.from("brink_sync_state").select("attempted_at,last_success_at,last_error").eq("connection_id", config.connection).maybeSingle(),
    db.from("brink_sales_days").select("business_date,synced_at,orders,summary").eq("connection_id", config.connection).eq("business_date", date).maybeSingle(),
  ]);
  check(state.error); check(day.error);
  return { ...status, state: state.data, day: day.data };
}

export async function syncBrink(date) {
  if (!validBusinessDate(date) || date > getStoreToday() || date < addDaysISO(getStoreToday(), -90)) throw new BrinkError("Choose a business date within the past 90 days, including today.", 400);
  const config = brinkConfig();
  if (!config.configured) throw new BrinkError("PAR keys have not been configured on the server.", 503);
  const db = getSupabaseServer();
  const attempt = randomUUID();
  const claim = await db.rpc("brink_claim_sync", { p_connection: config.connection, p_attempt: attempt });
  check(claim.error);
  if (!claim.data) throw new BrinkError("A sync was recently started. Wait two minutes before syncing again.", 429);
  try {
    const orders = await fetchOrders(config, date);
    const summary = summarizeOrders(orders);
    const saved = await db.rpc("brink_finish_sync", { p_connection: config.connection, p_attempt: attempt, p_date: date,
      p_environment: config.mode, p_orders: orders, p_summary: summary, p_publish: config.publish });
    check(saved.error);
    if (!saved.data) throw new BrinkError("A newer sync started. Refresh to see its result.", 409);
  } catch (err) {
    const safe = err instanceof BrinkError ? err : new BrinkError("PAR sync failed. Previous data was preserved.");
    await db.from("brink_sync_state").update({ last_error: safe.message }).eq("connection_id", config.connection).eq("attempt_id", attempt);
    throw safe;
  }
  return brinkStatus(date);
}
