import test from "node:test";
import assert from "node:assert/strict";
import { capabilityRequest, inspectCapabilityResponse, probeCapability } from "../lib/brink-capabilities.js";

const envelope = body => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${body}</s:Body></s:Envelope>`;
const reply = (op, body) => envelope(`<${op}Response><${op}Result>${body}</${op}Result></${op}Response>`);
const config = { mode: "production", host: "api6.brinkpos.net", accessToken: "private-access", locationToken: "private-location" };

test("capability requests cannot invoke writes or change credential destination", async () => {
  for (const operation of ["SaveEmployees", "CancelOrder", "GetSettings", "__proto__"]) {
    assert.throws(() => capabilityRequest(operation, "2026-10-19", config));
  }
  assert.throws(() => capabilityRequest("GetShifts", "2026-02-30", config));
  await assert.rejects(() => probeCapability({
    operation: "GetShifts", businessDate: "2026-10-19",
    config: { ...config, host: "api6.brinkpos.net.evil.example" },
    fetcher: () => assert.fail("No request to an invalid host"),
  }));
  const req = capabilityRequest("GetShifts", "2026-10-19", config);
  assert.match(req.body, /<BusinessDate>2026-10-19T00:00:00Z<\/BusinessDate>/);
  assert.equal(req.action, "http://www.brinksoftware.com/webservices/labor/v2/ILaborWebService2/GetShifts");
});

test("HTTP 200 does not imply PAR access or a valid collection", () => {
  assert.equal(inspectCapabilityResponse("GetShifts", reply("GetShifts", "<ResultCode>4</ResultCode>"), 200).status, "access_denied");
  assert.equal(inspectCapabilityResponse("GetShifts", reply("GetShifts", "<ResultCode>0</ResultCode>"), 200).status, "invalid_response");
  assert.equal(inspectCapabilityResponse("GetShifts", reply("GetShifts", '<ResultCode>0</ResultCode><Shifts xmlns:i="http://www.w3.org/2001/XMLSchema-instance" i:nil="true"/>'), 200).status, "invalid_response");
  assert.equal(inspectCapabilityResponse("GetShifts", reply("GetShifts", "<ResultCode>0</ResultCode><Shifts/>"), 503).status, "http_error");
  assert.equal(inspectCapabilityResponse("GetShifts", envelope("<Fault><faultstring>private details</faultstring></Fault>"), 200).status, "soap_fault");
});

test("empty available data stays distinct from records and from failure", () => {
  assert.deepEqual(inspectCapabilityResponse("GetShifts", reply("GetShifts", "<ResultCode>0</ResultCode><Shifts/>"), 200),
    { status: "success_empty", result_code: "0", record_count: 0 });
  const raw = reply("GetEmployees", "<ResultCode>0</ResultCode><Collection><Employee><Id>1</Id><FirstName>Private</FirstName><SSN>123-45-6789</SSN><PayRate>42</PayRate></Employee></Collection>");
  assert.deepEqual(inspectCapabilityResponse("GetEmployees", raw, 200),
    { status: "success", result_code: "0", record_count: 1 });
  assert.deepEqual(inspectCapabilityResponse("GetDiscounts", reply("GetDiscounts", "<Discount><Id>1</Id></Discount><Discount><Id>2</Id></Discount>"), 200),
    { status: "success", result_code: null, record_count: 2 });
});

test("malformed and substituted collections do not count as success", () => {
  for (const xml of [
    "<html>Unexpected response</html>",
    "<!DOCTYPE root [<!ENTITY x 'secret'>]><root/>",
    reply("GetEmployees", "<ResultCode>0</ResultCode><Collection><Customer><Id>1</Id></Customer></Collection>"),
    reply("GetEmployees", "<ResultCode>0</ResultCode><Collection><Employee/></Collection>"),
  ]) assert.equal(inspectCapabilityResponse("GetEmployees", xml, 200).status, "invalid_response");
});

test("legacy auth is escaped and never retained in evidence", async () => {
  let calls = 0;
  const result = await probeCapability({
    operation: "GetDiscounts", businessDate: "2026-10-19", config: { ...config, accessToken: "private&access" },
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url, "https://api6.brinkpos.net/Settings.svc");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.AccessToken, undefined);
      assert.match(options.body, /private&amp;access/);
      return new Response(reply("GetDiscounts", "<Discount><Id>1</Id><Name>Private response text</Name></Discount>"));
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "success");
  assert.equal(result.record_count, 1);
  assert.doesNotMatch(JSON.stringify(result), /private|Private response text/);
  assert.match(result.request_xml, /\[REDACTED\]/);
});

test("transport failures have no automatic retries or leaked exception messages", async () => {
  let calls = 0;
  const result = await probeCapability({
    operation: "GetEmployees", businessDate: "2026-10-19", config,
    fetcher: async () => { calls++; throw new Error("private-access private-location"); },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "transport_or_processing_error");
  assert.doesNotMatch(JSON.stringify(result), /private-access|private-location/);
});
