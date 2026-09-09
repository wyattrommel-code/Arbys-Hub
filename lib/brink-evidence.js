import { createHash } from "node:crypto";
import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
// Allowlisted response data, not a raw payment/customer archive. Keep the SOAP
// method/shape and safe sales fields useful for PAR's validation review.
const allowed = new Set('Envelope Body GetOrdersResponse GetOrdersResult ResultCode Orders Order BusinessDate OpenedTime ClosedTime ModifiedTime DateTime OffsetMinutes Id Number EmployeeId TerminalId Subtotal DisplaySubtotal Tax DisplayTax Total NetSales GrossSales IsClosed IsRefund Count Entries OrderEntry ItemId Description Price DisplayPrice IsCleared IsDeleted IsVoided CompositeOrderItemId Modifiers OrderItemModifier ModifierCodeId ModifierGroupId ItemNetSales ItemGrossSales Taxes OrderTax OrderEntryTax Amount TaxId IsInclusive Discounts OrderDiscount OrderItemDiscount DiscountId OrderDiscountId Promotions OrderPromotion PromotionId Surcharges OrderSurcharge SurchargeId'.split(' '));
export function ordersRequest(date) {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://www.brinksoftware.com/webservices/sales/v2"><s:Header/><s:Body><v2:GetOrders><v2:request><v2:BusinessDate>${date}</v2:BusinessDate><v2:ExcludeOpenOrders>false</v2:ExcludeOpenOrders></v2:request></v2:GetOrders></s:Body></s:Envelope>`;
}
export function responseEvidence(xml, secrets = []) {
  const result = { response_sha256: createHash('sha256').update(xml).digest('hex'), response_bytes: Buffer.byteLength(xml), result_code: null, response_xml: null, response_truncated: false };
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) return result;
  try {
    const parsed = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, parseTagValue: false }).parse(xml);
    const code = parsed.Envelope?.Body?.GetOrdersResponse?.GetOrdersResult?.ResultCode;
    result.result_code = /^[0-9]+$/.test(String(code)) ? String(code) : null;
    const clean = (value) => {
      if (Array.isArray(value)) return value.map(clean);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)).map(([key, v]) => [key, clean(v)]));
      let text = String(value ?? '');
      for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]');
      return text;
    };
    const safe = new XMLBuilder({ format: true }).build(clean(parsed));
    if (Buffer.byteLength(safe) <= 65536) result.response_xml = safe;
    else {
      // Preserve valid XML and explicitly mark omitted details, never silently
      // return a partial response as the full evidence.
      result.response_xml = '<EvidenceOmitted>Sanitized response exceeds 64 KiB. See saved sales snapshot and response hash.</EvidenceOmitted>';
      result.response_truncated = true;
    }
  } catch { /* Keep hash/status even when XML is malformed. */ }
  return result;
}
