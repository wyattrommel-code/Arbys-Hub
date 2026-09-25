import { createHash, timingSafeEqual } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ordersRequest, responseEvidence, parDiagnostic } from "./brink-evidence";

export class BrinkError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function brinkConfig(env = process.env) {
  const mode = env.BRINK_ENVIRONMENT || "sandbox";
  const host = (env.BRINK_API_HOST || "api-apiint.brinkpos.net").trim().toLowerCase();
  const sandbox = /^api-apiint\.(brinkpos\.net|parpos\.com)$/.test(host);
  if (!["sandbox", "production"].includes(mode) || !/^api(?:-[a-z0-9]+)?\.(brinkpos\.net|parpos\.com)$/.test(host) || (mode === "sandbox") !== sandbox) {
    throw new BrinkError("PAR host and environment do not match. Check the server configuration.", 503);
  }
  const accessToken = env.BRINK_ACCESS_TOKEN?.trim();
  const locationToken = env.BRINK_LOCATION_TOKEN?.trim();
  const configured = Boolean(accessToken && locationToken);
  const connection = createHash("sha256").update(`${mode}:${host}:${locationToken || "unconfigured"}`).digest("hex");
  return { mode, host, accessToken, locationToken, configured, connection,
    label: env.BRINK_LOCATION_LABEL || (sandbox ? "API Lab-01" : "PAR store"),
    publish: mode === "production" && env.BRINK_PUBLISH_HOURLY_SALES === "true",
    scheduled: env.BRINK_SYNC_ENABLED === "true" };
}

export function validBusinessDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validCronSecret(header, secret) {
  if (!secret || secret.length < 32 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(header);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

const list = (v) => v == null || v === "" ? [] : Array.isArray(v) ? v : [v];
const str = (v) => typeof v === "string" || typeof v === "number" ? String(v) : "";
const yes = (v) => v === "true";
const money = (v) => {
  if (!/^-?\d+(?:\.\d+)?$/.test(str(v))) throw new BrinkError("PAR returned an invalid sales amount; previous data was preserved.");
  const cents = Math.round(Number(v) * 100);
  if (!Number.isSafeInteger(cents)) throw new BrinkError("PAR returned an out-of-range sales amount.");
  return cents / 100;
};
function timestamp(v) {
  // WCF DateTimeOffset wraps the UTC instant in DateTime; OffsetMinutes is
  // presentation metadata, not an offset to apply a second time.
  const value = str(v && typeof v === "object" ? v.DateTime : v).replace(/Z0$/, "Z");
  if (!value) return null;
  if (!Number.isFinite(Date.parse(value))) throw new BrinkError("PAR returned an invalid order timestamp.");
  return new Date(value).toISOString();
}

const optionalMoney = (v) => str(v) === "" ? null : money(v);
const optionalId = (v) => str(v) || null;
// Missing collections mean unavailable, while a present empty collection means
// PAR explicitly reported none. Older saved snapshots lack these fields.
function collection(parent, key, element, parse) {
  if (!Object.hasOwn(parent, key)) return null;
  const value = parent[key];
  if (value === "") return [];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => k !== element)) {
    throw new BrinkError("PAR returned an unexpected detail collection; previous data was preserved.");
  }
  return list(value[element]).map(parse);
}
function offer(o, kind) {
  return { id: str(o.Id), name: str(o.Name).slice(0, 300), amount: money(o.Amount),
    definition_id: optionalId(o[kind === "discount" ? "DiscountId" : "PromotionId"]),
    employee_id: optionalId(o.EmployeeId), approver_employee_id: optionalId(o.ApproverEmployeeId) };
}
function allocation(o, kind) {
  return { id: str(o.Id), amount: money(o.Amount),
    order_adjustment_id: optionalId(o[kind === "discount" ? "OrderDiscountId" : "OrderPromotionId"]) };
}
function modifier(o, depth = 0) {
  if (depth > 16) throw new BrinkError("PAR returned overly nested item modifiers.");
  return { id: str(o.Id), item_id: str(o.ItemId), modifier_code_id: optionalId(o.ModifierCodeId),
    modifier_group_id: optionalId(o.ModifierGroupId), price: optionalMoney(o.Price),
    net_sales: optionalMoney(o.NetSales), item_net_sales: optionalMoney(o.ItemNetSales),
    modifiers: collection(o, "Modifiers", "OrderItemModifier", child => modifier(child, depth + 1)) };
}
function orderItem(entry) {
  const denominator = str(entry.Denominator);
  if (denominator && (!/^\d+$/.test(denominator) || Number(denominator) < 1 || Number(denominator) > 255)) {
    throw new BrinkError("PAR returned an invalid split-item denominator.");
  }
  return {
    id: str(entry.Id), item_id: str(entry.ItemId), description: str(entry.Description).slice(0, 300),
    price: money(entry.Price), net_sales: money(entry.NetSales),
    item_net_sales: optionalMoney(entry.ItemNetSales), gross_sales: optionalMoney(entry.GrossSales),
    item_gross_sales: optionalMoney(entry.ItemGrossSales),
    composite_order_item_id: optionalId(entry.CompositeOrderItemId), split_item_id: optionalId(entry.SplitItemId),
    split_denominator: denominator ? Number(denominator) : null,
    voided: yes(entry.IsVoided), deleted: yes(entry.IsDeleted), cleared: yes(entry.IsCleared),
    non_revenue: Object.hasOwn(entry, "NonRevenueItem") ? yes(entry.NonRevenueItem) : null,
    discounts: collection(entry, "Discounts", "OrderItemDiscount", o => allocation(o, "discount")),
    promotions: collection(entry, "Promotions", "OrderEntryPromotion", o => allocation(o, "promotion")),
    modifiers: collection(entry, "Modifiers", "OrderItemModifier", o => modifier(o)),
  };
}

