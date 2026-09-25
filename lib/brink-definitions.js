import { createHash, randomUUID } from "node:crypto";
import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
import { BrinkError } from "./brink";
import { redactParMessage } from "./brink-evidence";

const types = { GetDiscounts: "Discount", GetDestinations: "Destination" };
const builder = new XMLBuilder({ format: true });
const scalar = v => typeof v === "string" ? v : "";
function typeFor(operation) {
  if (!Object.hasOwn(types, operation)) throw new BrinkError("Unsupported PAR definition lookup.");
  return types[operation];
}
export function definitionsRequest(operation, accessToken = "[REDACTED]", locationToken = "[REDACTED]") {
  typeFor(operation);
  // Settings v1 uses body credentials, unlike Sales2/Settings2. The default
  // redacted request is the ONLY form allowed into the call log.
  const body = builder.build({ [operation]: { accessToken, locationToken } });
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body xmlns="http://tempuri.org/">${body}</s:Body></s:Envelope>`;
}
export function parseDefinitions(xml, operation, secrets = []) {
  const type = typeFor(operation);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new BrinkError("PAR returned invalid definition XML.");
  const parsed = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, parseTagValue: false, trimValues: true }).parse(xml);
  const body = parsed.Envelope?.Body;
  if (body?.Fault) {
    const message = redactParMessage(scalar(body.Fault.faultstring), secrets);
    throw new BrinkError(`PAR definition lookup failed.${message ? ` PAR message (redacted): ${message}` : ""}`);
  }
  const response = body?.[`${operation}Response`];
  if (!response || !Object.hasOwn(response, `${operation}Result`)) throw new BrinkError("PAR definition response is missing its result.");
  const result = response[`${operation}Result`];
  if (result !== "" && (!result || typeof result !== "object" || Array.isArray(result) || result["@_nil"] === "true" ||
      Object.keys(result).some(k => !k.startsWith("@_") && k !== type))) throw new BrinkError("PAR returned an unexpected definition collection.");
  const value = result?.[type];
  const rows = value == null ? [] : Array.isArray(value) ? value : [value];
  const seen = new Set();
  const entries = rows.map(row => {
    const id = scalar(row?.Id);
    if (!/^\d+$/.test(id) || seen.has(id)) throw new BrinkError("PAR returned invalid or duplicate definition IDs.");
    seen.add(id);
    let name = scalar(row.Name);
    for (const secret of secrets.filter(Boolean)) name = name.split(secret).join("[REDACTED]");
    return { id, name: name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300) };
  });
  // Keep only IDs and labels. No arbitrary settings, notes or customer fields.
  const responseXml = builder.build({ Envelope: { Body: { [`${operation}Response`]: {
    [`${operation}Result`]: { [type]: entries.map(e => ({ Id: e.id, Name: e.name })) },
  } } } });
  if (Buffer.byteLength(responseXml) > 65536) throw new BrinkError("PAR definition list exceeds its cache limit.");
  return { entries, responseXml };
}

export async function definitionDirectory({ operation, config, db, run, date, source, version, deadline, fetcher = fetch, now = Date.now, cacheOnly = false }) {
  typeFor(operation);
  const previous = await run(`read-${operation}`, () => db.from("brink_api_calls")
    .select("status,started_at,response_xml").eq("connection_id", config.connection).eq("operation", operation)
    .order("started_at", { ascending: false }).limit(30));
  const rows = previous.data || [];
  let cached = { entries: [], fetched_at: null };
  for (const row of rows) {
    if (row.status !== "success" || !row.response_xml) continue;
    try { cached = { entries: parseDefinitions(row.response_xml, operation).entries, fetched_at: row.started_at }; break; }
    catch { /* Invalid/expired evidence cannot supply labels. */ }
  }
  // Shared sales-sync claim serializes writers. Both successful and failed
  // attempts wait 12 hours; no settings-error storm every three minutes.
  if (cacheOnly || (rows[0] && now() - Date.parse(rows[0].started_at) < 12 * 3600000) || deadline - now() < 8000) return cached;
  const id = randomUUID(), started = now();
  await run(`${operation}-intent`, () => db.from("brink_api_calls").upsert({ id, connection_id: config.connection,
    environment: config.mode, business_date: date, operation, source, endpoint: `https://${config.host}/Settings.svc`,
    request_xml: definitionsRequest(operation), integration_version: version,
  }, { onConflict: "id", ignoreDuplicates: true }));
  const evidence = {};
  try {
    const response = await fetcher(`https://${config.host}/Settings.svc`, { method: "POST", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(5000), headers: { "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"http://tempuri.org/ISettingsWebService/${operation}"` },
      body: definitionsRequest(operation, config.accessToken, config.locationToken) });
    evidence.http_status = response.status;
    const reader = response.body?.getReader();
    const chunks = []; let size = 0;
    try {
      while (reader) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new BrinkError("PAR definitions exceeded their response limit."); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader?.releaseLock(); }
    const raw = Buffer.concat(chunks);
    evidence.response_sha256 = createHash("sha256").update(raw).digest("hex");
    evidence.response_bytes = raw.length;
    const parsed = parseDefinitions(raw.toString("utf8"), operation, [config.accessToken, config.locationToken]);
    evidence.response_xml = parsed.responseXml;
    if (!response.ok) throw new BrinkError(`PAR definition lookup failed (HTTP ${response.status}).`);
    // Settings v1 returns an array or SOAP fault, not a numeric ResultCode.
    await run(`${operation}-success`, () => db.from("brink_api_calls").update({ ...evidence, status: "success", error: null,
      finished_at: new Date(now()).toISOString(), duration_ms: now() - started }).eq("id", id));
    return { entries: parsed.entries, fetched_at: new Date(started).toISOString() };
  } catch (err) {
    const error = err instanceof BrinkError ? err.message : "PAR definition lookup unavailable; sales retained with POS IDs.";
    await run(`${operation}-error`, () => db.from("brink_api_calls").update({ ...evidence, status: "error", error,
      finished_at: new Date(now()).toISOString(), duration_ms: now() - started }).eq("id", id));
    return cached;
  }
}

export function attachDefinitions(orders, operation, directory) {
  typeFor(operation);
  const byId = new Map(directory.entries.map(e => [e.id, e.name]));
  for (const order of orders) {
    if (operation === "GetDestinations") {
      const name = byId.get(order.destination_id);
      if (name) Object.assign(order, { destination_name: name, destination_name_source: "Settings.GetDestinations", destination_name_fetched_at: directory.fetched_at });
    } else {
      for (const adjustment of order.discounts || []) {
        // A transaction-supplied name takes precedence over current settings.
        if (adjustment.name && adjustment.name_source !== "Settings.GetDiscounts") continue;
        const name = byId.get(adjustment.definition_id);
        if (name) Object.assign(adjustment, { name, name_source: "Settings.GetDiscounts", name_fetched_at: directory.fetched_at });
      }
    }
  }
}
