import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseServer } from "./supabase-server";
import { brinkConfig, BrinkError, fetchOrders, summarizeOrders, validBusinessDate } from "./brink";
import { addDaysISO, getStoreToday } from "./store-time";
import { ordersRequest } from "./brink-evidence";
import { storageSession } from "./brink-storage";
import { employeeDirectory, attachEmployeeNames } from "./brink-employee-directory";
import { definitionDirectory, attachDefinitions } from "./brink-definitions";

export const BRINK_SYNC_VERSION = "2026-09-25.4";
export async function brinkAutomationState(config, session = storageSession()) {
  const db = getSupabaseServer();
  const { data } = await session.run("automation-state", () => db.from("brink_sync_state").select("automatic_enabled,last_daily_date").eq("connection_id", config.connection).maybeSingle());
  return data;
}

function check(error) { if (error) throw new BrinkError("Could not access PAR sync storage. Please try again.", 503); }
export async function brinkStatus(date) {
  if (!validBusinessDate(date)) throw new BrinkError("Choose a valid business date.", 400);
  const config = brinkConfig();
  const status = { configured: config.configured, environment: config.mode, host: config.host, label: config.label,
    scheduled: config.scheduled, publishing: config.publish, business_date: date, day: null, state: null,
    employee_lookup_enabled: process.env.BRINK_EMPLOYEE_LOOKUP_ENABLED === "true" };
  if (!config.configured) return status;
  const db = getSupabaseServer();
  const session = storageSession();
  const [state, day] = await Promise.all([
    session.run("read-state", () => db.from("brink_sync_state").select("attempted_at,last_success_at,last_error,automatic_enabled,last_daily_date").eq("connection_id", config.connection).maybeSingle()),
    session.run("read-snapshot", () => db.from("brink_sales_days").select("business_date,synced_at,orders,summary").eq("connection_id", config.connection).eq("business_date", date).maybeSingle()),
  ]);
  check(state.error); check(day.error);
  // Cached settings also label older saved snapshots; reading this endpoint
  // never issues a PAR request or changes the historical financial values.
  if (day.data?.orders) {
    for (const operation of ["GetDiscounts", "GetDestinations"]) {
      try {
        const directory = await definitionDirectory({ operation, config, db, run: session.run, cacheOnly: true });
        attachDefinitions(day.data.orders, operation, directory);
      } catch { /* Saved orders remain readable without optional settings. */ }
    }
  }
  return { ...status, state: state.data, day: day.data };
}