export function parseOrders(xml, businessDate) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new BrinkError("PAR returned invalid XML; previous data was preserved.");
  const parsed = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false, trimValues: true }).parse(xml);
  const result = parsed.Envelope?.Body?.GetOrdersResponse?.GetOrdersResult;
  if (!result || str(result.ResultCode) !== "0") {
    throw new BrinkError(str(result?.ResultCode) === "4" ? "PAR denied access. Check both tokens and location permissions." : "PAR could not return orders. Previous data was preserved.");
  }
  if (!("Orders" in result)) throw new BrinkError("PAR response is missing its orders collection.");
  if (result.Orders !== "" && (typeof result.Orders !== "object" || Object.keys(result.Orders).some((key) => key !== "Order"))) throw new BrinkError("PAR returned an unexpected orders collection.");
  const seen = new Set();
  return list(result.Orders?.Order).map((o) => {
    const id = str(o.Id);
    if (!/^\d+$/.test(id) || seen.has(id) || str(o.BusinessDate).slice(0, 10) !== businessDate) throw new BrinkError("PAR returned duplicate orders or an unexpected business date.");
    seen.add(id);
    if (!["true", "false"].includes(o.IsClosed)) throw new BrinkError("PAR returned an invalid order status.");
    return {
      id, number: str(o.Number), business_date: businessDate, details_version: 2,
      opened_at: timestamp(o.OpenedTime), closed_at: timestamp(o.ClosedTime),
      first_sent_at: timestamp(o.FirstSendTime), modified_at: timestamp(o.ModifiedTime),
      closed: yes(o.IsClosed), refund: yes(o.IsRefund), employee_id: str(o.EmployeeId), terminal_id: str(o.TerminalId),
      destination_id: optionalId(o.DestinationId), refund_reason_id: optionalId(o.RefundReasonId),
      subtotal: money(o.Subtotal), tax: money(o.Tax), total: money(o.Total), net_sales: money(o.NetSales),
      gross_sales: optionalMoney(o.GrossSales),
      discounts: collection(o, "Discounts", "OrderDiscount", d => offer(d, "discount")),
      promotions: collection(o, "Promotions", "OrderPromotion", p => offer(p, "promotion")),
      items: list(o.Entries?.OrderEntry).map(orderItem),
    };
  });
}

export function summarizeOrders(orders) {
  const completed = orders.filter((o) => o.closed && (o.items.length || o.total !== 0));
  const sum = (field) => completed.reduce((total, order) => total + Math.round(order[field] * 100), 0) / 100;
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour_of_day: hour, net_sales: 0 }));
  for (const order of completed) {
    if (!order.opened_at) throw new BrinkError("A completed order has no opening time.");
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "2-digit", hourCycle: "h23" }).format(new Date(order.opened_at)));
    hourly[hour].net_sales += Math.round(order.net_sales * 100);
  }
  hourly.forEach((row) => { row.net_sales /= 100; });
  return { closed_orders: completed.length, open_orders: orders.filter((o) => !o.closed && o.items.length).length,
    net_sales: sum("net_sales"), tax: sum("tax"), total: sum("total"), hourly };
}

export async function fetchOrders(config, date, fetcher = fetch, evidence = {}, timeoutMs = 45000) {
  if (!config.configured) throw new BrinkError("PAR keys have not been configured on the server.", 503);
  if (!validBusinessDate(date)) throw new BrinkError("Choose a valid business date.", 400);
  const body = ordersRequest(date);
  try {
    const response = await fetcher(`https://${config.host}/Sales2.svc`, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(45000, timeoutMs))),
      headers: { "Content-Type": "text/xml; charset=utf-8", AccessToken: config.accessToken, LocationToken: config.locationToken,
        SOAPAction: '"http://www.brinksoftware.com/webservices/sales/v2/ISalesWebService2/GetOrders"' }, body });
    evidence.http_status = response.status;
    // Bound memory usage; never persist raw customer/payment data or SOAP bodies.
    const reader = response.body?.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > (response.ok ? 20 * 1024 * 1024 : 256 * 1024)) { await reader.cancel(); throw new BrinkError(`PAR response exceeds the supported size (HTTP ${response.status}).`); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader?.releaseLock(); }
    const xml = Buffer.concat(chunks).toString("utf8");
    Object.assign(evidence, responseEvidence(xml, [config.accessToken, config.locationToken]));
    if (!response.ok) throw new BrinkError(`PAR request failed (HTTP ${response.status}). Previous data was preserved.`);
    return parseOrders(xml, date);
  } catch (err) {
    if (err instanceof BrinkError) {
      const message = parDiagnostic(evidence.response_xml);
      if (message) throw new BrinkError(`${err.message} PAR message (redacted): ${message}`, err.status);
      throw err;
    }
    throw new BrinkError("Could not reach PAR. Check the sandbox register, server address, and tokens; previous data was preserved.");
  }
}
