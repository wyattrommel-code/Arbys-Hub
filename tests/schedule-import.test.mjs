import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PostgrestClient } from "@supabase/postgrest-js";
import { prepareScheduleImport, planScheduleImport, importScheduleCsv } from "../lib/schedule-import.js";
import { authorizeDataRequest } from "../lib/security/data-policy.js";

// Synthetic fixtures only; these tests do not contact Supabase or use live records.
const dawson = { id: "11111111-1111-4111-8111-111111111111", full_name: "Dawson Campbell", is_active: true, jolt_employee_id: null };
const jared = { id: "22222222-2222-4222-8222-222222222222", full_name: "Jared Campbell", is_active: true, jolt_employee_id: null };
const roster = [jared, dawson];
const header = "Role,Employee,Employee Id,Date,Time In,Time Out,Break Time,Hours";
const line = "Closing,Dawson Campbell,,2026-09-27,4:00 pm,10:30 pm,30 min,6.00";
const csv = (...lines) => [header, ...(lines.length ? lines : [line])].join("\r\n");
const prepare = (text = csv(), people = roster) => prepareScheduleImport(text, people);

test("Sunday weeks, unpaid breaks, stable UUIDs and distinct Campbell assignments", async () => {
  const text = csv(line, line.replace("Dawson", "Jared"));
  const { rows, summary } = await prepare(text);
  assert.equal(rows[0].employee_id, dawson.id);
  assert.equal(rows[1].employee_id, jared.id);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.match(rows[0].id, /^[a-f\d]{8}-[a-f\d]{4}-8[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
  assert.equal(rows[0].week_start_date, "2026-09-27");
  assert.equal(rows[0].unpaid_break_minutes, 30);
  assert.equal(rows[0].scheduled_hours, 6);
  assert.equal(summary.employeesScheduled, 2);
  assert.deepEqual((await prepare(text)).rows, rows);
  const overnight = (await prepare(csv("Night,Dawson Campbell,,2026-10-03,10:00 pm,2:00 am,30 min,3.50"))).rows[0];
  assert.equal(overnight.scheduled_hours, 3.5);
  assert.equal(overnight.week_start_date, "2026-09-27");
});

test("duplicate names need a unique non-null external mapping; unknown and inactive employees fail", async () => {
  const older = { ...dawson, id: jared.id };
  await assert.rejects(prepare(csv(), [dawson, older]), /More than one active profile/);
  const mapped = { ...dawson, jolt_employee_id: "known-person" };
  const text = csv(line.replace("Campbell,,", "Campbell,known-person,"));
  assert.equal((await prepare(text, [older, mapped])).rows[0].employee_id, dawson.id);
  await assert.rejects(prepare(csv(), [jared]), /No active employee matches/);
  await assert.rejects(prepare(csv(), [{ ...dawson, is_active: false }]), /No active employee matches/);
});

test("BOM and quoted fields parse; invalid values stop the whole import", async () => {
  assert.equal((await prepare("\uFEFF" + csv(line.replace("Closing", '"Training, Meeting"')))).rows[0].role, "Training, Meeting");
  assert.equal((await prepare(csv(line.replace("Closing", '"Training\nMeeting"')))).rows[0].role, "Training\nMeeting");
  for (const [bad, expected] of [
    [line.replace("2026-09-27", "2026-02-30"), /invalid shift date/],
    [line.replace("4:00 pm", "13:00 pm"), /start and end times/],
    [line.replace("30 min", "30.5 min"), /whole minutes/],
    [line.replace("30 min", "500 min"), /exceeds/],
    [line.replace("Dawson Campbell", ""), /name is missing/],
  ]) await assert.rejects(prepare(csv(line, bad)), expected);
});

test("repeated CSV lines collapse; conflicting duplicate lines cannot overwrite each other", async () => {
  const result = await prepare(csv(line, line));
  assert.equal(result.rows.length, 1);
  assert.equal(result.summary.duplicateCount, 1);
  await assert.rejects(prepare(csv(line, line.replace("10:30 pm", "11:00 pm"))), /conflicting shifts/);
});

test("reimports keep existing IDs and builder metadata without deleting other shifts", async () => {
  const { rows } = await prepare();
  const existing = { ...rows[0], id: jared.id, scheduled_end: "21:00:00", scheduled_hours: 4.5, station: "Slicer", notes: "Training", source: "hub_builder" };
  const plan = planScheduleImport(rows, [existing, { ...rows[0], id: dawson.id, employee_id: jared.id }]);
  assert.equal(plan.updatedCount, 1);
  assert.equal(plan.writes[0].id, existing.id);
  assert.equal(plan.writes[0].station, "Slicer");
  assert.equal(plan.writes[0].notes, "Training");
  assert.equal(plan.writes[0].source, "hub_builder");
  const retry = planScheduleImport(rows, plan.writes);
  assert.equal(retry.writes.length, 0);
  assert.equal(retry.unchangedCount, 1);
});

test("published weeks and moved imports are protected; ambiguous builder duplicates are not overwritten", async () => {
  const { rows } = await prepare();
  const locked = [{ store_id: "payson", week_start_date: "2026-09-27", status: "published" }];
  assert.throws(() => planScheduleImport(rows, [], locked), /published/);
  assert.equal(planScheduleImport(rows, rows, locked).unchangedCount, 1);
  assert.throws(() => planScheduleImport(rows, [{ ...rows[0], employee_id: jared.id }]), /moved or reassigned/);
  assert.throws(() => planScheduleImport(rows, [{ ...rows[0], shift_date: "2026-10-11" }]), /moved or reassigned/);
  assert.throws(() => planScheduleImport(rows, [rows[0], { ...rows[0], id: jared.id }]), /multiple shifts/);
});

test("real Supabase request uses primary-key upsert against Postgres with no composite unique index", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create table schedule_shifts (
    id uuid primary key, employee_id uuid, employee_name text, jolt_employee_id text,
    shift_date date, week_start_date date, store_id text, scheduled_start time, scheduled_end time,
    unpaid_break_minutes integer, scheduled_hours numeric, role text, station text, notes text, source text
  )`);
  let writes = 0;
  const supabase = new PostgrestClient("https://test.invalid/rest/v1", { fetch: async (input, init = {}) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").at(-1);
    // Exercise the same column/filter/body policy used by the Hub proxy.
    authorizeDataRequest({ actor: { employee_id: dawson.id, role: "gm" }, table,
      method: init.method || "GET", search: url.search,
      body: init.body ? JSON.parse(init.body) : null,
      prefer: new Headers(init.headers).get("prefer") || "" });
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (table === "employees") return reply(roster);
    if (table === "schedule_weeks") return reply([]);
    assert.equal(table, "schedule_shifts");
    if (init.method === "POST") {
      writes += 1;
      assert.equal(url.searchParams.get("on_conflict"), "id");
      const rows = JSON.parse(init.body);
      await db.transaction(async (tx) => {
        for (const row of rows) {
          const keys = Object.keys(row);
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(",");
          await tx.query(`insert into schedule_shifts (${keys.join(",")}) values (${placeholders}) on conflict (id) do update set ${keys.filter(k => k !== "id").map(k => `${k}=excluded.${k}`).join(",")}`, keys.map(key => row[key]));
        }
      });
      return reply([], 201);
    }
    const { rows } = await db.query("select *, shift_date::text, week_start_date::text from schedule_shifts order by id");
    // Match the actual request filters so both date-range and prior-import reads run.
    const ids = url.searchParams.get("id")?.slice(4, -1).split(",");
    const dates = url.searchParams.getAll("shift_date");
    return reply(rows.filter(row => (!ids || ids.includes(row.id)) && dates.every(value => value.startsWith("gte.") ? row.shift_date >= value.slice(4) : row.shift_date <= value.slice(4))));
  } });
  const text = csv(line, line.replace("Dawson", "Jared"));
  const first = await importScheduleCsv(supabase, text);
  assert.equal(first.summary.addedCount, 2);
  const repeated = await importScheduleCsv(supabase, text);
  assert.equal(repeated.summary.unchangedCount, 2);
  assert.equal(writes, 1);
  assert.equal((await db.query("select count(*)::int as count from schedule_shifts")).rows[0].count, 2);
  const edited = await importScheduleCsv(supabase, text.replaceAll("10:30 pm", "11:00 pm"));
  assert.equal(edited.summary.updatedCount, 2);
  assert.equal((await db.query("select sum(scheduled_hours)::float as hours from schedule_shifts")).rows[0].hours, 13);
  // Same-cell builder duplicates remain legal in this schema.
  await db.exec(`insert into schedule_shifts select '${dawson.id}', employee_id, employee_name, jolt_employee_id, shift_date, week_start_date, store_id, scheduled_start, scheduled_end, unpaid_break_minutes, scheduled_hours, role, station, notes, source from schedule_shifts limit 1`);
  await assert.rejects(importScheduleCsv(supabase, text), /multiple shifts/);
});
