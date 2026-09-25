import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEmployeeDirectory, employeeDirectory, attachEmployeeNames } from '../lib/brink-employee-directory.js';
const xml = '<Envelope><Body><GetEmployeesResponse><GetEmployeesResult><ResultCode>0</ResultCode><Collection><Employee><Id>42</Id><FirstName>Sample</FirstName><LastName>Employee</LastName><Pin>private-pin</Pin><Ssn>private-ssn</Ssn><Jobs><PayRate>999</PayRate></Jobs><EmailAddress>private-email</EmailAddress></Employee></Collection></GetEmployeesResult></GetEmployeesResponse></Body></Envelope>';
test('employee directory retains only ID/name; rejects malformed replies and never guesses identity', () => {
  const result = parseEmployeeDirectory(xml);
  assert.deepEqual(result.employees, [{ id: '42', name: 'Sample Employee' }]);
  assert.throws(() => parseEmployeeDirectory(xml.replace('<Collection>', '<Collection><Unknown/>')));
  assert.throws(() => parseEmployeeDirectory(xml.replace('Collection', 'Other')));
  const orders = [{ employee_id: '42', discounts: [{ employee_id: '43', approver_employee_id: '42' }] }, { employee_id: '99' }];
  attachEmployeeNames(orders, { ...result, fetched_at: '2026-09-25T00:00:00Z' });
  assert.equal(orders[0].employee_name, 'Sample Employee'); assert.equal(orders[1].employee_name, null);
  assert.equal(orders[0].discounts[0].employee_name, null); assert.equal(orders[0].discounts[0].approver_employee_name, 'Sample Employee');
});
function setup(rows = [], failIntent = false) {
  const writes = [];
  const db = { from() {
    const q = { select(){ return q; }, eq(){ return q; }, order(){ return q; }, limit(){ return q; },
      upsert(v){ writes.push(v); return q; }, update(v){ writes.push(v); return q; } };
    return q;
  } };
  let calls = 0;
  const options = { config: { connection: 'sandbox-location-a', mode: 'sandbox', host: 'api-apiint.brinkpos.net', accessToken: 'secret-access', locationToken: 'secret-location' },
    db, date: '2026-09-25', source: 'automatic', version: 'test', now: () => Date.parse('2026-09-25T12:00:00Z'), deadline: Date.parse('2026-09-25T12:01:00Z'),
    run: async (stage, build) => { if (stage === 'employee-log-intent' && failIntent) throw Error('logging unavailable'); build(); return { data: rows }; },
    fetcher: async (url, init) => { calls++; assert.match(url, /Settings2\.svc$/); assert.equal(init.redirect, 'error'); return new Response(xml); },
  };
  return { options, writes, count: () => calls };
}
test('directory calls have safe evidence and use the per-connection cache without repeated requests', async () => {
  const fresh = setup(); const result = await employeeDirectory(fresh.options);
  assert.equal(fresh.count(), 1); assert.equal(result.employees[0].id, '42');
  assert.equal(fresh.writes[0].connection_id, 'sandbox-location-a'); assert.equal(fresh.writes[0].operation, 'GetEmployees');
  const saved = fresh.writes.at(-1); assert.equal(saved.status, 'success');
  for (const secret of ['private-', 'PayRate', 'secret-access', 'secret-location']) assert.ok(!JSON.stringify(fresh.writes).includes(secret));
  const cached = setup([{ status: 'success', started_at: '2026-09-25T11:00:00Z', response_xml: saved.response_xml }]);
  assert.equal((await employeeDirectory(cached.options)).employees[0].name, 'Sample Employee'); assert.equal(cached.count(), 0);
  const failed = setup([{ status: 'started', started_at: '2026-09-25T11:30:00Z' }]);
  await employeeDirectory(failed.options); assert.equal(failed.count(), 0);
  const noLog = setup([], true); await assert.rejects(employeeDirectory(noLog.options)); assert.equal(noLog.count(), 0);
});
test('directory denial is logged safely and cannot erase a cached name list', async () => {
  const { options, writes } = setup([{ status: 'success', started_at: '2026-09-24T10:00:00Z', response_xml: xml }]);
  options.fetcher = async () => new Response('<Envelope><Body><GetEmployeesResponse><GetEmployeesResult><ResultCode>4</ResultCode><Message>Denied AccessToken=secret-access</Message></GetEmployeesResult></GetEmployeesResponse></Body></Envelope>');
  const result = await employeeDirectory(options);
  assert.equal(result.employees[0].id, '42'); assert.equal(writes.at(-1).status, 'error');
  assert.ok(!JSON.stringify(writes).includes('secret-access'));
});
