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
      order() { return q; }, limit() { return q; },
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
          } else if (table === "brink_api_calls" && method === "select") {
            stage = "read-employee-directory"; data = [];
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
  Object.assign(process.env, { BRINK_ACCESS_TOKEN: "synthetic-access", BRINK_LOCATION_TOKEN: "synthetic-location", BRINK_ENVIRONMENT: "sandbox", BRINK_API_HOST: "api-apiint.brinkpos.net", BRINK_PUBLISH_HOURLY_SALES: "false", BRINK_EMPLOYEE_LOOKUP_ENABLED: options.employeeLookupOff ? "false" : "true" });
  const db = database(options); globalThis.brinkTestDb = db;
  let parCalls = 0;
  globalThis.fetch = async (url, init) => {
    parCalls++;
    if (url.endsWith('/Settings.svc')) {
      if (options.definitionsDenied) return new Response('<Envelope><Body><Fault><faultstring>Unavailable</faultstring></Fault></Body></Envelope>', {status:503});
      const op = init.headers.SOAPAction.includes('GetDiscounts') ? 'GetDiscounts' : 'GetDestinations';
      const entry = op === 'GetDiscounts' ? '<Discount><Id>99</Id><Name>Manager Meal</Name></Discount>' : '<Destination><Id>1</Id><Name>Eat In</Name></Destination>';
      return new Response(`<Envelope><Body><${op}Response><${op}Result>${entry}</${op}Result></${op}Response></Body></Envelope>`);
    }
    if (url.endsWith('/Settings2.svc')) return new Response(`<Envelope><Body><GetEmployeesResponse><GetEmployeesResult><ResultCode>${options.employeeDenied ? '4' : '0'}</ResultCode><Collection><Employee><Id>42</Id><DisplayName>Test Employee</DisplayName><Pin>private-pin</Pin></Employee></Collection></GetEmployeesResult></GetEmployeesResponse></Body></Envelope>`);
    const order = options.withOrder ? `<Order><Id>123</Id><Number>100</Number><BusinessDate>${date}</BusinessDate><IsClosed>true</IsClosed><EmployeeId>42</EmployeeId><OpenedTime>${date}T16:00:00Z</OpenedTime><Subtotal>5</Subtotal><NetSales>5</NetSales><Tax>0</Tax><Total>5</Total><Entries/></Order>` : '';
    const enriched = options.definitions ? order.replace('</Order>', '<DestinationId>1</DestinationId><Discounts><OrderDiscount><Id>2</Id><DiscountId>99</DiscountId><Amount>1</Amount></OrderDiscount></Discounts></Order>') : order;
    return new Response(`<Envelope><Body><GetOrdersResponse><GetOrdersResult><ResultCode>${parCode}</ResultCode><Message>Register unavailable; AccessToken=synthetic-access</Message><Orders>${enriched}</Orders></GetOrdersResult></GetOrdersResponse></Body></Envelope>`);
  };
  t.after(() => { globalThis.fetch = oldFetch; process.env = oldEnv; delete globalThis.brinkTestDb; });
  return { db, count: () => parCalls, session: storageSession({ report() {}, sleep: async () => {} }) };
}

test('definition enrichment is saved with sales, with separate safe call logs', async t => {
  const {db,count,session}=setup(t,{withOrder:true,definitions:true,employeeLookupOff:true});
  await syncBrink(date,'automatic',{session,snapshotOnly:true});
  assert.equal(count(),3);assert.equal(db.calls.size,3);
  const order=db.snapshots.get(date)[0];
  assert.equal(order.destination_name,'Eat In');assert.equal(order.discounts[0].name,'Manager Meal');assert.equal(order.net_sales,5);
  assert.ok(!JSON.stringify([...db.calls.values()]).includes('synthetic-access'));
  assert.equal([...db.calls.values()].filter(c=>c.status==='success').length,3);
});
test('definition failures never block saving valid sales', async t => {
  const {db,session}=setup(t,{withOrder:true,definitions:true,definitionsDenied:true,employeeLookupOff:true});
  await syncBrink(date,'automatic',{session,snapshotOnly:true});
  assert.equal(db.snapshots.get(date)[0].net_sales,5);
  assert.equal(db.snapshots.get(date)[0].discounts[0].name,'');
  assert.equal([...db.calls.values()].filter(c=>c.status==='error').length,2);
  assert.equal([...db.calls.values()].filter(c=>c.status==='success').length,1);
});
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
  assert.match(row.error, /PAR message \(redacted\): Register unavailable/);
  assert.match(row.response_xml, /<Message>/);
  assert.equal(db.state.last_error, row.error);
  assert.ok(!JSON.stringify(row).includes('synthetic-access'));
});

test("successful identity enrichment is persisted and logged separately from sales", async t => {
  const { db, count, session } = setup(t, { withOrder: true });
  await syncBrink(date, 'automatic', { session, snapshotOnly: true });
  assert.equal(count(), 2); assert.equal(db.calls.size, 2);
  assert.equal(db.snapshots.get(date)[0].employee_name, 'Test Employee');
  assert.ok(!JSON.stringify([...db.calls.values()]).includes('private-pin'));
  assert.equal([...db.calls.values()].filter(c => c.status === 'success').length, 2);
});

test("employee permission failure leaves sales successful with IDs and a separate failed call", async t => {
  const { db, session } = setup(t, { withOrder: true, employeeDenied: true });
  const result = await syncBrink(date, 'automatic', { session, snapshotOnly: true });
  assert.equal(result.day.summary.net_sales, 5);
  assert.equal(db.snapshots.get(date)[0].employee_id, '42');
  assert.equal(db.snapshots.get(date)[0].employee_name, null);
  assert.equal([...db.calls.values()].filter(c => c.status === 'error').length, 1);
});

test("disabled employee lookup makes no Settings2 request and retains detailed sales", async t => {
  const { db, count, session } = setup(t, { withOrder: true, employeeLookupOff: true });
  await syncBrink(date, 'automatic', { session, snapshotOnly: true });
  assert.equal(count(), 1); assert.equal(db.calls.size, 1);
  assert.equal(db.snapshots.get(date)[0].employee_id, '42');
  assert.equal(db.snapshots.get(date)[0].details_version, 2);
});
