import test from "node:test";
import assert from "node:assert/strict";
import { authorizeDataRequest } from "../lib/security/data-policy.js";

const actor = { employee_id: "11111111-1111-4111-8111-111111111111", role: "shift_lead", first_name: "Test", last_name: "Manager" };
const regular = { item_id: "22222222-2222-4222-8222-222222222222", item_name: "Egg patties", quantity: 2, log_date: "2026-10-20", shift: "Night", submitted_by: "Browser name", total_wholesale_cost: 0.5362, total_retail_loss: 0 };
const sandwich = { ...regular, item_name: "Whole Sandwiches", sandwich_type: "Classic Roast Beef", sandwich_retail_price: 4.59, total_retail_loss: 9.18 };
const request = (body, search = "") => authorizeDataRequest({ actor, table: "waste_logs", method: "POST", search, body });

test("mixed ingredient and sandwich waste keeps all columns for PostgREST", () => {
  const columns = [...new Set([...Object.keys(regular), ...Object.keys(sandwich)])];
  const plan = request([regular, sandwich], new URLSearchParams({ columns: columns.map(c => `"${c}"`).join(",") }).toString());
  assert.deepEqual(plan.params.get("columns")?.split(","), columns.map(c => `"${c}"`));
  assert.equal(plan.body[0].submitted_by, "Test Manager");
  assert.equal(plan.body[1].sandwich_retail_price, 4.59);
  assert.equal(plan.body[0].total_wholesale_cost, 0.5362);
});

test("mixed waste without SDK metadata generates columns in either row order", () => {
  for (const rows of [[regular, sandwich], [sandwich, regular]]) {
    const plan = request(rows);
    assert.ok(plan.params.get("columns")?.includes('"sandwich_type"'));
    assert.ok(plan.params.get("columns")?.includes('"sandwich_retail_price"'));
  }
});

test("bulk columns include server-owned fields and still reject unknown fields", () => {
  const plan = authorizeDataRequest({ actor: { ...actor, role: "gm" }, table: "inventory_logs", method: "POST", search: "", body: [{ item_name: "Test", submitted_by: "Spoofed" }] });
  assert.ok(plan.params.get("columns")?.includes('"store_id"'));
  assert.equal(plan.body[0].store_id, "07462");
  assert.throws(() => request([{ ...regular, unknown: true }, sandwich]), { status: 403 });
  assert.throws(() => request([regular], 'columns="unknown"'), { status: 403 });
});
