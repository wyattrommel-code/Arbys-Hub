import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizedStoreId, supportsScopedStore } from "../lib/store-scope.js";
import { createStore, resolveStoreAccess } from "../lib/store-access-server.js";
import { MAX_MANUAL_BYTES, nextScheduleDate, storeToday, validateEquipment, validateEquipmentSchedule, validateManual } from "../lib/equipment.js";
import { archiveManual, beginManualUpload, completeEquipmentTask, downloadManual, equipmentRecord, finishManualUpload, saveEquipment } from "../lib/equipment-server.js";
import { createSessionToken, verifySessionToken } from "../lib/session.js";

const equipmentId = "11111111-1111-4111-8111-111111111111";
const manualId = "22222222-2222-4222-8222-222222222222";
const manager = { employee_id: "manager", role: "gm", store_id: "A", store_verified: true };
const crew = { ...manager, employee_id: "crew", role: "crew" };
const baseEquipment = { id: equipmentId, store_id: "A", name: "Test machine", status: "active", version: 1 };
const baseManual = { id: manualId, equipment_id: equipmentId, store_id: "A", title: "Manual", file_name: "manual.pdf", file_size: 100, object_path: `A/${equipmentId}/${manualId}.pdf`, status: "uploading" };
const schedule = { title: "Approved task", instructions: "Approved instructions", kind: "cleaning", frequency_unit: "days", frequency_interval: 1, start_date: "2026-10-21", shift: "PM", responsible_role: "crew", is_active: true };

function fixture(options = {}) {
  const state = { tables: { hub_equipment: [structuredClone(baseEquipment)], hub_equipment_manuals: [structuredClone(baseManual)], hub_equipment_tasks: [{ id: manualId, store_id: "A", status: "pending", responsible_role: "crew" }] }, signed: [], uploads: [], infoCalls: [], rpcCalls: [] };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.kind = "select"; }
    select() { return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    insert(value) { this.kind = "insert"; this.value = value; return this; }
    update(value) { this.kind = "update"; this.value = value; return this; }
    maybeSingle() { return this.run(true); }
    then(resolve, reject) { return this.run(false).then(resolve, reject); }
    async run(single) {
      const table = state.tables[this.table];
      let rows = table.filter((row) => this.filters.every(([key, value]) => row[key] === value));
      if (this.kind === "insert") { rows = [{ status: "uploading", ...this.value }]; table.push(...rows); }
      if (this.kind === "update") rows.forEach((row) => Object.assign(row, this.value));
      return { data: structuredClone(single ? rows[0] || null : rows), error: null };
    }
  }
  return { state, from: (table) => new Query(table), rpc: async (name, args) => { state.rpcCalls.push({ name, args }); return { data: name === "save_hub_equipment" ? { ...baseEquipment, ...args.p_values } : { id: manualId }, error: null }; }, storage: { from: () => ({
    createSignedUploadUrl: async (path, opts) => { state.uploads.push({ path, opts }); return options.failTicket ? { error: new Error("Ticket failure") } : { data: { token: "test-ticket" }, error: null }; },
    info: async (path) => { state.infoCalls.push(path); return { data: options.info || { size: 100, contentType: "application/pdf" }, error: null }; },
    createSignedUrl: async (...args) => { state.signed.push(args); return { data: { signedUrl: "https://test.example/signed-pdf" }, error: null }; },
  }) } };
}

