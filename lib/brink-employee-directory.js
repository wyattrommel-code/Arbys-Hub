import { createHash, randomUUID } from "node:crypto";
import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
import { BrinkError } from "./brink";
import { redactParMessage } from "./brink-evidence";

export const employeesRequest = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://www.brinksoftware.com/webservices/settings/v2"><s:Header/><s:Body><v2:GetEmployees/></s:Body></s:Envelope>';
const scalar = v => typeof v === "string" ? v : "";
const list = v => v == null || v === "" ? [] : Array.isArray(v) ? v : [v];
export function parseEmployeeDirectory(xml, secrets = []) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new BrinkError("PAR returned an invalid employee directory.");
  const parsed = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false }).parse(xml);
  const result = parsed.Envelope?.Body?.GetEmployeesResponse?.GetEmployeesResult;
  const code = scalar(result?.ResultCode);
  const error = result ? scalar(result.Message) : scalar(parsed.Envelope?.Body?.Fault?.faultstring);
  if (code !== "0") return { code, employees: null, message: redactParMessage(error, secrets) };
  // Settings2 uses Collection (Settings v1 used Employees).
  if (!Object.hasOwn(result, "Collection")) throw new BrinkError("PAR employee response is missing its collection.");
  if (result.Collection !== "" && (!result.Collection || typeof result.Collection !== "object" || Array.isArray(result.Collection) || Object.keys(result.Collection).some(k => k !== "Employee"))) throw new BrinkError("PAR returned an unexpected employee collection.");
  const seen = new Set();
  const employees = list(result.Collection?.Employee).map(e => {
    const id = scalar(e.Id);
    if (!/^\d+$/.test(id) || seen.has(id)) throw new BrinkError("PAR returned invalid employee IDs.");
    seen.add(id);
    let name = [scalar(e.FirstName), scalar(e.LastName)].filter(Boolean).join(" ") || scalar(e.DisplayName);
    for (const secret of secrets.filter(Boolean)) name = name.split(secret).join("[REDACTED]");
    return { id, name: name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) };
  });
  return { code, employees, message: "" };
}

// Called only by the owner of the existing shared sales-sync claim. Cache only
// IDs/names in sanitized call evidence; never store the raw HR response.
export async function employeeDirectory({ config, db, run, date, source, version, deadline, fetcher = fetch, now = Date.now }) {
  const previous = await run("read-employee-directory", () => db.from("brink_api_calls")
    .select("status,started_at,response_xml").eq("connection_id", config.connection).eq("operation", "GetEmployees")
    .order("started_at", { ascending: false }).limit(2));
  const rows = previous.data || [];
  let cached = { employees: [], fetched_at: null };
  for (const row of rows) {
    if (row.status !== "success" || !row.response_xml) continue;
    try {
      const result = parseEmployeeDirectory(row.response_xml);
      if (result.employees) { cached = { employees: result.employees, fetched_at: row.started_at }; break; }
    } catch { /* An expired or malformed cache is never an identity source. */ }
  }
  const age = rows[0] ? now() - Date.parse(rows[0].started_at) : Infinity;
  // Refresh twice daily; failed or interrupted lookups wait an hour. The call
  // log expires XML after 24h. Insufficient runtime never blocks saved sales.
  if (age < (rows[0]?.status === "success" ? 12 : 1) * 3600000 || deadline - now() < 10000) return cached;
  const id = randomUUID(), started = now();
  await run("employee-log-intent", () => db.from("brink_api_calls").upsert({ id, connection_id: config.connection,
    environment: config.mode, business_date: date, operation: "GetEmployees", source,
    endpoint: `https://${config.host}/Settings2.svc`, request_xml: employeesRequest, integration_version: version,
  }, { onConflict: "id", ignoreDuplicates: true }));
  const evidence = {};
  try {
    const response = await fetcher(`https://${config.host}/Settings2.svc`, { method: "POST", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(5000), headers: { "Content-Type": "text/xml; charset=utf-8", AccessToken: config.accessToken,
        LocationToken: config.locationToken, SOAPAction: '"http://www.brinksoftware.com/webservices/settings/v2/ISettingsWebService2/GetEmployees"' }, body: employeesRequest });
    evidence.http_status = response.status;
    const reader = response.body?.getReader();
    const chunks = []; let size = 0;
    try {
      while (reader) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new BrinkError("PAR employee directory exceeded its size limit."); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader?.releaseLock(); }
    const raw = Buffer.concat(chunks);
    evidence.response_sha256 = createHash("sha256").update(raw).digest("hex"); evidence.response_bytes = raw.length;
    const result = parseEmployeeDirectory(raw.toString("utf8"), [config.accessToken, config.locationToken]);
    evidence.result_code = /^\d+$/.test(result.code) ? result.code : null;
    const safeResult = { ResultCode: result.code, ...(result.employees ? { Collection: { Employee: result.employees.map(e => ({ Id: e.id, DisplayName: e.name })) } } : { Message: result.message }) };
    const safeXml = new XMLBuilder({ format: true }).build({ Envelope: { Body: { GetEmployeesResponse: { GetEmployeesResult: safeResult } } } });
    if (Buffer.byteLength(safeXml) > 65536) throw new BrinkError("PAR employee name list exceeds the cache limit.");
    evidence.response_xml = safeXml;
    if (!response.ok || !result.employees) throw new BrinkError(`PAR employee lookup failed (HTTP ${response.status}; result ${evidence.result_code || "unavailable"}).${result.message ? ` PAR message (redacted): ${result.message}` : ""}`);
    await run("employee-log-success", () => db.from("brink_api_calls").update({ ...evidence, status: "success", error: null,
      finished_at: new Date(now()).toISOString(), duration_ms: now() - started }).eq("id", id));
    return { employees: result.employees, fetched_at: new Date(started).toISOString() };
  } catch (err) {
    await run("employee-log-error", () => db.from("brink_api_calls").update({ ...evidence, status: "error",
      error: err instanceof BrinkError ? err.message : "Employee-name lookup unavailable; sales are retained with POS IDs.",
      finished_at: new Date(now()).toISOString(), duration_ms: now() - started }).eq("id", id));
    return cached;
  }
}

export function attachEmployeeNames(orders, directory) {
  const byId = new Map(directory.employees.map(e => [e.id, e.name]));
  for (const order of orders) {
    order.employee_name = byId.get(order.employee_id) || null;
    order.employee_name_source = order.employee_name ? "Settings2.GetEmployees" : null;
    order.employee_name_fetched_at = order.employee_name ? directory.fetched_at : null;
    for (const adjustment of [...(order.discounts || []), ...(order.promotions || [])]) {
      adjustment.employee_name = byId.get(adjustment.employee_id) || null;
      adjustment.approver_employee_name = byId.get(adjustment.approver_employee_id) || null;
    }
  }
}
