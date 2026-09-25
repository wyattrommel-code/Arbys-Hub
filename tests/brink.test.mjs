import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { brinkConfig, fetchOrders, parseOrders, summarizeOrders, validBusinessDate, validCronSecret } from "../lib/brink.js";
import { responseEvidence, ordersRequest, parDiagnostic, redactParMessage } from "../lib/brink-evidence.js";
import { brinkOrderExport, orderMatches } from "../lib/brink-order-data.js";

const env = { BRINK_ACCESS_TOKEN: "synthetic-access", BRINK_LOCATION_TOKEN: "synthetic-location" };
const order = (extra = "", id = "9007199254740999") => `<Order><Id>${id}</Id><Number>100</Number><BusinessDate>2026-09-09T00:00:00</BusinessDate><IsClosed>true</IsClosed><IsRefund>false</IsRefund><OpenedTime>2026-09-09T18:28:26.0352606Z0</OpenedTime><ClosedTime>2026-09-09T18:28:41Z</ClosedTime><EmployeeId>42</EmployeeId><TerminalId>1</TerminalId><Subtotal>5.49</Subtotal><NetSales>5.49</NetSales><Tax>0.46</Tax><Total>5.95</Total><Entries><OrderEntry><Id>1</Id><ItemId>5</ItemId><Description>BnC Classic &amp; cheese</Description><Price>5.49</Price><NetSales>5.49</NetSales></OrderEntry></Entries>${extra}</Order>`;
const soap = (orders, code = 0) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><GetOrdersResponse><GetOrdersResult><ResultCode>${code}</ResultCode><Orders>${orders}</Orders></GetOrdersResult></GetOrdersResponse></s:Body></s:Envelope>`;
test("configuration isolates locations, allows key rotation and rejects unsafe hosts", () => {
  const config = brinkConfig(env);
  assert.equal(config.mode, "sandbox");
  assert.equal(config.publish, false);
  assert.equal(config.connection, brinkConfig({ ...env, BRINK_ACCESS_TOKEN: "rotated" }).connection);
  assert.notEqual(config.connection, brinkConfig({ ...env, BRINK_LOCATION_TOKEN: "other" }).connection);
  assert.equal(brinkConfig({ ...env, BRINK_PUBLISH_HOURLY_SALES: "true" }).publish, false);
  for (const host of ["evil.com", "api.brinkpos.net.evil.com", "api-apiint.brinkpos.net/path", "localhost", "api.brinkpos.net"]) assert.throws(() => brinkConfig({ ...env, BRINK_API_HOST: host }));
  assert.throws(() => brinkConfig({ ...env, BRINK_ENVIRONMENT: "production" }));
  assert.equal(brinkConfig({ ...env, BRINK_ENVIRONMENT: "production", BRINK_API_HOST: "api.brinkpos.net", BRINK_PUBLISH_HOURLY_SALES: "true" }).publish, true);
});
test("SOAP parsing preserves long IDs, normalizes PAR timestamps, strips payment data", () => {
  const result = parseOrders(soap(order("<Payments><CardToken>private-payment</CardToken></Payments><Name>private-name</Name>")), "2026-09-09");
  assert.equal(result[0].id, "9007199254740999");
  assert.equal(result[0].opened_at, "2026-09-09T18:28:26.035Z");
  assert.equal(result[0].items[0].description, "BnC Classic & cheese");
  assert.ok(!JSON.stringify(result).includes("private-"));
  const summary = summarizeOrders(result);
  assert.equal(summary.closed_orders, 1); assert.equal(summary.total, 5.95);
  assert.equal(summary.hourly[12].net_sales, 5.49);
  assert.equal(summary.hourly.reduce((s, h) => s + h.net_sales, 0), 5.49);
});

test("offers, allocations, combo links and recursive modifiers survive without sensitive payloads", () => {
  const extra = '<Discounts><OrderDiscount><Id>7</Id><DiscountId>80</DiscountId><Name>Senior 10%</Name><Amount>0.99</Amount><EmployeeId>42</EmployeeId><ApproverEmployeeId>43</ApproverEmployeeId><ExternalLoyaltyAccount>private-loyalty</ExternalLoyaltyAccount></OrderDiscount></Discounts><Promotions><OrderPromotion><Id>8</Id><PromotionId>90</PromotionId><Name>Lunch offer</Name><Amount>1.00</Amount></OrderPromotion></Promotions><Name>private-customer</Name>';
  const itemExtra = '<CompositeOrderItemId>6</CompositeOrderItemId><Denominator>2</Denominator><ItemNetSales>4.50</ItemNetSales><Discounts><OrderItemDiscount><Id>0</Id><OrderDiscountId>7</OrderDiscountId><Amount>0.99</Amount></OrderItemDiscount></Discounts><Promotions><OrderEntryPromotion><Id>1</Id><OrderPromotionId>8</OrderPromotionId><Amount>1</Amount></OrderEntryPromotion></Promotions><Modifiers><OrderItemModifier><Id>2</Id><ItemId>101</ItemId><ModifierCodeId>3</ModifierCodeId><Modifiers><OrderItemModifier><Id>3</Id><ItemId>102</ItemId><Modifiers/></OrderItemModifier></Modifiers><Note>private-note</Note></OrderItemModifier></Modifiers>';
  const xml = soap(order(extra).replace('</OrderEntry>', `${itemExtra}</OrderEntry>`));
  const [o] = parseOrders(xml, '2026-09-09');
  assert.equal(o.details_version, 2); assert.equal(o.discounts[0].name, 'Senior 10%');
  assert.equal(o.discounts[0].approver_employee_id, '43'); assert.equal(o.promotions[0].amount, 1);
  assert.equal(o.items[0].composite_order_item_id, '6'); assert.equal(o.items[0].split_denominator, 2);
  assert.equal(o.items[0].discounts[0].order_adjustment_id, '7'); assert.equal(o.items[0].promotions[0].order_adjustment_id, '8');
  assert.equal(o.items[0].modifiers[0].modifiers[0].item_id, '102');
  assert.equal(summarizeOrders([o]).net_sales, 5.49, 'never subtract retained adjustments a second time');
  assert.ok(!JSON.stringify(o).includes('private-'));
  const evidence = responseEvidence(xml);
  assert.ok(evidence.response_xml.includes('<Name>Senior 10%</Name>'));
  assert.ok(evidence.response_xml.includes('<Name>Lunch offer</Name>'));
  assert.ok(!evidence.response_xml.includes('private-'));
  assert.equal(orderMatches(o, 'senior'), true); assert.equal(orderMatches(o, '42'), true);
});

test("missing detail collections remain unknown and malformed details preserve the previous snapshot", () => {
  const [missing] = parseOrders(soap(order()), '2026-09-09');
  assert.equal(missing.discounts, null); assert.equal(missing.items[0].modifiers, null);
  const [empty] = parseOrders(soap(order('<Discounts/><Promotions/>')), '2026-09-09');
  assert.deepEqual(empty.discounts, []);
  for (const extra of ['<Discounts><Unexpected/></Discounts>', '<Discounts><OrderDiscount><Amount>bad</Amount></OrderDiscount></Discounts>']) {
    assert.throws(() => parseOrders(soap(order(extra)), '2026-09-09'));
  }
  const legacy = { ...missing }; delete legacy.details_version; delete legacy.discounts;
  const exported = brinkOrderExport({ environment: 'sandbox', label: 'Lab', business_date: '2026-09-09', day: { orders: [legacy] } });
  assert.equal(exported.orders[0].details_version, 1); assert.equal(exported.orders[0].discounts, null);
  assert.equal(exported.environment, 'sandbox'); assert.equal(exported.schema, 'brink.orders.v2');
});
test("open orders, refunds and empty collections have correct totals", () => {
  const closed = parseOrders(soap(order()), "2026-09-09")[0];
  const summary = summarizeOrders([closed, { ...closed, closed: false, total: 100 }, { ...closed, refund: true, total: -5.95, tax: -0.46, net_sales: -5.49 }]);
  assert.equal(summary.total, 0); assert.equal(summary.closed_orders, 2); assert.equal(summary.open_orders, 1);
  assert.deepEqual(parseOrders(soap(""), "2026-09-09"), []);
  assert.equal(summarizeOrders([]).hourly.length, 24);
});
test("WCF DateTimeOffset wrappers preserve UTC rather than shifting by OffsetMinutes", () => {
  const xml = soap(order()).replace("<OpenedTime>2026-09-09T18:28:26.0352606Z0</OpenedTime>", '<OpenedTime><a:DateTime xmlns:a="http://schemas.datacontract.org/2004/07/System">2026-09-09T18:28:26.0352606Z</a:DateTime><OffsetMinutes>-360</OffsetMinutes></OpenedTime>');
  const orders = parseOrders(xml, "2026-09-09");
  assert.equal(orders[0].opened_at, "2026-09-09T18:28:26.035Z");
  assert.equal(summarizeOrders(orders).hourly[12].net_sales, 5.49);
});
test("failed and malformed PAR responses cannot masquerade as zero sales", () => {
  for (const xml of [soap(order(), 4), soap(order() + order()), soap(order()).replace("5.49", "NaN"), soap(order()).replace("2026-09-09T00:00:00", "2026-09-08T00:00:00"), '<!DOCTYPE x [<!ENTITY x "bad">]>' + soap(""), "<broken>", soap("").replace("<Orders></Orders>", "")]) assert.throws(() => parseOrders(xml, "2026-09-09"));
  assert.equal(validBusinessDate("2026-02-30"), false); assert.equal(validBusinessDate("2026-09-09"), true);
});
test("request uses assigned host, protected headers and no redirects; errors hide credentials", async () => {
  const config = brinkConfig(env);
  await fetchOrders(config, "2026-09-09", async (url, options) => {
    assert.equal(url, "https://api-apiint.brinkpos.net/Sales2.svc");
    assert.equal(options.redirect, "error"); assert.equal(options.headers.AccessToken, env.BRINK_ACCESS_TOKEN);
    assert.ok(!options.body.includes(env.BRINK_ACCESS_TOKEN));
    return new Response(soap(order()));
  });
  await assert.rejects(fetchOrders(config, "2026-09-09", async () => { throw new Error(env.BRINK_ACCESS_TOKEN); }), (e) => !e.message.includes(env.BRINK_ACCESS_TOKEN));
  assert.equal(validCronSecret("Bearer " + "a".repeat(32), "a".repeat(32)), true);
  assert.equal(validCronSecret("Bearer bad", "a".repeat(32)), false);
  assert.equal(validCronSecret(null, undefined), false);
});
test("database blocks public access, duplicate syncs, stale writes and sandbox publication", async (t) => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role; create table public.hourly_sales(sale_date date,hour_of_day int,net_sales numeric,updated_at timestamptz,primary key(sale_date,hour_of_day)); grant all on public.hourly_sales to service_role;");
  await db.exec(await readFile(new URL("../supabase/migrations/20260909211242_brink_sales_sync.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20260909215645_brink_api_call_log.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20260914172749_brink_sync_diagnostics.sql", import.meta.url), "utf8"));
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.exec("select * from public.brink_sales_days"), /permission denied/);
    await assert.rejects(db.exec("select * from public.brink_api_calls"), /permission denied/);
    await assert.rejects(db.exec("select public.brink_claim_sync('test','11111111-1111-4111-8111-111111111111')"), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  const attempt = "11111111-1111-4111-8111-111111111111";
  const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
  assert.equal(await value("select public.brink_claim_sync('test',$1) as value", [attempt]), true);
  assert.equal(await value("select public.brink_claim_sync('test',$1) as value", [attempt]), false);
  const orders = parseOrders(soap(order()), "2026-09-09");
  const summary = summarizeOrders(orders);
  const finish = (mode, publish, id = attempt) => value("select public.brink_finish_sync('test',$1,'2026-09-09',$2,$3,$4,$5) as value", [id, mode, JSON.stringify(orders), JSON.stringify(summary), publish]);
  await assert.rejects(finish("sandbox", true), /Sandbox cannot publish/);
  assert.equal(await finish("sandbox", false), true);
  assert.equal(await finish("sandbox", false), true);
  assert.equal(await value("select count(*)::int as value from public.brink_sales_days"), 1);
  assert.equal(await value("select count(*)::int as value from public.hourly_sales"), 0);
  assert.equal(await finish("sandbox", false, "22222222-2222-4222-8222-222222222222"), false);
  assert.equal(await finish("production", true), true);
  assert.equal(await value("select count(*)::int as value from public.hourly_sales"), 24);
  assert.equal(Number(await value("select sum(net_sales) as value from public.hourly_sales")), 5.49);
});
test("call evidence preserves useful XML but excludes credentials and customer/payment data", () => {
  const xml = soap(order('<Payments><CardToken>card-secret</CardToken></Payments><CustomerId>customer-secret</CustomerId><Name>person-secret</Name><Note>private-note</Note>')).replace('BnC Classic', 'synthetic-access');
  const evidence = responseEvidence(xml, ['synthetic-access']);
  assert.equal(evidence.result_code, '0');
  assert.equal(evidence.response_sha256.length, 64);
  assert.equal(evidence.response_bytes, Buffer.byteLength(xml));
  for (const secret of ['card-secret','customer-secret','person-secret','private-note','synthetic-access']) assert.ok(!evidence.response_xml.includes(secret));
  assert.ok(evidence.response_xml.includes('5.95'));
  assert.ok(ordersRequest('2026-09-09').includes('<v2:BusinessDate>2026-09-09</v2:BusinessDate>'));
  assert.equal(responseEvidence('<bad>').response_xml, null);
  assert.equal(responseEvidence('<!DOCTYPE x>' + xml).response_xml, null);
  const large = responseEvidence(soap(order().replace('BnC Classic', 'x'.repeat(70000))));
  assert.equal(large.response_truncated, true);
  assert.ok(large.response_xml.length < 300);
});
test("PAR errors retain HTTP and result evidence even when parsing fails", async () => {
  const evidence = {};
  await assert.rejects(fetchOrders(brinkConfig(env),'2026-09-09',async () => new Response(soap('',4)),evidence));
  assert.equal(evidence.http_status,200); assert.equal(evidence.result_code,'4');
  const httpError = {};
  await assert.rejects(fetchOrders(brinkConfig(env),'2026-09-09',async () => new Response('secret upstream message',{status:500}),httpError));
  assert.equal(httpError.http_status,500); assert.equal(httpError.response_xml,null);
});

test("result-code 1 retains a bounded, redacted PAR explanation without nested messages", async () => {
  const message = 'Unable to load business date 2026-09-24. AccessToken=synthetic-access; LocationToken=synthetic-location; customer@example.com; 4111 1111 1111 1111';
  const xml = soap('', 1).replace('<Orders>', `<Message>${message}</Message><Orders>`);
  const evidence = {};
  await assert.rejects(fetchOrders(brinkConfig(env), '2026-09-24', async () => new Response(xml), evidence), e => {
    assert.match(e.message, /PAR message \(redacted\): Unable to load business date 2026-09-24/);
    for (const secret of ['synthetic-access', 'synthetic-location', 'customer@example.com', '4111']) assert.ok(!e.message.includes(secret));
    return true;
  });
  assert.equal(evidence.result_code, '1');
  assert.match(parDiagnostic(evidence.response_xml), /Unable to load/);
  const nested = responseEvidence(soap('<Order><Message>nested-private-text</Message></Order>', 1).replace('<Orders>', '<Message><CustomerName>private-name</CustomerName></Message><Orders>'));
  assert.ok(!nested.response_xml.includes('private'));
  assert.equal(parDiagnostic(nested.response_xml), '');
  assert.equal(parDiagnostic(responseEvidence(soap('', 0).replace('<Orders>', '<Message>success-private-text</Message><Orders>')).response_xml), '');
});

test("HTTP SOAP faults retain safe fault text but discard detail and non-XML bodies", async () => {
  const xml = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Server</faultcode><faultstring>Register unavailable. Bearer private-auth; https://example.com/?token=private-query</faultstring><detail><Message>private-detail</Message><Name>private-name</Name></detail></s:Fault></s:Body></s:Envelope>';
  const evidence = {};
  await assert.rejects(fetchOrders(brinkConfig(env), '2026-09-24', async () => new Response(xml, { status: 500 }), evidence), e => {
    assert.match(e.message, /HTTP 500/); assert.match(e.message, /Register unavailable/);
    return true;
  });
  assert.match(evidence.response_xml, /s:Server/);
  for (const secret of ['private-auth', 'private-query', 'private-detail', 'private-name']) assert.ok(!evidence.response_xml.includes(secret));
  const html = responseEvidence('<html><body>private-upstream-page</body></html>');
  assert.equal(html.response_xml, null);
  const empty = {};
  await assert.rejects(fetchOrders(brinkConfig(env), '2026-09-24', async () => new Response(null, { status: 503 }), empty), /HTTP 503/);
  assert.equal(empty.http_status, 503);
});

test("redaction occurs before truncation and escapes diagnostic text as XML", () => {
  const secret = 'long-secret&amp-value';
  const message = 'x'.repeat(990) + ' ' + secret;
  assert.ok(!redactParMessage(message, [secret]).includes('long-secret'));
  assert.equal(redactParMessage('x '.repeat(1000)).length, 1012);
  assert.equal(redactParMessage('private '.repeat(3000)), '[PAR message omitted: exceeds 16 KiB safety limit]');
  const xml = soap('', 1).replace('<Orders>', '<Message><![CDATA[Failure & retry. <script>alert(1)</script> "Jane Doe" {"password":"hidden"}]]></Message><Orders>');
  const evidence = responseEvidence(xml);
  assert.match(evidence.response_xml, /Failure &amp; retry/);
  for (const secret of ['alert(1)', 'Jane Doe', 'hidden']) assert.ok(!evidence.response_xml.includes(secret));
  const encoded = responseEvidence(soap('', 1).replace('<Orders>', '<Message>Failed synthetic&amp;secret</Message><Orders>'), ['synthetic&secret']);
  assert.ok(!encoded.response_xml.includes('secret'));
  const oversized = responseEvidence(soap(order().replace('BnC Classic', 'x'.repeat(70000)), 1).replace('<Orders>', '<Message>Register unavailable</Message><Orders>'));
  assert.equal(oversized.response_truncated, true);
  assert.equal(parDiagnostic(oversized.response_xml), 'Register unavailable');
});
