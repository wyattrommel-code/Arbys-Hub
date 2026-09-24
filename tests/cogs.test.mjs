import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCogsReport,
  buildWindows,
  deduplicateParsedInvoices,
  parseMcLaneInvoiceText,
} from "../lib/cogs-parser.js";

const fixtureUrl = new URL("./fixtures/mclane-invoice.txt", import.meta.url);
const fixture = await readFile(fixtureUrl, "utf8");
const filename = "mail-1__292855_0007462_12345678.PDF";

function parse(text = fixture, bytes = Buffer.from("synthetic-pdf-v1")) {
  return parseMcLaneInvoiceText({ text, filename, bytes });
}

function parsedInvoice({ number, date, foodTotal, lines = [] }) {
  return {
    invoice: {
      invoice_number: number,
      delivery_date: date,
      food_total: foodTotal,
      source_sha256: number.padEnd(64, "0"),
      source_filename: `292855_0007462_${number}.PDF`,
    },
    lines,
  };
}

function foodLine(sku, description, unitPrice, amount, lineNumber = 1, basis = "shipped_unit") {
  return {
    sku,
    description,
    unit_price: unitPrice,
    extended_amount: amount,
    shipped_quantity: 1,
    is_food: true,
    line_number: lineNumber,
    price_basis: basis,
  };
}

test("parses product, fee credit, catch-weight arithmetic, totals, and source hash", () => {
  const result = parse();
  assert.equal(result.invoice.customer_number, "292855");
  assert.equal(result.invoice.unit_number, "0007462");
  assert.equal(result.invoice.food_total, 50);
  assert.equal(result.invoice.non_food_total, 3);
  assert.equal(result.invoice.total, 53);
  assert.equal(result.lines.length, 4);

  const credit = result.lines.find((line) => line.sku === "089036");
  assert.equal(credit.extended_amount, -2);
  assert.equal(credit.is_food, false);
  assert.equal(credit.category, "MISC. EXPENSES");

  const catchWeight = result.lines.find((line) => line.sku === "232409");
  assert.equal(catchWeight.catch_weight, 10);
  assert.equal(catchWeight.unit_price, 3);
  assert.equal(catchWeight.price_basis, "catch_weight");
  assert.equal(catchWeight.price_uom, "LB");

  // Purchase invoices do not contain recipe yields or per-serving costs, so none are invented.
  for (const line of result.lines) {
    assert.equal("serving_yield" in line, false);
    assert.equal("cost_per_serving" in line, false);
  }
  assert.match(result.invoice.source_sha256, /^[a-f0-9]{64}$/);
});

test("rejects wrong customer even when the filename is for the expected customer", () => {
  assert.throws(() => parse(fixture.replace("CUSTOMER 292855", "CUSTOMER 292760")), /Wrong customer 292760/);
});

test("rejects filename/document mismatch and malformed totals", () => {
  assert.throws(
    () => parseMcLaneInvoiceText({ text: fixture, filename: "292855_0007462_87654321.PDF", bytes: Buffer.from("x") }),
    /Filename invoice number does not match/,
  );
  assert.throws(() => parse(fixture.replace("Account Totals                                           53.00", "Account Totals                                           54.00")), /does not match invoice subtotal/);
});

test("rejects invalid ordinary and catch-weight line arithmetic", () => {
  assert.throws(() => parse(fixture.replace("10.00      20.00", "10.00      21.00")), /Line arithmetic failed/);
  assert.throws(() => parse(fixture.replace("                 10.00", "                 11.00")), /Catch-weight arithmetic failed/);
});

test("duplicate replay is deterministically rejected before writes", () => {
  const item = parse();
  const result = deduplicateParsedInvoices([item, item]);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].error, /Duplicate replay/);
});

test("delivery windows combine same-date invoices and end before the next delivery", () => {
  const invoices = [
    parsedInvoice({ number: "1", date: "2026-09-01", foodTotal: 40 }),
    parsedInvoice({ number: "2", date: "2026-09-01", foodTotal: 10 }),
    parsedInvoice({ number: "3", date: "2026-09-04", foodTotal: 25 }),
  ].map((value) => value.invoice);
  const salesDays = [
    { business_date: "2026-09-01", net_sales: 100, guest_count: 10, closed_orders: 8 },
    { business_date: "2026-09-02", net_sales: 200, guest_count: 20, closed_orders: 16 },
    { business_date: "2026-09-03", net_sales: 200, guest_count: 20, closed_orders: 16 },
    { business_date: "2026-09-04", net_sales: 100, guest_count: 10, closed_orders: 8 },
  ];
  const windows = buildWindows(invoices, salesDays);
  assert.equal(windows.length, 2);
  assert.deepEqual(
    { start: windows[0].start_date, end: windows[0].end_date, invoiceCount: windows[0].invoice_count },
    { start: "2026-09-01", end: "2026-09-03", invoiceCount: 2 },
  );
  assert.equal(windows[0].food_per_guest_proxy, 1);
  assert.equal(windows[0].food_percent_proxy, 10);
  assert.equal(windows[0].is_complete, true);
  assert.equal(windows[1].end_date, null);
  assert.equal(windows[1].is_complete, false);
  assert.match(windows[1].warning, /Open window/);
});

test("partial or missing sales and guest days never masquerade as complete", () => {
  const invoices = [
    { delivery_date: "2026-09-01", food_total: 100 },
    { delivery_date: "2026-09-04", food_total: 100 },
  ];
  const [window] = buildWindows(invoices, [
    { business_date: "2026-09-01", net_sales: 500, guest_count: null },
    { business_date: "2026-09-03", net_sales: 500, guest_count: null },
  ]);
  assert.equal(window.covered_sales_days, 2);
  assert.equal(window.expected_sales_days, 3);
  assert.equal(window.is_complete, false);
  assert.equal(window.food_per_guest_proxy, null);
  assert.match(window.warning, /Partial or invalid/);
});

test("top SKUs use FOOD spend and price changes use latest versus prior different purchase price", () => {
  const data = [
    parsedInvoice({ number: "1", date: "2026-09-01", foodTotal: 30, lines: [
      foodLine("B", "Beta", 10, 30),
      foodLine("A", "Alpha", 5, 20),
      { ...foodLine("P", "Paper", 100, 999), is_food: false },
    ] }),
    parsedInvoice({ number: "2", date: "2026-09-04", foodTotal: 40, lines: [
      foodLine("A", "Alpha", 6, 40),
      foodLine("B", "Beta", 10, 5),
    ] }),
  ];
  const report = buildCogsReport(data);
  assert.deepEqual(report.top_skus.map((row) => row.sku), ["A", "B"]);
  assert.deepEqual(report.price_changes.map((row) => row.sku), ["A"]);
  assert.equal(report.price_changes[0].old_price, 5);
  assert.equal(report.price_changes[0].new_price, 6);
  assert.equal(report.price_changes[0].percent_change, 20);
});
