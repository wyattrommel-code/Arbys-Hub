import test from "node:test";
import assert from "node:assert/strict";
import { authorizeDataRequest } from "../lib/security/data-policy.js";
import { protectPhotoUrls } from "../lib/security/photo-urls.js";
import { canChangeCompletion, completionInputError } from "../lib/security/checklist-policy.js";
import { createSessionToken, verifySessionToken } from "../lib/session.js";
import { currentActor } from "../lib/security/current-actor.js";

const crew = { employee_id: "11111111-1111-4111-8111-111111111111", first_name: "Test", last_name: "Crew", role: "crew" };
const gm = { ...crew, role: "gm" };
const lead = { ...crew, role: "shift_lead" };
const plan = (overrides = {}) => authorizeDataRequest({ actor: crew, table: "employees", method: "GET", search: "", ...overrides });
const denied = (overrides) => assert.throws(() => plan(overrides), { status: 403 });

test("unauthenticated and unknown-role/table requests fail closed", () => {
  for (const actor of [null, {}, { ...crew, role: "owner" }]) denied({ actor });
  for (const table of ["pg_authid", "rpc", "checklist_completions", "attendance_settings", "__proto__"]) denied({ table });
  denied({ method: "PUT" });
});
test("roster never exposes PINs; personal details are GM-only", () => {
  const columns = plan().params.get("select").split(",");
  for (const column of ["employee_code", "email", "phone", "notes"]) assert.ok(!columns.includes(column));
  assert.ok(!plan({ actor: gm }).params.get("select").includes("employee_code"));
  assert.ok(plan({ actor: gm }).params.get("select").includes("email"));
  for (const select of ["employee_code", "email", "pin:employee_code", "*,employee_code", "employee_code::text", "employee_wages(*)", "*,notes", "count()"]) denied({ search: `select=${encodeURIComponent(select)}` });
  denied({ actor: gm, search: "select=employee_code" });
});
test("filters cannot probe hidden credentials or traverse relationships", () => {
  for (const search of ["employee_code=eq.1234", "order=employee_code", "or=(employee_code.eq.1234)", "employees.email=eq.a", "select=id,roles(*)", "limit=0;drop", "id=custom.expression"]) denied({ search });
  assert.equal(plan({ search: "last_name=ilike.Test*&order=last_name.asc" }).params.get("last_name"), "ilike.Test*");
  denied({ search: "select=id&select=employee_code" });
  denied({ search: "on_conflict=employee_id,day_of_week&on_conflict=id" });
});
test("crew cannot read wages or change access roles, punches, or sales imports", () => {
  for (const table of ["employee_wages", "labor_logs", "training_sessions", "certification_attempts"]) denied({ table });
  for (const table of ["employees", "roles", "employee_roles", "time_punches", "hourly_sales"]) denied({ table, method: "POST", body: {} });
  denied({ actor: lead, table: "employee_wages" });
  assert.ok(plan({ actor: gm, table: "employee_wages" }));
});
test("own-record scope cannot be replaced by a browser filter", () => {
  for (const table of ["time_punches", "break_punches", "schedule_shifts", "employee_availability", "time_off_requests"]) {
    const scoped = plan({ table, search: "employee_id=eq.someone-else" });
    assert.deepEqual(scoped.params.getAll("employee_id"), ["eq.someone-else", `eq.${crew.employee_id}`]);
  }
  assert.deepEqual(plan({ search: "store_id=eq.other" }).params.getAll("store_id"), ["eq.other", "in.(07462,payson)", "eq.07462"]);
});
test("availability upserts cannot take over another employee's row", () => {
  const request = { table: "employee_availability", method: "POST", search: "on_conflict=employee_id,day_of_week", prefer: "resolution=merge-duplicates", body: [{ employee_id: crew.employee_id, day_of_week: 1, is_available: true }] };
  assert.equal(plan(request).body[0].employee_id, crew.employee_id);
  denied({ ...request, body: [{ employee_id: "other", day_of_week: 1 }] });
  denied({ ...request, body: [{ id: "stolen-id", employee_id: crew.employee_id }] });
  denied({ ...request, search: "on_conflict=id" });
});
test("time-off creation cannot self-approve or spoof ownership", () => {
  const request = { table: "time_off_requests", method: "POST", body: { start_date: "2026-09-10", end_date: "2026-09-11", status: "approved" } };
  const result = plan(request).body;
  assert.equal(result.status, "pending"); assert.equal(result.employee_id, crew.employee_id);
  denied({ ...request, body: { ...request.body, reviewed_by: "GM" } });
  denied({ ...request, prefer: "resolution=merge-duplicates", search: "on_conflict=id" });
  denied({ ...request, method: "PATCH", search: "id=eq.a" });
  const reviewed = plan({ actor: lead, table: "time_off_requests", method: "PATCH", search: "id=eq.a", body: { status: "approved", reviewed_by: "Fake" } });
  assert.equal(reviewed.body.reviewed_by, "Test Crew");
});
test("state-changing operations use an allowlist and require row scope", () => {
  denied({ actor: gm, method: "DELETE" });
  denied({ table: "roast_entries", method: "POST", body: { sheet_date: "2026-09-08", surprise: true } });
  denied({ actor: gm, method: "POST", body: { first_name: "x", store_id: "another-store" } });
  denied({ actor: gm, method: "POST", body: { employee_code: "$2b$hash" } });
  const saved = plan({ table: "roast_entries", method: "POST", search: "on_conflict=sheet_date,daypart", prefer: "resolution=merge-duplicates", body: { sheet_date: "2026-09-08", daypart: "6am", on_hand: 4 } });
  assert.equal(saved.body.on_hand, 4);
});
test("checklist completion edits require ownership or GM access", () => {
  const completion = { completed_by_employee_id: "other" };
  assert.equal(canChangeCompletion(crew, completion), false);
  assert.equal(canChangeCompletion(lead, completion), false);
  assert.equal(canChangeCompletion(gm, completion), true);
  assert.equal(canChangeCompletion(crew, { completed_by_employee_id: crew.employee_id }), true);
  const task = { is_active: true, shift: "AM", verification_method: "photo" };
  assert.ok(completionInputError(crew, task, "2026-09-08", "AM", "2026-09-08", false));
  assert.equal(completionInputError(crew, task, "2026-09-08", "AM", "2026-09-08", true), null);
  assert.ok(completionInputError(crew, { ...task, role: "manager_closing" }, "2026-09-08", "AM", "2026-09-08", true));
});
test("stored public photo URLs become authenticated application paths", () => {
  const photo = "https://example.supabase.co/storage/v1/object/public/punch-photos/payson/employee/image.jpg";
  assert.deepEqual(protectPhotoUrls({ rows: [{ photo }] }), { rows: [{ photo: "/api/photos/punch-photos/payson/employee/image.jpg" }] });
  assert.equal(protectPhotoUrls("https://elsewhere.example/x.jpg"), "https://elsewhere.example/x.jpg");
});
test("signed sessions reject tampering, extra segments and cross-purpose use", async () => {
  process.env.SESSION_SECRET = "test-only-secret-not-a-production-credential";
  const token = await createSessionToken(crew);
  assert.equal((await verifySessionToken(token)).employee_id, crew.employee_id);
  assert.equal(await verifySessionToken(token + ".ignored"), null);
  assert.equal(await verifySessionToken(token + "tampered"), null);
  const kiosk = await createSessionToken(lead, "kiosk");
  assert.equal(await verifySessionToken(kiosk), null);
  assert.equal(await verifySessionToken(token, "kiosk"), null);
  assert.ok(await verifySessionToken(kiosk, "kiosk"));
});
function fakeDb(employee, roles, fail = false) {
  return { from(table) {
    const response = { data: table === "employees" ? employee : roles.map((r) => ({ employee_id: crew.employee_id, role_id: "r", roles: { id: "r", name: "Test", ...r } })), error: fail ? new Error("unavailable") : null };
    const builder = { select() { return this; }, eq() { return this; }, maybeSingle() { return Promise.resolve(response); }, then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); } };
    return builder;
  } };
}
test("deactivation, demotion and inactive roles invalidate cached authority", async () => {
  const row = { id: crew.employee_id, first_name: "Test", last_name: "Crew", is_active: true, status: "active", store_id: "07462", role: "crew" };
  assert.equal(await currentActor(fakeDb({ ...row, is_active: false }, []), gm), null);
  assert.equal(await currentActor(fakeDb({ ...row, status: "terminated" }, []), gm), null);
  assert.equal((await currentActor(fakeDb(row, [{ access_tier: "crew", is_active: true }]), gm)).role, "crew");
  assert.equal(await currentActor(fakeDb(row, [{ access_tier: "gm", is_active: false }]), gm), null);
  await assert.rejects(currentActor(fakeDb(row, [], true), gm));
});
