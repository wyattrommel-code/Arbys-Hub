import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseServer } from "./supabase-server";
import { brinkConfig, BrinkError, fetchOrders, summarizeOrders, validBusinessDate } from "./brink";
import { addDaysISO, getStoreToday } from "./store-time";
import { ordersRequest } from "./brink-evidence";

function check(error) { if (error) throw new BrinkError("Could not access PAR sync storage. Please try again.", 503); }
export async function brinkStatus(date) {
  if (!validBusinessDate(date)) throw new BrinkError("Choose a valid business date.", 400);
  const config = brinkConfig();
  const status = { configured: config.configured, environment: config.mode, host: config.host, label: config.label,
    scheduled: config.scheduled, publishing: config.publish, business_date: date, day: null, state: null };
  if (!config.configured) return status;
  const db = getSupabaseServer();
  const [state, day] = await Promise.all([
    db.from("brink_sync_state").select("attempted_at,last_success_at,last_error,automatic_enabled,last_daily_date").eq("connection_id", config.connection).maybeSingle(),
    db.from("brink_sales_days").select("business_date,synced_at,orders,summary").eq("connection_id", config.connection).eq("business_date", date).maybeSingle(),
  ]);
  check(state.error); check(day.error);
  return { ...status, state: state.data, day: day.data };
}

export async function syncBrink(date, source = "manual") {
  if (!validBusinessDate(date) || date > getStoreToday() || date < addDaysISO(getStoreToday(), -90)) throw new BrinkError("Choose a business date within the past 90 days, including today.", 400);
  const config = brinkConfig();
  if (!config.configured) throw new BrinkError("PAR keys have not been configured on the server.", 503);
  const db = getSupabaseServer();
  const attempt = randomUUID();
  const claim = await db.rpc("brink_claim_sync", { p_connection: config.connection, p_attempt: attempt });
  check(claim.error);
  if (!claim.data) throw new BrinkError("A sync was recently started. Wait two minutes before syncing again.", 429);
  const started = Date.now();
  const evidence = {};
  try {
    // Persist intent before any outbound request. If logging is unavailable,
    // fail closed rather than making an unrecorded PAR call.
    const entry = await db.from("brink_api_calls").insert({ id: attempt, connection_id: config.connection, environment: config.mode,
      business_date: date, endpoint: `https://${config.host}/Sales2.svc`, source, request_xml: ordersRequest(date) });
    check(entry.error);
    const orders = await fetchOrders(config, date, fetch, evidence);
    const summary = summarizeOrders(orders);
    const saved = await db.rpc("brink_finish_sync", { p_connection: config.connection, p_attempt: attempt, p_date: date,
      p_environment: config.mode, p_orders: orders, p_summary: summary, p_publish: config.publish });
    check(saved.error);
    if (!saved.data) throw new BrinkError("A newer sync started. Refresh to see its result.", 409);
    const logged = await db.from("brink_api_calls").update({ ...evidence, status: "success", finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
      order_count: orders.length, net_sales: summary.net_sales }).eq("id", attempt);
    check(logged.error);
  } catch (err) {
    const safe = err instanceof BrinkError ? err : new BrinkError("PAR sync failed. Previous data was preserved.");
    await db.from("brink_sync_state").update({ last_error: safe.message }).eq("connection_id", config.connection).eq("attempt_id", attempt);
    await db.from("brink_api_calls").update({ ...evidence, status: "error", error: safe.message, finished_at: new Date().toISOString(), duration_ms: Date.now() - started }).eq("id", attempt);
    throw safe;
  }
  return brinkStatus(date);
}

export async function configureBrinkAutomation(enabled) {
  const config = brinkConfig();
  if (!config.configured || !process.env.CRON_SECRET || !config.scheduled) throw new BrinkError("Server connection and scheduler credentials must be configured first.", 503);
  const db = getSupabaseServer();
  const job = await db.rpc("brink_configure_scheduler", { p_secret: process.env.CRON_SECRET, p_enabled: enabled });
  check(job.error);
  // The setting is per connection, so replacing the location requires an
  // explicit enable after reviewing the new sandbox/production label.
  const state = await db.from("brink_sync_state").upsert({ connection_id: config.connection, attempt_id: randomUUID(), attempted_at: new Date(Date.now() - 180000).toISOString(), automatic_enabled: enabled }, { onConflict: "connection_id", ignoreDuplicates: true });
  check(state.error);
  check((await db.from("brink_sync_state").update({ automatic_enabled: enabled }).eq("connection_id", config.connection)).error);
  return { enabled };
}

export async function brinkCalls(date, { id = null, before = null, exporting = false } = {}) {
  if (!validBusinessDate(date)) throw new BrinkError("Choose a valid business date.", 400);
  const config = brinkConfig();
  let query = getSupabaseServer().from("brink_api_calls").select(id ? "*" : "id,business_date,operation,endpoint,source,started_at,finished_at,duration_ms,status,http_status,result_code,response_bytes,response_sha256,response_truncated,order_count,net_sales,error")
    .eq("connection_id", config.connection).eq("business_date", date).order("started_at", { ascending: false });
  if (id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new BrinkError("Invalid call ID.", 400);
    query = query.eq("id", id);
  }
  if (before) {
    if (!Number.isFinite(Date.parse(before))) throw new BrinkError("Invalid page cursor.", 400);
    query = query.lt("started_at", before);
  }
  const { data, error } = await query.limit(id ? 1 : exporting ? 1000 : 50);
  check(error);
  return { environment: config.mode, location: config.label, business_date: date, calls: data,
    next_before: !id && !exporting && data.length === 50 ? data.at(-1).started_at : null,
    evidence_note: "Every Hub PAR request is recorded. XML is sanitized and namespace-normalized, not an unmodified raw response. XML retained for 24 hours (64 KiB per call); metadata retained for 30 days. Prior calls are not reconstructed." };
}
