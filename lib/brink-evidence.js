import { createHash } from "node:crypto";
import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
// Allowlisted response data, not a raw payment/customer archive. Keep the SOAP
// method/shape and safe sales fields useful for PAR's validation review.
const allowed = new Set('Envelope Body GetOrdersResponse GetOrdersResult ResultCode Orders Order BusinessDate OpenedTime ClosedTime ModifiedTime DateTime OffsetMinutes Id Number EmployeeId TerminalId Subtotal DisplaySubtotal Tax DisplayTax Total NetSales GrossSales IsClosed IsRefund Count Entries OrderEntry ItemId Description Price DisplayPrice IsCleared IsDeleted IsVoided CompositeOrderItemId Modifiers OrderItemModifier ModifierCodeId ModifierGroupId ItemNetSales ItemGrossSales Taxes OrderTax OrderEntryTax Amount TaxId IsInclusive Discounts OrderDiscount OrderItemDiscount DiscountId OrderDiscountId Promotions OrderPromotion PromotionId Surcharges OrderSurcharge SurchargeId'.split(' '));
const parser = () => new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false });
const scalar = value => typeof value === 'string' ? value : '';

// Diagnostic text is untrusted free text, not another allowlisted sales field.
// Redact before truncating so a cut-off credential cannot escape matching.
export function redactParMessage(value, secrets = []) {
  let text = scalar(value);
  if (!text) return '';
  if (Buffer.byteLength(text) > 16384) return '[PAR message omitted: exceeds 16 KiB safety limit]';
  for (const secret of secrets.filter(v => typeof v === 'string' && v)) {
    for (const variant of [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]) {
      text = text.split(variant).join('[REDACTED]');
    }
  }
  // Omit embedded payloads, URLs and quoted values instead of archiving echoes
  // of request headers, customer records, payment objects or stack traces.
  text = text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '[REDACTED PAYLOAD]')
    .replace(/<[^>]*>/g, '[REDACTED TAG]')
    .replace(/\{[\s\S]*\}/g, '[REDACTED PAYLOAD]')
    .replace(/https?:\/\/[^\s<>]+/gi, '[REDACTED URL]')
    .replace(/"[^"\r\n]*"|'[^'\r\n]*'/g, '[REDACTED VALUE]')
    .replace(/\b(?:access[ _-]?token|location[ _-]?token|authorization|api[ _-]?key|password|secret|card[ _-]?(?:token|number|holder(?:name)?)|account[ _-]?(?:number|name)|customer[ _-]?(?:id|name|email|phone)|name|address|phone|email|cvv|cvc|pin)\s*[:=]\s*[^;\r\n]*/gi, '[REDACTED FIELD]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED EMAIL]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[REDACTED ID]')
    .replace(/(?:\+?\d[\s().-]*){10,19}/g, '[REDACTED NUMBER]')
    .replace(/\b[A-Za-z0-9_+\/=-]{24,}\b/g, '[REDACTED TOKEN]')
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text.length > 1000 ? text.slice(0, 1000) + ' [TRUNCATED]' : text;
}

// Read only our already-sanitized evidence. Never interpolate raw PAR messages
// into generic errors, database diagnostics or browser HTML.
export function parDiagnostic(sanitizedXml) {
  if (!sanitizedXml || /<!DOCTYPE|<!ENTITY/i.test(sanitizedXml) || XMLValidator.validate(sanitizedXml) !== true) return '';
  try {
    const body = parser().parse(sanitizedXml).Envelope?.Body;
    const result = body?.GetOrdersResponse?.GetOrdersResult;
    return scalar(result?.Message) || scalar(body?.Fault?.faultstring);
  } catch { return ''; }
}
export function ordersRequest(date) {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://www.brinksoftware.com/webservices/sales/v2"><s:Header/><s:Body><v2:GetOrders><v2:request><v2:BusinessDate>${date}</v2:BusinessDate><v2:ExcludeOpenOrders>false</v2:ExcludeOpenOrders></v2:request></v2:GetOrders></s:Body></s:Envelope>`;
}
export function responseEvidence(xml, secrets = []) {
  const result = { response_sha256: createHash('sha256').update(xml).digest('hex'), response_bytes: Buffer.byteLength(xml), result_code: null, response_xml: null, response_truncated: false };
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) return result;
  try {
    const parsed = parser().parse(xml);
    if (!parsed.Envelope?.Body) return result;
    const code = parsed.Envelope?.Body?.GetOrdersResponse?.GetOrdersResult?.ResultCode;
    result.result_code = /^[0-9]+$/.test(String(code)) ? String(code) : null;
    const clean = (value, parent = '') => {
      if (Array.isArray(value)) return value.map(v => clean(v, parent));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
        .filter(([key]) => allowed.has(key) || (key === 'Name' && ['OrderDiscount', 'OrderPromotion'].includes(parent)) ||
          ['ApproverEmployeeId', 'OrderEntryPromotion', 'OrderPromotionId', 'Denominator', 'SplitItemId', 'NonRevenueItem', 'FirstSendTime'].includes(key))
        .map(([key, v]) => [key, clean(v, key)]));
      let text = String(value ?? '');
      for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]');
      return text;
    };
    const cleaned = clean(parsed);
    const body = parsed.Envelope.Body;
    const safeBody = cleaned.Envelope.Body;
    const ordersResult = body.GetOrdersResponse?.GetOrdersResult;
    if (ordersResult && result.result_code !== '0') {
      const message = redactParMessage(ordersResult.Message, secrets);
      if (message) safeBody.GetOrdersResponse.GetOrdersResult.Message = message;
    }
    if (body.Fault && !Array.isArray(body.Fault)) {
      safeBody.Fault = {};
      for (const key of ['faultcode', 'faultstring']) {
        const message = redactParMessage(body.Fault[key], secrets);
        if (message) safeBody.Fault[key] = message;
      }
      // Deliberately exclude SOAP detail/faultactor: they may contain records.
    }
    const builder = new XMLBuilder({ format: true });
    const safe = builder.build(cleaned);
    if (Buffer.byteLength(safe) <= 65536) result.response_xml = safe;
    else {
      // Preserve valid XML and explicitly mark omitted details, never silently
      // return a partial response as the full evidence.
      const diagnostic = safeBody.Fault ? { Fault: safeBody.Fault } : safeBody.GetOrdersResponse?.GetOrdersResult?.Message ? {
        GetOrdersResponse: { GetOrdersResult: { ResultCode: result.result_code, Message: safeBody.GetOrdersResponse.GetOrdersResult.Message } }
      } : {};
      result.response_xml = builder.build({ Envelope: { Body: { ...diagnostic,
        EvidenceOmitted: 'Sanitized response exceeds 64 KiB. See saved sales snapshot and response hash.' } } });
      result.response_truncated = true;
    }
  } catch { /* Keep hash/status even when XML is malformed. */ }
  return result;
}
