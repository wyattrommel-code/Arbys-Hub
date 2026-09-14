import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { storageSession } from "../lib/brink-storage.js";
import { getStoreToday } from "../lib/store-time.js";

// Keep the real orchestration/parser and replace only its external services.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier === "./supabase-server") return { url: "data:text/javascript,export function getSupabaseServer(){return globalThis.brinkTestDb}", shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { syncBrink } = await import("../lib/brink-server.js");
const date = getStoreToday();
const connectionFailure = { error: { message: "TypeError: fetch failed" }, status: 0 };

function database({ lose = [], failIntent = false, occupied = false } = {}) {
  const state = { attempt_id: occupied ? "another-attempt" : null }, calls = new Map(), snapshots = new Map(), executions = [];
  const lost = new Set();
  function builder(table, rpc, args) {
    let method, payload;
    const filters = {};
    const q = {
      select() { method = "select"; return q; },
      update(value) { method = "update"; payload = structuredClone(value); return q; },
      upsert(value) { method = "upsert"; payload = structuredClone(value); return q; },
      eq(key, value) { filters[key] = value; return q; },
      maybeSingle() { return q; }, retry(value) { assert.equal(value, false); return q; },
      abortSignal() { return q; },
      then(resolve, reject) {
        try {
          let stage, data = null;
          if (rpc === "brink_claim_sync") {
            stage = "claim-sync"; data = !state.attempt_id;
            if (data) state.attempt_id = args.p_attempt;
          } else if (rpc === "brink_finish_sync") {
            stage = "save-snapshot"; data = state.attempt_id === args.p_attempt;
            if (data) snapshots.set(args.p_date, args.p_orders);
          } else if (table === "brink_sync_state" && method === "select") {
            stage = "check-claim"; data = { ...state };
          } else if (table === "brink_api_calls" && method === "upsert") {
            stage = "log-intent";
            if (failIntent) return resolve({ error: { code: "42501" }, status: 403 });
            if (!calls.has(payload.id)) calls.set(payload.id, { status: "started", ...payload });
          } else if (table === "brink_api_calls") {
            stage = payload.status === "success" ? "log-success" : "record-call-error";
            if (calls.has(filters.id)) Object.assign(calls.get(filters.id), payload);
          } else {
            stage = payload.last_daily_date ? "save-reconciliation" : "record-state-error";
            Object.assign(state, payload);
          }
          executions.push(stage);
          // Simulate a committed write whose HTTP response was lost.
          if (lose.includes(stage) && !lost.has(stage)) { lost.add(stage); return resolve(connectionFailure); }
          resolve({ data, error: null, status: 200 });
        } catch (e) { reject(e); }
      },
    };
    return q;
  }
  return { from: table => builder(table), rpc: (name, args) => builder(null, name, args), state, calls, snapshots, executions };
}
function setup(t, options = {}, parCode = 0) {
  const oldFetch = globalThis.fetch;
  const oldEnv = { ...process.env };
  Object.assign(process.env, { BRINK_ACCESS_TOKEN: "synthetic-access", BRINK_LOCATION_TOKEN: "synthetic-location", BRINK_ENVIRONMENT: "sandbox", BRINK_API_HOST: "api-apiint.brinkpos.net", BRINK_PUBLISH_HOURLY_SALES: "false" });
  const db = database(options); globalThis.brinkTestDb = db;
  let parCalls = 0;
  globalThis.fetch = async () => {
    parCalls++;
    return new Response(`<Envelope><Body><GetOrdersResponse><GetOrdersResult><ResultCode>${parCode}</ResultCode><Orders></Orders></GetOrdersResult></GetOrdersResponse></Body></Envelope>`);
  };
  t.after(() => { globalThis.fetch = oldFetch; process.env = oldEnv; delete globalThis.brinkTestDb; });
  return { db, count: () => parCalls, session: storageSession({ report() {}, sleep: async () => {} }) };
}
test("lost write responses recover without duplicate PAR calls, snapshots or log rows", async t => {
  const { db, count, session } = setup(t, { lose: ["claim-sync", "log-intent", "save-snapshot", "log-success"] });
  const result = await syncBrink(date, "automatic", { session, snapshotOnly: true });
  assert.equal(count(), 1);
  assert.equal(db.snapshots.size, 1);
  assert.equal(db.calls.size, 1);
  const row = [...db.calls.values()][0];
  assert.equal(row.status, "success");
  assert.equal(row.diagnostics.length, 4);
  assert.equal(result.diagnostics.length, 4);
  assert.ok(db.executions.includes("check-claim"));
});
test("a different attempt owns the cooldown: no PAR request or snapshot write", async t => {
  const { db, count, session } = setup(t, { occupied: true });
  await assert.rejects(syncBrink(date, "automatic", { session, snapshotOnly: true }), e => e.status === 429);
  assert.equal(count(), 0); assert.equal(db.snapshots.size, 0);
});
test("log intent failure stops before contacting PAR", async t => {
  const { db, count, session } = setup(t, { failIntent: true });
  await assert.rejects(syncBrink(date, "automatic", { session, snapshotOnly: true }), /log-intent failed/);
  assert.equal(count(), 0); assert.equal(db.snapshots.size, 0);
});
test("a PAR result-code error is preserved and is never retried or saved as zero sales", async t => {
  const { db, count, session } = setup(t, {}, 1);
  await assert.rejects(syncBrink(date, "automatic", { session, snapshotOnly: true }));
  assert.equal(count(), 1); assert.equal(db.snapshots.size, 0);
  const row = [...db.calls.values()][0];
  assert.equal(row.status, "error"); assert.equal(row.http_status, 200); assert.equal(row.result_code, "1");
});
