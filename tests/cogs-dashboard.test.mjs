import test from "node:test";
import assert from "node:assert/strict";
import { buildCogsDashboard, linkItemCosts } from "../lib/cogs.js";
import { canAccess, featureForPathname } from "../lib/permissions.js";
import { readFile } from "node:fs/promises";

const cogsPageSource = await readFile(new URL("../app/cogs/page.js", import.meta.url), "utf8");

test("COGS dashboard is GM-only in navigation and middleware policy", () => {
  assert.equal(canAccess("crew", "cogs.view"), false);
  assert.equal(canAccess("assistant_manager", "cogs.view"), false);
  assert.equal(canAccess("gm", "cogs.view"), true);
  assert.equal(featureForPathname("/cogs"), "cogs.view");
  assert.equal(featureForPathname("/cogs/details"), "cogs.view");
});

test("dashboard labels proxies, keeps missing guests null, and separates transactions", () => {
  const result = buildCogsDashboard({
    invoices: [{ food_total: "100", non_food_total: "8", parser_version: "v1", imported_at: "2026-09-20T10:00:00Z" }],
    lines: [
      { sku: "111", description: "Food one", category: "FOOD", extended_amount: "70" },
      { sku: "222", description: "Food two", is_food: true, extended_amount: "30" },
      { sku: "999", category: "PAPER", extended_amount: "500" },
    ],
    windows: [{ start_date: "2026-09-01", end_date: "2026-09-07", food_total: 100, net_sales: 1000, closed_orders: 250, guest_count: null, expected_sales_days: 7, covered_sales_days: 7, is_complete: true }],
    costs: [],
  });
  assert.equal(result.metric_label, "PROXY");
  assert.match(result.methodology, /not actual or theoretical COGS/);
  assert.equal(result.summary.fee_non_food_total, 8);
  assert.deepEqual(result.top_food_skus.map((row) => row.sku), ["111", "222"]);
  assert.equal(result.windows[0].food_percent_proxy, 10);
  assert.equal(result.windows[0].guest_count, null);
  assert.equal(result.windows[0].food_per_guest_proxy, null);
  assert.equal(result.windows[0].closed_orders, 250);
  assert.equal(result.windows[0].food_per_closed_order_proxy, 0.4);
});

test("partial and open windows cannot masquerade as complete", () => {
  const { windows, incomplete_window_count } = buildCogsDashboard({ windows: [
    { start_date: "2026-09-01", end_date: "2026-09-07", expected_sales_days: 7, covered_sales_days: 5, is_complete: true },
    { start_date: "2026-09-08", end_date: null, expected_sales_days: null, covered_sales_days: 2, is_complete: true },
  ] });
  assert.equal(incomplete_window_count, 2);
  assert.ok(windows.every((row) => !row.is_complete));
  assert.ok(windows.find((row) => row.start_date === "2026-09-08").is_open);
});

test("cost linking requires a verified database mapping and matching price basis", () => {
  const costs = [{ sku: "123456", purchase_uom: "CS", price_basis: "shipped_unit", price_uom: "CS", current_purchase_unit_cost: 24, current_observed_at: "2026-09-20" }];
  const items = [
    { id: "description-only", item_name: "Same words as invoice", purchase_uom: "CS", case_wholesale_cost: 10 },
    { id: "no-basis", mclane_sku: "123456", case_wholesale_cost: 11 },
    { id: "wrong-basis", mclane_sku: "123456", mclane_purchase_uom: "EA", case_wholesale_cost: 12 },
    { id: "mapped", mclane_sku: "123456", mclane_purchase_uom: "CASE", case_wholesale_cost: 13, bag_wholesale_cost: 2, bags_per_case: 12 },
  ];
  const mappings = [{ target_type: "inventory", target_item_id: "mapped", supplier_sku: "123456", supplier_uom: "CS", price_basis: "shipped_unit", price_uom: "CS", target_uom: "CS", is_verified: true, verification_source: "signed packing specification", mapping_version: 1 }];
  const linked = linkItemCosts(items, costs, "inventory", mappings);
  assert.equal(linked[0].case_wholesale_cost, 10);
  assert.equal(linked[1].case_wholesale_cost, 11);
  assert.equal(linked[2].case_wholesale_cost, 12);
  assert.equal(linked[3].case_wholesale_cost, 24);
  assert.equal(linked[3].bag_wholesale_cost, 2);
  assert.match(linked[3].cost_source, /signed packing specification/);
});

test("waste and catch-weight costs retain manual values without explicit verified conversion", () => {
  const cost = [{ sku: "654321", purchase_uom: "CS", price_basis: "shipped_unit", price_uom: "CS", current_purchase_unit_cost: 30 }];
  const base = { id: "w1", unit_wholesale_cost: 1.25 };
  assert.equal(linkItemCosts([base], cost, "waste")[0].unit_wholesale_cost, 1.25);
  const mapping = [{ target_type: "waste", target_item_id: "w1", supplier_sku: "654321", supplier_uom: "CS", price_basis: "shipped_unit", price_uom: "CS", target_uom: "EA", cost_multiplier: 1 / 15, is_verified: true, verification_source: "case pack", mapping_version: 1 }];
  const mapped = linkItemCosts([base], cost, "waste", mapping)[0];
  assert.equal(mapped.unit_wholesale_cost, 2);
  const weight = [{ sku: "654321", purchase_uom: "CS", price_basis: "catch_weight", price_uom: "LB", current_purchase_unit_cost: 3 }];
  const noConversion = [{ ...mapping[0], price_basis: "catch_weight", price_uom: "LB", cost_multiplier: null }];
  assert.equal(linkItemCosts([base], weight, "waste", noConversion)[0].unit_wholesale_cost, 1.25);
});

test("price changes use the cost-master purchase-unit observations, not serving costs", () => {
  const result = buildCogsDashboard({ costs: [{ sku: "1", uom: "CS", price_basis: "catch_weight", price_uom: "LB", latest_unit_price: 22, prior_unit_price: 20, latest_delivery_date: "2026-09-20" }] });
  assert.equal(result.price_changes[0].change_percent, 10);
  assert.equal(result.price_changes[0].purchase_uom, "CS");
  assert.equal(result.price_changes[0].price_uom, "LB");
  assert.equal(result.price_changes[0].price_basis, "catch_weight");
  assert.equal(result.price_changes[0].current_observed_at, "2026-09-20");
  assert.match(cogsPageSource, /row\.price_uom \|\| row\.purchase_uom/);
  assert.match(cogsPageSource, /row\.price_basis === "catch_weight"/);
});
