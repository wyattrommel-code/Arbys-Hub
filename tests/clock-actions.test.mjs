import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Run the real route handlers with a synthetic data layer. No live timecards.
const employee = { id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic Crew' };
let openPunch, photo, writes, scheduleReads;
const settings = { require_photo_on_clock_out: true, use_break_punches: true };
const unavailable = () => { scheduleReads++; throw new Error('Schedule is unavailable'); };
const clock = {
  CLOCK_STORE_ID: 'payson',
  parsePin: value => /^\d{4}$/.test(value) ? value : null,
  fetchClockEmployeeByPin: async (_db, pin, id) => pin === '1234' && id === employee.id ? employee : null,
  fetchOpenPunch: async () => openPunch,
  getAttendanceSettings: async () => settings,
  publicSettings: value => value,
  serializeEmployee: value => value,
  serializeShift: value => value,
  fetchPunchSchedules: async () => new Map([[openPunch.id, { unavailable: true }]]),
  fetchTodaysShiftsForEmployee: unavailable,
  fetchRecentPunches: unavailable,
  fetchRecentClockOuts: unavailable,
  canAuthorizeUnscheduled: () => false,
  pickClockInShift: () => null,
  clockEmployeeName: () => employee.name,
  readPhotoFromRequest: async request => { const body = await request.json(); return { pin: body.pin, employeeId: body.employee_id, photo, faceDetected: true }; },
  uploadPunchPhoto: async () => 'https://synthetic.invalid/photo.jpg',
  computePaidWorkedMinutes: () => 480,
};
const db = { from(table) { return {
  update(patch) { writes.push({ table, patch }); return this; },
  eq() { return this; }, select() { return this; },
  async maybeSingle() { return { data: { ...openPunch, ...writes.at(-1).patch } }; },
}; } };
const mocks = {
  'next/headers': { cookies: async () => ({ get: () => ({ value: 'synthetic-device' }) }) },
  'next/server': { after: () => {} },
  '@/lib/security/clock-device': { DEVICE_COOKIE: 'device', hashCredential: () => 'device-hash' },
  '@/lib/offline-clock-crypto': { offlinePinVersion: () => 'version' },
  '@/lib/security/pin-guard': { guardPinAttempt: async () => null },
  '@/lib/security/kiosk': { requireKiosk: async () => null },
  '@/lib/security/http': { secureJson: (value, init) => Response.json(value, init) },
  '@/lib/attendance': { evaluatePunchAndSweep: async () => {} },
  '@/lib/clock': clock,
  '@/lib/break-punches': {
    healOrphanOnBreak: async (_db, value) => value, fetchOpenBreak: async () => null,
    isOnBreak: value => Boolean(value.on_break), serializeOpenBreak: value => value,
    totalBreakMinutes: () => 0,
    startBreakPunch: async () => { writes.push({ action: 'break_start' }); return { id: 'break', break_start: new Date().toISOString() }; },
    endBreakPunch: async () => { writes.push({ action: 'break_end' }); return { id: 'break', break_end: new Date().toISOString() }; },
  },
  '@/lib/roles': { attachEffectiveAccess: async (_db, value) => value },
  '@/lib/supabase-server': { getSupabaseServer: () => db },
};
globalThis.__clockActionMocks = mocks;
registerHooks({
  resolve(specifier, context, next) { return mocks[specifier] ? { url: `clock-test:${specifier}`, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) {
    if (!url.startsWith('clock-test:')) return next(url, context);
    const name = url.slice('clock-test:'.length);
    return { format: 'module', shortCircuit: true, source: `const mock=globalThis.__clockActionMocks[${JSON.stringify(name)}];` + Object.keys(mocks[name]).map(key => `export const ${key}=mock.${key};`).join('\n') };
  },
});
const identify = (await import('../app/api/clock/identify/route.js')).POST;
const clockOut = (await import('../app/api/clock/out/route.js')).POST;
const startBreak = (await import('../app/api/clock/break/start/route.js')).POST;
const endBreak = (await import('../app/api/clock/break/end/route.js')).POST;
const request = (pin = '1234') => new Request('https://synthetic.invalid/api/clock', { method: 'POST', body: JSON.stringify({ pin, employee_id: employee.id }) });
function reset() {
  openPunch = { id: 'punch', employee_id: employee.id, clock_in: '2026-10-08T16:00:00Z', status: 'open', unscheduled: true };
  photo = new Blob(['synthetic photo']); writes = []; scheduleReads = 0;
}

test('an open unscheduled or overnight shift reaches actions even when schedule/history reads fail', async () => {
  reset();
  const response = await identify(request());
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.equal(session.action, 'clock_out');
  assert.equal(session.needsAuthorization, false);
  assert.equal(session.clock_schedule.unavailable, true);
  assert.equal(scheduleReads, 0);
});

test('clock-out, start break and end break do not require a schedule or manager PIN', async () => {
  for (const handler of [clockOut, startBreak, endBreak]) {
    reset();
    const response = await handler(request());
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal(writes.length, 1);
    assert.equal(scheduleReads, 0);
  }
});

test('nonblocking schedule rules retain employee PIN, open-shift and photo requirements', async () => {
  for (const handler of [identify, clockOut, startBreak, endBreak]) {
    reset(); assert.equal((await handler(request('0000'))).status, 401); assert.equal(writes.length, 0);
  }
  for (const handler of [clockOut, startBreak, endBreak]) {
    reset(); openPunch = null; assert.equal((await handler(request())).status, 409); assert.equal(writes.length, 0);
  }
  reset(); photo = null; assert.equal((await clockOut(request())).status, 400); assert.equal(writes.length, 0);
});