export async function syncBrink(date, source = "manual", options = {}) {
  if (!validBusinessDate(date) || date > getStoreToday() || date < addDaysISO(getStoreToday(), -90)) throw new BrinkError("Choose a business date within the past 90 days, including today.", 400);
  const config = brinkConfig();
  if (!config.configured) throw new BrinkError("PAR keys have not been configured on the server.", 503);
  const db = getSupabaseServer();
  const attempt = randomUUID();
  const session = options.session || storageSession({ deadline: Date.now() + 45000 });
  const run = session.run;
  const claim = await run("claim-sync", () => db.rpc("brink_claim_sync", { p_connection: config.connection, p_attempt: attempt }));
  if (!claim.data) {
    // A claim may have committed before its response was lost. Recover only
    // our unique attempt; never bypass another run's shared cooldown.
    const owned = await run("check-claim", () => db.from("brink_sync_state").select("attempt_id").eq("connection_id", config.connection).maybeSingle());
    if (owned.data?.attempt_id !== attempt) throw new BrinkError("A sync was recently started. Wait two minutes before syncing again.", 429);
  }
  const started = Date.now();
  const evidence = {};
  let orders, summary;
  try {
    // Persist intent before any outbound request. If logging is unavailable,
    // fail closed rather than making an unrecorded PAR call.
    await run("log-intent", () => db.from("brink_api_calls").upsert({ id: attempt, connection_id: config.connection, environment: config.mode,
      business_date: date, endpoint: `https://${config.host}/Sales2.svc`, source, request_xml: ordersRequest(date),
      integration_version: BRINK_SYNC_VERSION }, { onConflict: "id", ignoreDuplicates: true }));
    const parBudget = session.deadline - Date.now() - 15000;
    if (parBudget < 1000) throw new BrinkError("Database recovery used this run's time budget before PAR could be called.", 503);
    orders = await fetchOrders(config, date, fetch, evidence, Math.min(30000, parBudget));
    summary = summarizeOrders(orders);
    for (const operation of ["GetDiscounts", "GetDestinations"]) {
      const needed = operation === "GetDiscounts" ? orders.some(o => o.discounts?.length) : orders.some(o => o.destination_id);
      if (!needed || session.deadline - Date.now() < 14000) continue;
      const definitionsSession = storageSession({ deadline: Math.min(session.deadline - 12000, Date.now() + 10000) });
      try {
        const directory = await definitionDirectory({ operation, config, db, run: definitionsSession.run, date, source,
          version: BRINK_SYNC_VERSION, deadline: definitionsSession.deadline });
        attachDefinitions(orders, operation, directory);
      } catch { /* Name lookup failure must never prevent saving valid sales. */ }
    }
    // Optional identity enrichment has a separate budget. An unavailable HR
    // lookup must never turn a valid sale into a failed sales import.
    if (process.env.BRINK_EMPLOYEE_LOOKUP_ENABLED === "true" && orders.some(o => o.employee_id) && session.deadline - Date.now() > 22000) {
      const directorySession = storageSession({ deadline: Math.min(session.deadline - 12000, Date.now() + 10000) });
      try {
        const directory = await employeeDirectory({ config, db, run: directorySession.run, date, source,
          version: BRINK_SYNC_VERSION, deadline: session.deadline - 12000 });
        attachEmployeeNames(orders, directory);
        summary.employee_names_checked_at = directory.fetched_at;
      } catch { summary.employee_names_checked_at = null; }
    }
    const saved = await run("save-snapshot", () => db.rpc("brink_finish_sync", { p_connection: config.connection, p_attempt: attempt, p_date: date,
      p_environment: config.mode, p_orders: orders, p_summary: summary, p_publish: config.publish }));
    if (!saved.data) throw new BrinkError("A newer sync started. Refresh to see its result.", 409);
    if (source === "daily") await run("save-reconciliation", () => db.from("brink_sync_state").update({ last_daily_date: date }).eq("connection_id", config.connection).eq("attempt_id", attempt));
    await run("log-success", () => db.from("brink_api_calls").update({ ...evidence, status: "success", finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
      order_count: orders.length, net_sales: summary.net_sales, diagnostics: [...session.diagnostics], error: null }).eq("id", attempt));
  } catch (err) {
    const safe = err instanceof BrinkError ? err : new BrinkError("PAR sync failed. Previous data was preserved.");
    // A separate, short finalization budget ends before the 60-second host limit.
    const cleanup = storageSession({ deadline: Date.now() + 7000, diagnostics: session.diagnostics });
    const results = await Promise.allSettled([
      cleanup.run("record-state-error", () => db.from("brink_sync_state").update({ last_error: safe.message }).eq("connection_id", config.connection).eq("attempt_id", attempt)),
      cleanup.run("record-call-error", () => db.from("brink_api_calls").update({ ...evidence, status: "error", error: safe.message,
        diagnostics: [...session.diagnostics], finished_at: new Date().toISOString(), duration_ms: Date.now() - started }).eq("id", attempt)),
    ]);
    if (results.some((r) => r.status === "rejected")) console.error("brink_finalization_failed", { attempt, version: BRINK_SYNC_VERSION });
    throw safe;
  }
  if (options.snapshotOnly) return { business_date: date, day: { summary }, integration_version: BRINK_SYNC_VERSION, diagnostics: session.diagnostics };
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
  if (id && !/^[0-9a-f-]{36}$/.test(id)) throw new BrinkError("Invalid call ID.", 400);
  if (before && !Number.isFinite(Date.parse(before))) throw new BrinkError("Invalid page cursor.", 400);
  const { data } = await storageSession().run("read-call-log", () => {
    let query = getSupabaseServer().from("brink_api_calls").select(id ? "*" : "id,business_date,operation,endpoint,source,started_at,finished_at,duration_ms,status,http_status,result_code,response_bytes,response_sha256,response_truncated,order_count,net_sales,error,diagnostics,integration_version")
      .eq("connection_id", config.connection).eq("business_date", date).order("started_at", { ascending: false });
    if (id) query = query.eq("id", id);
    if (before) query = query.lt("started_at", before);
    return query.limit(id ? 1 : exporting ? 1000 : 50);
  });
  return { environment: config.mode, location: config.label, business_date: date, calls: data,
    next_before: !id && !exporting && data.length === 50 ? data.at(-1).started_at : null,
    evidence_note: "Every Hub PAR request is recorded. XML is sanitized and namespace-normalized, not an unmodified raw response. XML retained for 24 hours (64 KiB per call); metadata retained for 30 days. Prior calls are not reconstructed." };
}
