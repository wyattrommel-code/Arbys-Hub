// Read-only capability checks. Results contain counts, never returned records.
import { createHash } from "node:crypto";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { brinkConfig, validBusinessDate } from "./brink";

const contracts = Object.freeze({
  GetEmployees: { service: "Settings2", ns: "settings/v2", contract: "ISettingsWebService2", collection: "Collection", row: "Employee" },
  GetItems: { service: "Settings2", ns: "settings/v2", contract: "ISettingsWebService2", collection: "Collection", row: "Item" },
  GetShifts: { service: "Labor2", ns: "labor/v2", contract: "ILaborWebService2", collection: "Shifts", row: "Shift", date: true },
  GetOrderBumpTimes: { service: "Kitchen", ns: "kitchen/v1", contract: "IKitchenWebService", collection: "OrderBumpTimes", row: "OrderBumpTime", date: true },
  GetOrderItemBumpTimes: { service: "Kitchen", ns: "kitchen/v1", contract: "IKitchenWebService", collection: "OrderItemBumpTimes", row: "OrderItemBumpTime", date: true },
  GetDiscounts: { service: "Settings", row: "Discount", legacy: true },
  GetDestinations: { service: "Settings", row: "Destination", legacy: true },
  GetTenders: { service: "Settings", row: "Tender", legacy: true },
  GetTills: { service: "Sales2", ns: "sales/v2", contract: "ISalesWebService2", collection: "Tills", row: "Till", date: true },
  GetDeposits: { service: "Sales2", ns: "sales/v2", contract: "ISalesWebService2", collection: "Deposits", row: "Deposit", date: true },
});

export const capabilityBatches = Object.freeze({
  core: Object.freeze(["GetEmployees", "GetItems", "GetShifts", "GetOrderBumpTimes", "GetOrderItemBumpTimes"]),
  reference: Object.freeze(["GetDiscounts", "GetDestinations", "GetTenders", "GetTills", "GetDeposits"]),
});

function contractFor(operation) {
  if (!Object.hasOwn(contracts, operation)) throw new Error("Unsupported read-only PAR capability.");
  return contracts[operation];
}

export function capabilityRequest(operation, businessDate, credentials) {
  const c = contractFor(operation);
  if (!validBusinessDate(businessDate)) throw new Error("Invalid business date.");
  const ns = c.legacy ? "http://tempuri.org/" : `http://www.brinksoftware.com/webservices/${c.ns}`;
  const content = c.legacy
    ? { accessToken: credentials.accessToken, locationToken: credentials.locationToken }
    : c.date ? { request: { BusinessDate: `${businessDate}T00:00:00Z` } } : {};
  const body = new XMLBuilder().build({ [operation]: content });
  return {
    service: c.service,
    action: `${ns}${c.legacy ? "" : "/"}${c.contract || "ISettingsWebService"}/${operation}`,
    body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body xmlns="${ns}">${body}</s:Body></s:Envelope>`,
    credentialsInBody: Boolean(c.legacy),
  };
}

export function inspectCapabilityResponse(operation, xml, httpStatus) {
  const c = contractFor(operation);
  const failure = (status, code = null) => ({ status, result_code: code, record_count: null });
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) return failure("invalid_response");
  const parsed = new XMLParser({
    removeNSPrefix: true, ignoreAttributes: false, parseTagValue: false, trimValues: true,
  }).parse(xml);
  const body = parsed.Envelope?.Body;
  if (body?.Fault) return failure("soap_fault");
  const result = body?.[`${operation}Response`]?.[`${operation}Result`];
  const code = typeof result?.ResultCode === "string" && /^\d+$/.test(result.ResultCode) ? result.ResultCode : null;
  if (httpStatus < 200 || httpStatus >= 300) return failure("http_error", code);
  if (result == null || result?.["@_nil"] === "true") return failure("invalid_response", code);
  if (!c.legacy && code !== "0") return failure(code === "4" ? "access_denied" : code ? "par_error" : "invalid_response", code);
  if (!c.legacy && !Object.hasOwn(result, c.collection)) return failure("invalid_response", code);
  const collection = c.legacy ? result : result[c.collection];
  // A null collection is not evidence of a valid, empty data collection.
  if (collection !== "" && (!collection || typeof collection !== "object" || Array.isArray(collection) ||
      collection["@_nil"] === "true" || Object.keys(collection).some(k => !k.startsWith("@_") && k !== c.row))) {
    return failure("invalid_response", code);
  }
  const value = collection?.[c.row];
  const rows = value == null ? [] : Array.isArray(value) ? value : [value];
  if (rows.some(row => !row || typeof row !== "object" || Array.isArray(row) || row["@_nil"] === "true")) {
    return failure("invalid_response", code);
  }
  // No names, IDs, wages, card fields, or freeform server messages leave here.
  return { status: rows.length ? "success" : "success_empty", result_code: code, record_count: rows.length };
}

export async function probeCapability({ operation, businessDate, config, fetcher = fetch }) {
  contractFor(operation);
  // Revalidate a caller-supplied host immediately before using credentials.
  const checked = brinkConfig({
    BRINK_ENVIRONMENT: config.mode, BRINK_API_HOST: config.host,
    BRINK_ACCESS_TOKEN: config.accessToken, BRINK_LOCATION_TOKEN: config.locationToken,
  });
  if (!checked.configured) throw new Error("PAR credentials are unavailable.");
  const request = capabilityRequest(operation, businessDate, checked);
  const safeRequest = capabilityRequest(operation, businessDate, { accessToken: "[REDACTED]", locationToken: "[REDACTED]" });
  const start = Date.now();
  const evidence = {
    operation, service: request.service, business_date: contractFor(operation).date ? businessDate : null,
    endpoint: `https://${checked.host}/${request.service}.svc`, started_at: new Date(start).toISOString(),
    request_xml: safeRequest.body, http_status: null, result_code: null,
    record_count: null, status: "started", response_bytes: null, response_sha256: null,
  };
  try {
    const response = await fetcher(evidence.endpoint, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${request.action}"`,
        ...(!request.credentialsInBody ? { AccessToken: checked.accessToken, LocationToken: checked.locationToken } : {}),
      },
      body: request.body,
    });
    evidence.http_status = response.status;
    const chunks = []; let size = 0;
    const reader = response.body?.getReader();
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > (response.ok ? 20 * 1024 * 1024 : 256 * 1024)) {
          await reader.cancel();
          evidence.status = "response_too_large";
          return evidence;
        }
        chunks.push(Buffer.from(value));
      }
    } finally { reader?.releaseLock(); }
    const raw = Buffer.concat(chunks);
    evidence.response_bytes = raw.length;
    evidence.response_sha256 = createHash("sha256").update(raw).digest("hex");
    Object.assign(evidence, inspectCapabilityResponse(operation, raw.toString("utf8"), response.status));
  } catch {
    evidence.status = "transport_or_processing_error";
  } finally {
    evidence.finished_at = new Date().toISOString();
    evidence.duration_ms = Date.now() - start;
  }
  return evidence;
}
