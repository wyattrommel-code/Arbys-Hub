import { createHash, timingSafeEqual } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

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
  const value = str(v).replace(/Z0$/, "Z");
  if (!value) return null;
  if (!Number.isFinite(Date.parse(value))) throw new BrinkError("PAR returned an invalid order timestamp.");
  return new Date(value).toISOString();
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
      id, number: str(o.Number), business_date: businessDate,
      opened_at: timestamp(o.OpenedTime), closed_at: timestamp(o.ClosedTime),
      closed: yes(o.IsClosed), refund: yes(o.IsRefund), employee_id: str(o.EmployeeId), terminal_id: str(o.TerminalId),
      subtotal: money(o.Subtotal), tax: money(o.Tax), total: money(o.Total), net_sales: money(o.NetSales),
      items: list(o.Entries?.OrderEntry).map((entry) => ({
        id: str(entry.Id), item_id: str(entry.ItemId), description: str(entry.Description).slice(0, 300),
        price: money(entry.Price), net_sales: money(entry.NetSales),
        voided: yes(entry.IsVoided), deleted: yes(entry.IsDeleted), cleared: yes(entry.IsCleared),
      })),
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

export async function fetchOrders(config, date, fetcher = fetch) {
  if (!config.configured) throw new BrinkError("PAR keys have not been configured on the server.", 503);
  if (!validBusinessDate(date)) throw new BrinkError("Choose a valid business date.", 400);
  const body = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://www.brinksoftware.com/webservices/sales/v2"><s:Header/><s:Body><v2:GetOrders><v2:request><v2:BusinessDate>${date}</v2:BusinessDate><v2:ExcludeOpenOrders>false</v2:ExcludeOpenOrders></v2:request></v2:GetOrders></s:Body></s:Envelope>`;
  try {
    const response = await fetcher(`https://${config.host}/Sales2.svc`, { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { "Content-Type": "text/xml; charset=utf-8", AccessToken: config.accessToken, LocationToken: config.locationToken,
        SOAPAction: '"http://www.brinksoftware.com/webservices/sales/v2/ISalesWebService2/GetOrders"' }, body });
    if (!response.ok) throw new BrinkError(`PAR request failed (HTTP ${response.status}). Check the connection settings.`);
    // Bound memory usage; never persist raw customer/payment data or SOAP bodies.
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new BrinkError("PAR response exceeds the supported daily size."); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return parseOrders(Buffer.concat(chunks).toString("utf8"), date);
  } catch (err) {
    if (err instanceof BrinkError) throw err;
    throw new BrinkError("Could not reach PAR. Check the sandbox register, server address, and tokens; previous data was preserved.");
  }
}