test("requires a store context verified on the server", () => {
  assert.throws(() => authorizedStoreId({ store_id: "A", role: "gm" }), { status: 403 });
  assert.equal(authorizedStoreId(manager), "A");
});
test("signed sessions preserve the selected store and reject tampering", async () => {
  process.env.SESSION_SECRET = "equipment-tests-only-session-secret";
  const token = await createSessionToken({ employee_id: "employee", first_name: "Test", last_name: "Employee", role: "gm", store_id: "B", store_verified: true });
  const session = await verifySessionToken(token);
  assert.equal(session.store_id, "B");
  assert.equal("store_verified" in session, false);
  const [body, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  payload.store_id = "another-store";
  assert.equal(await verifySessionToken(`${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`), null);
});
test("limits secondary-store navigation to scoped modules", () => {
  for (const path of ["/database", "/database/equipment/123", "/checklist", "/api/equipment/due", "/api/stores/select"]) assert.equal(supportsScopedStore(path), true);
  for (const path of ["/api/timecards", "/people", "/api/equipments-other", "/database-other"]) assert.equal(supportsScopedStore(path), false);
});
test("resolves membership role freshly and rejects an unassigned store", async () => {
  let active = true;
  const db = {
    from: () => ({ select: () => ({ eq: async () => ({ data: [{ employee_id: "x", role_id: "r", roles: { id: "r", name: "Crew", access_tier: "crew", is_active: active } }], error: null }) }) }),
    rpc: async () => ({ data: { employee: { employee_id: "x", first_name: "Test", last_name: "User", home_store_id: "A" }, stores: [{ id: "A", role: "gm", follows_home_role: true }, { id: "B", role: "assistant_manager" }] }, error: null }),
  };
  assert.equal((await resolveStoreAccess(db, { employee_id: "x", role: "gm" })).employee.role, "crew");
  assert.equal((await resolveStoreAccess(db, { employee_id: "x", store_id: "B" })).employee.role, "assistant_manager");
  await assert.rejects(resolveStoreAccess(db, { employee_id: "x", store_id: "C" }), { status: 403 });
  await assert.rejects(resolveStoreAccess(db, null), { status: 401 });
  active = false;
  await assert.rejects(resolveStoreAccess(db, { employee_id: "x", store_id: "B", role: "gm" }), { status: 403 });
});
test("does not fall back to a copied session when access is revoked or lookup fails", async () => {
  await assert.rejects(resolveStoreAccess({ rpc: async () => ({ data: null, error: null }) }, { employee_id: "x", role: "gm", store_id: "A" }), { status: 403 });
  await assert.rejects(resolveStoreAccess({ rpc: async () => ({ error: new Error("Offline") }) }, { employee_id: "x", role: "gm" }), /Offline/);
});
test("only organization administrators can add stores", async () => {
  await assert.rejects(createStore(fixture(), { employee: manager, store: { can_create_store: false } }, { name: "New" }), { status: 403 });
  await assert.rejects(createStore(fixture(), { employee: manager, store: { can_create_store: true } }, { name: "New", timezone: "Invalid/Zone" }), /time zone/);
});
test("validates equipment details and lifecycle states", () => {
  assert.equal(validateEquipment({ name: " Slicer " }).name, "Slicer");
  assert.throws(() => validateEquipment({ name: "" }));
  assert.throws(() => validateEquipment({ name: "Slicer", status: "unknown" }));
});
test("validates recurring task fields and real dates", () => {
  assert.equal(validateEquipmentSchedule(schedule, "2026-10-21").shift, "PM");
  for (const change of [{ start_date: "2026-02-30" }, { frequency_interval: 0 }, { frequency_interval: 1.5 }, { shift: "BOTH" }, { responsible_role: "unknown" }, { frequency_unit: "years" }, { is_active: "true" }]) assert.throws(() => validateEquipmentSchedule({ ...schedule, ...change }, "2026-10-21"));
});
test("existing schedules retain an older calendar anchor when edited", () => {
  const historical = { ...schedule, start_date: "2020-01-31" };
  assert.throws(() => validateEquipmentSchedule(historical, "2026-10-21"), { status: 400 });
  assert.equal(validateEquipmentSchedule(historical, "2026-10-21", true).start_date, "2020-01-31");
});

test("enforces PDF-only manuals and larger bounded uploads", () => {
  assert.equal(MAX_MANUAL_BYTES, 50 * 1024 * 1024);
  assert.equal(validateManual({ title: "Large manual", file_name: "manual.pdf", file_size: 30 * 1024 * 1024 }).file_size, 30 * 1024 * 1024);
  assert.equal(validateManual({ title: "Manual", file_name: "manual.PDF", file_size: MAX_MANUAL_BYTES }).file_size, MAX_MANUAL_BYTES);
  assert.throws(() => validateManual({ title: "Manual", file_name: "manual.html", file_size: 100 }));
  assert.throws(() => validateManual({ title: "Manual", file_name: "manual.pdf", file_size: MAX_MANUAL_BYTES + 1 }));
});
test("monthly recurrence clamps without drifting and handles leap years", () => {
  const monthly = { ...schedule, start_date: "2024-01-31", frequency_unit: "months" };
  assert.equal(nextScheduleDate(monthly, "2024-02-01"), "2024-02-29");
  assert.equal(nextScheduleDate(monthly, "2024-03-01"), "2024-03-31");
  assert.equal(nextScheduleDate({ ...monthly, start_date: "2025-01-31" }, "2025-02-01"), "2025-02-28");
});
test("weekly and interval schedules use calendar dates across DST", () => {
  assert.equal(nextScheduleDate({ ...schedule, start_date: "2026-03-01", frequency_unit: "weeks", frequency_interval: 2 }, "2026-03-09"), "2026-03-15");
  assert.equal(nextScheduleDate({ ...schedule, start_date: "2026-10-21", frequency_interval: 3 }, "2026-10-22"), "2026-10-24");
  const instant = new Date("2026-10-22T05:30:00Z");
  assert.equal(storeToday("America/Denver", instant), "2026-10-21");
  assert.equal(storeToday("America/New_York", instant), "2026-10-22");
});
test("equipment lookup never crosses store boundaries", async () => {
  const db = fixture();
  assert.equal((await equipmentRecord(db, manager, equipmentId)).name, "Test machine");
  await assert.rejects(equipmentRecord(db, { ...manager, store_id: "B" }, equipmentId), { status: 404 });
});
test("server-owned store and actor fields override caller input", async () => {
  const db = fixture();
  await saveEquipment(db, manager, { name: "Machine", store_id: "B", created_by: "attacker" });
  assert.equal(db.state.rpcCalls[0].args.p_store, "A");
  assert.equal(db.state.rpcCalls[0].args.p_actor, "manager");
  assert.equal("store_id" in db.state.rpcCalls[0].args.p_values, false);
  await assert.rejects(saveEquipment(db, crew, { name: "Machine" }), { status: 403 });
});
test("manual upload tickets are manager-only and bound to one store and equipment", async () => {
  const db = fixture();
  await assert.rejects(beginManualUpload(db, crew, equipmentId, {}), { status: 403 });
  await assert.rejects(beginManualUpload(db, { ...manager, store_id: "B" }, equipmentId, {}), { status: 404 });
  assert.equal(db.state.uploads.length, 0);
  const ticket = await beginManualUpload(db, manager, equipmentId, { title: "Manual", file_name: "manual.pdf", file_size: 100 });
  assert.match(ticket.path, new RegExp(`^A/${equipmentId}/[\\da-f-]+\\.pdf$`));
  assert.equal(db.state.uploads[0].opts.upsert, false);
});
test("failed ticket creation archives only the pending metadata", async () => {
  const db = fixture({ failTicket: true });
  await assert.rejects(beginManualUpload(db, manager, equipmentId, { title: "Manual", file_name: "manual.pdf", file_size: 100 }), /Ticket failure/);
  assert.equal(db.state.tables.hub_equipment_manuals.at(-1).status, "archived");
  assert.equal(db.state.tables.hub_equipment_manuals[0].status, "uploading");
});
test("manual finalization verifies uploaded size and type", async () => {
  for (const info of [{ size: 101, contentType: "application/pdf" }, { size: 100, contentType: "text/html" }]) {
    const db = fixture({ info });
    await assert.rejects(finishManualUpload(db, manager, equipmentId, manualId), /does not match/);
    assert.equal(db.state.tables.hub_equipment_manuals[0].status, "uploading");
  }
  const db = fixture();
  const result = await finishManualUpload(db, manager, equipmentId, manualId);
  assert.equal(result.status, "ready");
  assert.equal("object_path" in result, false);
});
test("crew can download ready PDFs only from their authorized store", async () => {
  const db = fixture(); db.state.tables.hub_equipment_manuals[0].status = "ready";
  await assert.rejects(downloadManual(db, { ...crew, store_id: "B" }, equipmentId, manualId), { status: 404 });
  assert.equal(db.state.signed.length, 0);
  assert.match(await downloadManual(db, crew, equipmentId, manualId), /^https:/);
  assert.equal(db.state.signed[0][1], 60);
  await assert.rejects(archiveManual(db, crew, equipmentId, manualId), { status: 403 });
});
test("completion sends the authorized actor and validates notes", async () => {
  const db = fixture();
  await completeEquipmentTask(db, crew, manualId, { notes: " Finished ", store_id: "B" });
  assert.equal(db.state.rpcCalls[0].args.p_store, "A");
  assert.equal(db.state.rpcCalls[0].args.p_actor, "crew");
  assert.equal(db.state.rpcCalls[0].args.p_notes, "Finished");
  await assert.rejects(completeEquipmentTask(db, crew, manualId, { notes: {} }), /Invalid/);
  db.state.tables.hub_equipment_tasks[0].responsible_role = "gm";
  await assert.rejects(completeEquipmentTask(db, crew, manualId, { notes: "" }), { status: 403 });
  assert.equal(db.state.rpcCalls.length, 1);
  await assert.rejects(completeEquipmentTask(db, { ...manager, store_id: "B" }, manualId, { notes: "" }), { status: 404 });
});
