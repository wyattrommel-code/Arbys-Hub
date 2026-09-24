import { createHash } from "node:crypto";
import { basename } from "node:path";

export const COGS_PARSER_VERSION = "mclane-pdf-v3";
export const MCLANE_CUSTOMER = "292855";
export const MCLANE_UNIT = "0007462";

const CATEGORIES = [
  "DISTRIBUTION FEE",
  "OBSOLESCENCE FEES",
  "MISC. EXPENSES",
  "SUPPLIES",
  "PAPER",
  "FOOD",
];
const CATEGORY_PATTERN = CATEGORIES.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const PRODUCT_CATEGORIES = new Set(["FOOD", "PAPER", "SUPPLIES"]);
const UNIT_PATTERN = /^(?:CA|EA|BX|RL|BG|PK|CS|LB|BC|DZ|KT|TB)$/;

function money(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const negative = raw.endsWith("-") || (raw.startsWith("(") && raw.endsWith(")"));
  const parsed = Number(raw.replace(/[$,()\-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function isoDate(mmddyy) {
  const match = String(mmddyy ?? "").match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!match) throw new Error(`Invalid date: ${mmddyy}`);
  const year = Number(match[3]) >= 70 ? `19${match[3]}` : `20${match[3]}`;
  const result = `${year}-${match[1]}-${match[2]}`;
  if (new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) {
    throw new Error(`Invalid date: ${mmddyy}`);
  }
  return result;
}

function one(text, regex, label) {
  const values = [...text.matchAll(regex)].map((match) => match[1]);
  const unique = [...new Set(values)];
  if (unique.length !== 1) {
    throw new Error(`Expected one unambiguous ${label}; found ${unique.join(", ") || "none"}`);
  }
  return unique[0];
}

function categoryIn(line) {
  return line.toUpperCase().match(new RegExp(`(${CATEGORY_PATTERN})\\s*$`))?.[1] ?? null;
}

function amountTokens(line) {
  return [...line.matchAll(/(?:\d{1,3}(?:,\d{3})*|\d*)\.\d{2,4}-?/g)]
    .map((match) => ({ raw: match[0], index: match.index, decimals: match[0].replace(/-$/, "").split(".")[1].length }));
}

function approximately(left, right, tolerance = 0.02) {
  return Math.abs(round(left) - round(right)) <= tolerance;
}

/** Parse text produced by `pdftotext -layout`; no OCR or fuzzy SKU matching. */
export function parseMcLaneInvoiceText({ text, filename, bytes }) {
  if (!Buffer.isBuffer(bytes)) throw new Error("Original PDF bytes are required for source hashing");
  const authoritative = basename(filename).match(/(?:^|__)(292855_0007462_\d+\.PDF)$/i)?.[1];
  if (!authoritative) throw new Error("Filename must end with 292855_0007462_<invoice>.PDF");

  const customer = one(text, /\bCUSTOMER\s+(\d{6})\b/g, "customer");
  const unit = one(text, /^\s*H\s+ARBYS\s+#(\d{7})\b/gm, "unit");
  const invoiceNumber = one(text, /\bINVOICE NUMBER\s+(\d{8})\b/g, "invoice number");
  const invoiceDate = isoDate(one(text, /\bINVOICE DATE\s+(\d{2}\/\d{2}\/\d{2})\b/g, "invoice date"));
  const deliveryDate = isoDate(one(text, /\bDELIVERY DATE\s+(\d{2}\/\d{2}\/\d{2})\b/g, "delivery date"));
  if (customer !== MCLANE_CUSTOMER) throw new Error(`Wrong customer ${customer}; expected ${MCLANE_CUSTOMER}`);
  if (unit !== MCLANE_UNIT) throw new Error(`Wrong unit ${unit}; expected ${MCLANE_UNIT}`);
  if (!authoritative.toUpperCase().endsWith(`_${invoiceNumber}.PDF`)) {
    throw new Error("Filename invoice number does not match document");
  }

  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const rawLines = text.split(/\r?\n/);
  const summaryStart = rawLines.findIndex((line) => line.includes("Customer Account Summary"));
  if (summaryStart < 0) throw new Error("Customer account summary not found");
  const detailLines = rawLines.slice(0, summaryStart);
  const candidates = [];

  for (let index = 0; index < detailLines.length; index += 1) {
    const match = detailLines[index].match(/^\s*(.*?)(?:\b(\d{6})\s*|\b(XDELMIDS))\s*(.*)$/);
    if (!match) continue;
    const prefixTokens = match[1].trim().split(/\s+/);
    const umIndex = prefixTokens.findIndex((token) => UNIT_PATTERN.test(token));
    if (umIndex < 1) continue;
    const numeric = prefixTokens.slice(0, umIndex)
      .filter((token) => /^-?\d+(?:\.\d+)?$/.test(token))
      .map(Number);
    if (!numeric.length) continue;
    candidates.push({
      index,
      sku: match[2] || match[3],
      ordered_quantity: numeric.length > 1 ? numeric.at(-2) : null,
      shipped_quantity: numeric.at(-1),
      uom: prefixTokens[umIndex],
      remainder: match[4],
    });
  }

  const parsedLines = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    const stop = candidates[candidateIndex + 1]?.index ?? detailLines.length;
    const block = detailLines.slice(candidate.index, stop);
    const accountLineIndex = block.findIndex((line) => categoryIn(line));
    if (accountLineIndex < 0) throw new Error(`Missing account/category for SKU ${candidate.sku}`);
    const category = categoryIn(block[accountLineIndex]);
    const accountMatch = block[accountLineIndex].match(new RegExp(`\\b(\\d{5})\\s+(${CATEGORY_PATTERN})\\s*$`, "i"));
    if (!accountMatch) throw new Error(`Missing account code for SKU ${candidate.sku}`);

    const priceText = block.slice(0, accountLineIndex + 1).join(" ");
    const amounts = amountTokens(priceText);
    if (!amounts.length) throw new Error(`Missing extended amount for SKU ${candidate.sku}`);
    const extendedToken = amounts.at(-1);
    const unitToken = amounts.length > 1 ? amounts.at(-2) : null;
    const extendedAmount = money(extendedToken.raw);
    const unitPrice = unitToken ? money(unitToken.raw) : null;

    const descriptionSource = candidate.remainder.trim()
      ? candidate.remainder
      : (block.slice(1, accountLineIndex).find((line) => /\S/.test(line)) ?? "").trim();
    const firstAmount = amountTokens(descriptionSource)[0];
    let description = descriptionSource.slice(0, firstAmount?.index ?? descriptionSource.length).trim();
    description = description.split(/\s{2,}/)[0].trim();
    if (!description) throw new Error(`Missing description for SKU ${candidate.sku}`);

    let catchWeight = null;
    const isCatchWeight = Boolean(unitToken && unitToken.decimals === 4 && PRODUCT_CATEGORIES.has(category));
    if (isCatchWeight) {
      const weightValues = block.slice(accountLineIndex + 1)
        .flatMap((line) => /^\s*\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?)*\s*$/.test(line)
          ? line.trim().split(/\s+/).map(Number)
          : []);
      if (!weightValues.length) throw new Error(`Missing catch weight for SKU ${candidate.sku}`);
      catchWeight = round(weightValues.reduce((sum, value) => sum + value, 0), 4);
      if (!approximately(catchWeight * unitPrice, extendedAmount)) {
        throw new Error(`Catch-weight arithmetic failed for SKU ${candidate.sku}`);
      }
    } else if (PRODUCT_CATEGORIES.has(category) && unitPrice !== null
      && !approximately(candidate.shipped_quantity * unitPrice, extendedAmount)) {
      throw new Error(`Line arithmetic failed for SKU ${candidate.sku}`);
    }

    parsedLines.push({
      line_number: parsedLines.length + 1,
      sku: candidate.sku,
      description,
      ordered_quantity: candidate.ordered_quantity,
      shipped_quantity: candidate.shipped_quantity,
      uom: candidate.uom,
      unit_price: unitPrice,
      extended_amount: extendedAmount,
      account_code: accountMatch[1],
      category,
      is_food: category === "FOOD",
      catch_weight: catchWeight,
      // McLane's four-decimal catch-weight price is dollars per pound, not per case.
      price_basis: isCatchWeight ? "catch_weight" : "shipped_unit",
      price_uom: isCatchWeight ? "LB" : candidate.uom,
      raw_line_number: candidate.index + 1,
    });
  }
  if (!parsedLines.length) throw new Error("No invoice detail rows were parsed");

  const summaryLines = rawLines.slice(summaryStart);
  const accountTotalsLine = summaryLines.find((line) => /Account Totals/.test(line));
  if (!accountTotalsLine) throw new Error("Account totals not found");
  const totalAmounts = amountTokens(accountTotalsLine).map((token) => money(token.raw));
  if (totalAmounts.length < 2) throw new Error("Malformed account totals");
  const [subtotal, tax, total] = totalAmounts.length >= 3
    ? totalAmounts.slice(-3)
    : [totalAmounts.at(-2), 0, totalAmounts.at(-1)];

  const lineTotal = round(parsedLines.reduce((sum, line) => sum + line.extended_amount, 0));
  if (!approximately(lineTotal, subtotal)) {
    throw new Error(`Line total ${lineTotal.toFixed(2)} does not match invoice subtotal ${subtotal.toFixed(2)}`);
  }
  if (!approximately(subtotal + tax, total)) {
    throw new Error("Invoice subtotal plus tax does not match total");
  }
  const foodTotal = round(parsedLines.filter((line) => line.is_food)
    .reduce((sum, line) => sum + line.extended_amount, 0));
  const foodSummaryLine = summaryLines.find((line) => /\b71011\s+FOOD\b/.test(line));
  const foodSummary = foodSummaryLine ? money(amountTokens(foodSummaryLine)[0]?.raw) : null;
  if (foodSummary === null || !approximately(foodSummary, foodTotal)) {
    throw new Error("Parsed FOOD lines do not match the customer account summary");
  }
  const nonFoodTotal = round(lineTotal - foodTotal);

  return {
    invoice: {
      customer_number: customer,
      unit_number: unit,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      delivery_date: deliveryDate,
      source_filename: authoritative,
      source_sha256: sourceSha256,
      parser_version: COGS_PARSER_VERSION,
      subtotal,
      tax,
      total,
      food_total: foodTotal,
      non_food_total: nonFoodTotal,
      line_count: parsedLines.length,
    },
    lines: parsedLines,
  };
}

/** Reject duplicate source hashes or invoice numbers within one batch before any write. */
export function deduplicateParsedInvoices(parsedInvoices) {
  const accepted = [];
  const rejected = [];
  const hashes = new Set();
  const invoiceNumbers = new Set();
  for (const parsed of parsedInvoices) {
    const { source_sha256: hash, invoice_number: invoiceNumber, source_filename: file } = parsed.invoice;
    if (hashes.has(hash) || invoiceNumbers.has(invoiceNumber)) {
      rejected.push({ file, error: `Duplicate replay in input batch: invoice ${invoiceNumber}` });
      continue;
    }
    hashes.add(hash);
    invoiceNumbers.add(invoiceNumber);
    accepted.push(parsed);
  }
  return { accepted, rejected };
}

/** Deterministic FOOD-only spend and purchase-price report. */
export function buildCogsReport(parsedInvoices, topLimit = 10) {
  const observations = [];
  const skuSpend = new Map();
  for (const parsed of parsedInvoices) {
    for (const line of parsed.lines.filter((value) => value.is_food)) {
      const key = line.sku;
      const current = skuSpend.get(key) ?? { sku: key, description: line.description, spend: 0, quantity: 0 };
      current.spend += line.extended_amount;
      current.quantity += line.shipped_quantity;
      if (`${parsed.invoice.delivery_date}:${parsed.invoice.invoice_number}` >= (current.latest_key ?? "")) {
        current.description = line.description;
        current.latest_key = `${parsed.invoice.delivery_date}:${parsed.invoice.invoice_number}`;
      }
      skuSpend.set(key, current);
      if (line.unit_price !== null) observations.push({
        sku: key,
        description: line.description,
        price: line.unit_price,
        price_basis: line.price_basis,
        price_uom: line.price_uom,
        delivery_date: parsed.invoice.delivery_date,
        invoice_number: parsed.invoice.invoice_number,
        line_number: line.line_number,
      });
    }
  }
  const top_skus = [...skuSpend.values()]
    .map(({ latest_key: _latest, ...row }) => ({ ...row, spend: round(row.spend), quantity: round(row.quantity, 4) }))
    .sort((a, b) => b.spend - a.spend || a.sku.localeCompare(b.sku))
    .slice(0, topLimit);

  observations.sort((a, b) => a.delivery_date.localeCompare(b.delivery_date)
    || a.invoice_number.localeCompare(b.invoice_number) || a.line_number - b.line_number);
  const bySku = new Map();
  for (const row of observations) {
    const key = `${row.sku}|${row.price_basis}|${row.price_uom}`;
    bySku.set(key, [...(bySku.get(key) ?? []), row]);
  }
  const price_changes = [];
  for (const [, rows] of bySku) {
    const latest = rows.at(-1);
    const prior = rows.slice(0, -1).findLast((row) => row.price !== latest.price);
    if (!prior) continue;
    price_changes.push({
      sku: latest.sku,
      description: latest.description,
      old_price: prior.price,
      new_price: latest.price,
      percent_change: prior.price === 0 ? null : round((latest.price - prior.price) / Math.abs(prior.price) * 100, 4),
      price_basis: latest.price_basis,
      old_delivery_date: prior.delivery_date,
      new_delivery_date: latest.delivery_date,
    });
  }
  price_changes.sort((a, b) => b.new_delivery_date.localeCompare(a.new_delivery_date)
    || a.sku.localeCompare(b.sku));
  return { top_skus, price_changes };
}

export function buildWindows(invoices, salesDays = []) {
  const byDate = new Map();
  for (const invoice of invoices) {
    const group = byDate.get(invoice.delivery_date) ?? [];
    group.push(invoice);
    byDate.set(invoice.delivery_date, group);
  }
  const dates = [...byDate.keys()].sort();
  return dates.map((startDate, index) => {
    const next = dates[index + 1] ?? null;
    const endDate = next ? new Date(`${next}T00:00:00Z`) : null;
    if (endDate) endDate.setUTCDate(endDate.getUTCDate() - 1);
    const end = endDate?.toISOString().slice(0, 10) ?? null;
    const covered = salesDays
      .filter((day) => day.business_date >= startDate && (!end || day.business_date <= end))
      .sort((a, b) => a.business_date.localeCompare(b.business_date));
    const expectedDays = end
      ? Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1
      : null;
    const hasNumeric = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
    const salesValuesValid = covered.length > 0 && covered.every((day) => hasNumeric(day.net_sales));
    const guestValuesValid = covered.length > 0 && covered.every((day) => hasNumeric(day.guest_count));
    const netSales = salesValuesValid ? round(covered.reduce((sum, day) => sum + Number(day.net_sales), 0)) : null;
    const guestCount = guestValuesValid ? covered.reduce((sum, day) => sum + Number(day.guest_count), 0) : null;
    const closedOrdersValid = covered.length > 0 && covered.every((day) => hasNumeric(day.closed_orders));
    const closedOrders = closedOrdersValid ? covered.reduce((sum, day) => sum + Number(day.closed_orders), 0) : null;
    const foodTotal = round(byDate.get(startDate).reduce((sum, invoice) => sum + Number(invoice.food_total), 0));
    const fullDayCoverage = Boolean(end && expectedDays === covered.length);
    return {
      start_date: startDate,
      end_date: end,
      invoice_count: byDate.get(startDate).length,
      food_total: foodTotal,
      expected_sales_days: expectedDays,
      covered_sales_days: covered.length,
      coverage_start: covered[0]?.business_date ?? null,
      coverage_end: covered.at(-1)?.business_date ?? null,
      net_sales: netSales,
      closed_orders: closedOrders,
      guest_count: guestCount,
      food_percent_proxy: netSales > 0 ? round(foodTotal / netSales * 100, 4) : null,
      food_per_guest_proxy: guestCount > 0 ? round(foodTotal / guestCount, 4) : null,
      food_per_closed_order_proxy: closedOrders > 0 ? round(foodTotal / closedOrders, 4) : null,
      is_complete: fullDayCoverage && salesValuesValid,
      warning: !end
        ? "Open window: no subsequent delivery yet."
        : !fullDayCoverage || !salesValuesValid
          ? "Partial or invalid sales coverage. Proxy metrics use only the explicitly covered source days."
          : !guestValuesValid
            ? "Closed window with complete sales coverage; authoritative guest count is unavailable."
            : "Closed window with complete sales and guest coverage.",
    };
  });
}
