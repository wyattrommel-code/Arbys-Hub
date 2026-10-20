import { createHash } from "node:crypto";
import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
import { BrinkError, brinkConfig, validBusinessDate } from "./brink";
import { redactParMessage } from "./brink-evidence";

const contracts = {
  GetOrderBumpTimes: { service: "Kitchen", ns: "kitchen/v1", contract: "IKitchenWebService", collection: "OrderBumpTimes", row: "OrderBumpTime" },
  GetOrderItemBumpTimes: { service: "Kitchen", ns: "kitchen/v1", contract: "IKitchenWebService", collection: "OrderItemBumpTimes", row: "OrderItemBumpTime" },
  GetKitchenQueues: { service: "Settings2", ns: "settings/v2", contract: "ISettingsWebService2", collection: "Collection", row: "KitchenQueue" },
};
const scalar = v => typeof v === "string" ? v : "";
function contractFor(operation) {
  if (!Object.hasOwn(contracts, operation)) throw new BrinkError("Unsupported kitchen operation.", 400);
  return contracts[operation];
}
export function kitchenRequest(operation, date) {
  const c = contractFor(operation);
  if (!validBusinessDate(date)) throw new BrinkError("Choose a valid business date.", 400);
  const ns = `http://www.brinksoftware.com/webservices/${c.ns}`;
  const content = c.service === "Kitchen" ? `<request><BusinessDate>${date}T00:00:00Z</BusinessDate></request>` : "";
  return { service: c.service, action: `${ns}/${c.contract}/${operation}`,
    body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body xmlns="${ns}"><${operation}>${content}</${operation}></s:Body></s:Envelope>` };
}
function id(value, field) {
  const v = scalar(value);
  // Preserve Int64 order IDs as strings, without JavaScript rounding.
  if (!/^\d{1,20}$/.test(v)) throw new BrinkError(`PAR kitchen response has an invalid ${field}.`);
  return v;
}
function timestamp(value) {
  if (value == null || value === "" || value?.["@_nil"] === "true") return null;
  const text = scalar(typeof value === "object" ? value.DateTime : value);
  // WCF DateTime is UTC. OffsetMinutes is display metadata, not a second offset.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new BrinkError("PAR kitchen response has an invalid or ambiguous timestamp.");
  }
  return new Date(text).toISOString();
}
export function parseKitchenResponse(xml, operation, secrets = []) {
  const c = contractFor(operation);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new BrinkError("PAR returned invalid kitchen XML.");
  const body = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, parseTagValue: false, trimValues: true }).parse(xml).Envelope?.Body;
  const result = body?.[`${operation}Response`]?.[`${operation}Result`];
  const rawCode = scalar(result?.ResultCode);
  const code = /^-?\d{1,6}$/.test(rawCode) ? rawCode : '';
  if (body?.Fault || code !== "0") {
    const message = redactParMessage(scalar(body?.Fault?.faultstring || result?.Message), secrets);
    const error = new BrinkError(`PAR kitchen request failed${code ? ` (result ${code})` : ""}.${message ? ` ${message}` : ""}`);
    error.parResultCode = code || null;
    throw error;
  }
  if (!Object.hasOwn(result, c.collection)) throw new BrinkError("PAR kitchen response is missing its collection.");
  const collection = result[c.collection];
  if (collection !== "" && (!collection || typeof collection !== "object" || Array.isArray(collection) || collection["@_nil"] === "true" ||
    Object.keys(collection).some(k => !k.startsWith("@_") && k !== c.row))) throw new BrinkError("PAR kitchen response has an invalid collection.");
  const value = collection?.[c.row];
  const source = value == null ? [] : Array.isArray(value) ? value : [value];
  const seen = new Set(); let duplicates = 0;
  const records = [];
  for (const row of source) {
    if (!row || typeof row !== "object" || Array.isArray(row) || row["@_nil"] === "true") throw new BrinkError("PAR kitchen response has an invalid record.");
    let record;
    if (operation === "GetKitchenQueues") {
      let name = scalar(row.Name);
      for (const secret of secrets.filter(Boolean)) name = name.split(secret).join("[REDACTED]");
      record = { id: id(row.Id, "queue ID"), name: name.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200) };
    } else {
      record = { order_id: id(row.OrderId, "order ID"), queue_id: id(row.KitchenQueueId, "queue ID"),
        send_number: id(row.SendNumber, "send number"), sent_at: timestamp(row.SendTime), bumped_at: timestamp(row.BumpTime),
        ...(operation === "GetOrderBumpTimes" ? { first_sent_at: timestamp(row.FirstSendTime) }
          : { item_id: id(row.OrderItemId, "item ID"), fired_at: timestamp(row.FireTime) }) };
    }
    const key = JSON.stringify(record);
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key); records.push(record);
  }
  return { records, source_count: source.length, duplicate_count: duplicates };
}

export async function fetchKitchen({ config, date, operation, evidence = {}, fetcher = fetch, timeout = 15000 }) {
  const checked = brinkConfig({ BRINK_ENVIRONMENT: config.mode, BRINK_API_HOST: config.host,
    BRINK_ACCESS_TOKEN: config.accessToken, BRINK_LOCATION_TOKEN: config.locationToken });
  if (!checked.configured) throw new BrinkError("PAR credentials are unavailable.", 503);
  const request = kitchenRequest(operation, date);
  const response = await fetcher(`https://${checked.host}/${request.service}.svc`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeout),
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${request.action}"`, AccessToken: checked.accessToken, LocationToken: checked.locationToken }, body: request.body,
  });
  evidence.http_status = response.status;
  const chunks = []; let size = 0;
  const reader = response.body?.getReader();
  try {
    while (reader) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new BrinkError("PAR kitchen response exceeds its size limit."); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader?.releaseLock(); }
  const raw = Buffer.concat(chunks);
  evidence.response_bytes = raw.length;
  evidence.response_sha256 = createHash("sha256").update(raw).digest("hex");
  // Errors retain a redacted message; full raw payloads are never archived.
  let parsed;
  try { parsed = parseKitchenResponse(raw.toString("utf8"), operation, [config.accessToken, config.locationToken]); }
  catch (err) {
    evidence.result_code = err.parResultCode || null;
    evidence.response_xml = new XMLBuilder().build({ Envelope: { Body: { Error: {
      ResultCode: evidence.result_code, Message: err instanceof BrinkError ? err.message : 'Invalid kitchen response',
    } } } });
    throw err;
  }
  evidence.result_code = "0";
  if (!response.ok) throw new BrinkError(`PAR kitchen request failed (HTTP ${response.status}).`);
  evidence.order_count = parsed.records.length;
  evidence.response_xml = new XMLBuilder().build({ Envelope: { Body: { [`${operation}Response`]: { [`${operation}Result`]: {
    ResultCode: "0", SavedRecords: parsed.records.length, ExactDuplicates: parsed.duplicate_count,
    EvidenceOmitted: "Timing fields are saved in the kitchen snapshot. This is a sanitized summary, not raw XML.",
  } } } } });
  return parsed;
}
