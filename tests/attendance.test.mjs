import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttendanceReport, attendanceRange } from '../lib/attendance-records.js';
import { attendanceRows, loadAttendanceSources } from '../lib/attendance-data.js';
import { rescanAttendance, sweepNoShows, saveGeneratedAttendanceNote } from '../lib/attendance.js';

const employee = { id: 'wyatt', first_name: 'Wyatt', last_name: 'Rommel', is_active: true, jolt_employee_id: 'jolt-wyatt' };
const shift = { id: 'shift', employee_id: 'wyatt', employee_name: 'Wyatt Rommel', shift_date: '2026-10-11', scheduled_start: '09:00:00', scheduled_end: '17:00:00' };
// Regression: actual October 11 times; the imported punch has no shift link.
const punch = { id: 'punch', employee_id: 'wyatt', employee_name: 'Wyatt Rommel', shift_id: null, clock_in: '2026-10-11T15:13:13.521Z', clock_out: '2026-10-11T22:21:00Z', needs_approval: true };
const stale = { id: 'stale', employee_id: 'wyatt', employee_name: 'Wyatt Rommel', event_type: 'no_show', event_date: '2026-10-11', shift_id: 'shift', auto_generated: true, note: null };
const fixture = { employees: [employee], shifts: [shift], punches: [punch], events: [stale], weeks: [{ week_start_date: '2026-10-11', status: 'published' }], from: '2026-10-11', to: '2026-10-12', now: new Date('2026-10-12T21:00:00Z') };
const report = patch => buildAttendanceReport({ ...fixture, ...patch });
const types = result => result.events.map(e => e.event_type);

test('unlinked October 11 punch clears Wyatt no-show even awaiting approval; payroll input stays untouched', () => {
  const before = structuredClone(fixture);
  const result = report();
  assert.deepEqual(types(result), ['late', 'left_early']);
  assert.equal(result.employees[0].records[0].status, 'Worked');
  assert.equal(result.employees[0].records[0].actual[0].label, '9:13 AM – 4:21 PM');
  assert.equal(result.employees[0].completed, 1);
  assert.deepEqual(fixture, before);
});
test('draft and missing weeks cannot create automatic no-shows or unscheduled flags', () => {
  for (const weeks of [[], [{ week_start_date: '2026-10-11', status: 'draft' }]]) {
    assert.deepEqual(types(report({ weeks, punches: [] })), []);
    assert.deepEqual(types(report({ weeks, punches: [{ ...punch, needs_approval: false }] })), []);
  }
});
test('future days, later shifts today and saved future flags are excluded', () => {
  const result = report({ now: new Date('2026-10-11T14:00:00Z'), to: '2026-10-30', punches: [], shifts: [shift, { ...shift, id: 'tomorrow', shift_date: '2026-10-12' }], events: [{ ...stale, event_date: '2026-10-12' }] });
  assert.equal(result.to, '2026-10-11');
  assert.equal(result.employees[0].records.length, 0);
  assert.deepEqual(types(result), []);
});
test('a no-show requires a completed published shift, not a shift still underway', () => {
  assert.deepEqual(types(report({ punches: [], now: new Date('2026-10-11T22:00:00Z') })), []);
  assert.deepEqual(types(report({ punches: [], now: new Date('2026-10-11T23:00:00Z') })), ['no_show']);
});
test('exact employee matching never uses a same-name punch with a different employee ID', () => {
  assert.ok(types(report({ punches: [{ ...punch, employee_id: 'someone-else' }] })).includes('no_show'));
});
test('legacy unique Jolt or full-name identity can match, ambiguous names cannot', () => {
  assert.ok(!types(report({ shifts: [{ ...shift, employee_id: null, jolt_employee_id: 'jolt-wyatt' }] })).includes('no_show'));
  assert.ok(!types(report({ shifts: [{ ...shift, employee_id: null }] })).includes('no_show'));
  const result = report({ employees: [employee, { ...employee, id: 'other' }], shifts: [{ ...shift, employee_id: null }], punches: [] });
  assert.deepEqual(types(result), []);
  assert.ok(result.employees.some(e => e.records.some(r => r.status === 'Check timecard')));
});
test('call-outs suppress absence by shift, with employee/day fallback for legacy call-outs', () => {
  for (const shift_id of ['shift', null]) {
    assert.deepEqual(types(report({ punches: [], events: [{ ...stale, id: 'callout', event_type: 'call_out', shift_id, auto_generated: false }] })), ['call_out']);
  }
});
test('split shifts are independent; an ambiguous spanning punch requests matching instead of guessing', () => {
  const shifts = [{ ...shift, scheduled_end: '12:00:00' }, { ...shift, id: 'second', scheduled_start: '15:00:00' }];
  const one = report({ shifts, punches: [{ ...punch, clock_out: '2026-10-11T18:00:00Z' }] });
  assert.equal(one.events.filter(e => e.event_type === 'no_show').length, 1);
  assert.equal(one.events.find(e => e.event_type === 'no_show').shift_id, 'second');
  const two = report({ shifts });
  assert.deepEqual(types(two), []);
  assert.equal(two.employees[0].records.filter(r => r.ambiguous).length, 3);
  const linked = report({ shifts, punches: [{ ...punch, shift_id: 'shift' }] });
  assert.equal(linked.events.find(e => e.event_type === 'no_show').shift_id, 'second');
});
test('multiple punches in a shift use first arrival and last departure, not intermediate reentry', () => {
  const result = report({ punches: [
    { ...punch, id: 'first', needs_approval: false, clock_in: '2026-10-11T15:00:00Z', clock_out: '2026-10-11T18:00:00Z' },
    { ...punch, id: 'second', needs_approval: false, clock_in: '2026-10-11T18:30:00Z', clock_out: '2026-10-11T23:00:00Z' },
  ] });
  assert.deepEqual(types(result), []);
  assert.equal(result.employees[0].completed, 1);
  assert.equal(result.employees[0].records[0].actual.length, 2);
});
test('overnight and DST transitions use restaurant timestamps', () => {
  const result = report({ from: '2026-10-31', to: '2026-11-01', now: new Date('2026-11-01T12:00:00Z'), weeks: [{ week_start_date: '2026-10-25', status: 'published' }], events: [],
    shifts: [{ ...shift, shift_date: '2026-10-31', scheduled_start: '22:00:00', scheduled_end: '03:00:00' }],
    punches: [{ ...punch, needs_approval: false, clock_in: '2026-11-01T04:00:00Z', clock_out: '2026-11-01T10:00:00Z' }] });
  assert.deepEqual(types(result), []);
  assert.equal(result.employees[0].records[0].actual[0].label, '10:00 PM – 2026-11-01 3:00 AM');
});
test('an old open punch cannot erase a later absence', () => {
  assert.deepEqual(types(report({ punches: [{ ...punch, clock_in: '2026-10-07T15:00:00Z', clock_out: null }] })), ['no_show']);
});
test('a just-recorded open punch matches immediately and an out-of-window linked punch needs inspection', () => {
  assert.ok(!types(report({ now: new Date(punch.clock_in), punches: [{ ...punch, clock_out: null }] })).includes('no_show'));
  const result = report({ punches: [{ ...punch, shift_id: 'shift', clock_in: '2026-10-12T01:00:00Z', clock_out: '2026-10-12T02:00:00Z' }] });
  assert.ok(!types(result).includes('no_show'));
  assert.equal(result.employees[0].records.find(r=>r.shift_id === 'shift').status, 'Check timecard');
});
test('manual absence without a published ended shift is retained as a note, not a counted no-show', () => {
  const result = report({ shifts: [], punches: [], events: [{ ...stale, shift_id: null, auto_generated: false }] });
  assert.deepEqual(types(result), []);
  assert.ok(result.employees[0].records[0].notes.length);
});
test('obsolete automatic notes and conflicting manual entries remain readable without false counts', () => {
  for (const auto_generated of [true, false]) {
    const result = report({ events: [{ ...stale, auto_generated, note: 'Manager historical note' }] });
    assert.ok(!types(result).includes('no_show'));
    assert.equal(result.employees[0].records[0].notes[0].note, 'Manager historical note');
  }
});
test('genuine late/early flags survive and duplicate manual flags count once', () => {
  const result = report({ punches: [{ ...punch, needs_approval: false }], events: [{ ...stale, event_type: 'late', auto_generated: false, punch_id: punch.id, note: 'Traffic' }] });
  assert.deepEqual(types(result), ['late', 'left_early']);
  assert.equal(result.employees[0].counts.late, 1);
  assert.equal(result.events[0].note, 'Traffic');
});
test('zero-flag employees are shown; inactive employees appear when they have history', () => {
  const result = report({ employees: [{ ...employee, is_active: false }, { id: 'active', first_name: 'Active', is_active: true }, { id: 'inactive', first_name: 'Inactive', is_active: false }] });
  assert.equal(result.employees.length, 2);
  assert.equal(result.employees.find(e => e.id === 'active').records.length, 0);
});
test('date bounds reject invalid, future-only and excessive requests', () => {
  assert.throws(() => attendanceRange('2026-02-30', '2026-10-12', fixture.now));
  assert.throws(() => attendanceRange('2026-10-13', '2026-10-15', fixture.now));
  assert.throws(() => attendanceRange('2024-01-01', '2026-10-12', fixture.now));
});
test('pagination reads beyond 1000 rows and propagates errors', async () => {
  const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
  assert.equal((await attendanceRows(() => ({ order() { return this; }, range(a,b) { return Promise.resolve({ data: rows.slice(a, b + 1) }); } }))).length, 1201);
  await assert.rejects(attendanceRows(() => ({ order() { return this; }, range() { return Promise.resolve({ error: new Error('failed') }); } })), /failed/);
});

// A small Supabase fake exercises the production loader and reconciliation writes.
function database() {
  const data = { employees: [{ ...employee, store_id: '07462' }], schedule_shifts: [{ ...shift, store_id: 'payson' }], time_punches: [{ ...punch, store_id: 'payson' }],
    schedule_weeks: [{ week_start_date: '2026-10-11', status: 'published', store_id: 'payson' }], attendance_events: [{ ...stale, store_id: 'payson' }], attendance_settings: [] };
  const writes = [];
  const db = { data, writes, from(table) {
    const filters = []; let op = 'select', payload, single = false, start = 0, end = Infinity;
    const q = { select() { return q; }, order() { return q; }, limit(n) { end = n - 1; return q; }, maybeSingle() { single = true; return q; }, single() { single = true; return q; },
      range(a,b) { start=a; end=b; return q; }, eq(k,v) { filters.push(r=>r[k]===v); return q; }, is(k,v) { return q.eq(k,v); },
      gte(k,v) { filters.push(r=>r[k]>=v); return q; }, lte(k,v) { filters.push(r=>r[k]<=v); return q; }, lt(k,v) { filters.push(r=>r[k]<v); return q; },
      or(value) { const cutoff=value.split('clock_out.gte.')[1].split(',')[0]; filters.push(r=>r.clock_out == null || r.clock_out >= cutoff); return q; },
      update(v) { op='update'; payload=v; return q; }, insert(v) { op='insert'; payload=v; return q; }, delete() { op='delete'; return q; },
      then(resolve,reject) { try { const selected=data[table].filter(r=>filters.every(f=>f(r))).slice(start,end+1);
        if(op!=='select') { writes.push({ table, op, payload }); if(op==='delete') data[table]=data[table].filter(r=>!selected.includes(r)); if(op==='update') selected.forEach(r=>Object.assign(r,payload)); if(op==='insert') data[table].push({id:`new-${writes.length}`,note:null,...payload}); }
        return Promise.resolve({data:op==='insert'&&single?data[table].at(-1):single?(selected[0]||null):selected,error:null}).then(resolve,reject);
      } catch(error) { return Promise.reject(error).then(resolve,reject); } }
    }; return q;
  } }; return db;
}
test('production loader and rescan remove a stale no-show without touching payroll or manual notes', async () => {
  const db = database();
  db.data.attendance_events.push({ ...stale, id: 'noted', note: 'Keep me', store_id: 'payson' }, { ...stale, id: 'manual', auto_generated: false, store_id: 'payson' });
  const sources = await loadAttendanceSources(db, '2026-10-11', '2026-10-12', fixture.now);
  assert.equal(sources.punches.length, 1);
  assert.equal(sources.weeks[0].status, 'published');
  await rescanAttendance(db, '2026-10-11', '2026-10-12');
  assert.ok(!db.data.attendance_events.some(e=>e.id==='stale'));
  assert.ok(db.data.attendance_events.some(e=>e.id==='noted' && e.note==='Keep me'));
  assert.ok(db.data.attendance_events.some(e=>e.id==='manual' && !e.auto_generated));
  assert.ok(db.writes.every(w=>w.table==='attendance_events'));
  assert.equal((await sweepNoShows(db, '2026-10-11', '2026-10-12', {now:fixture.now})).created, 0);
  const writes = db.writes.length;
  await rescanAttendance(db, '2026-10-11', '2026-10-12');
  assert.equal(db.writes.length, writes, 'An unchanged scan must not rewrite attendance records.');
});
test('notes on derived flags remain automatic, and stale flag note creation is rejected', async () => {
  const db = database();
  const id = await saveGeneratedAttendanceNote(db, { event_date:'2026-10-11', event_type:'late', employee_id:'wyatt', shift_id:'shift', punch_id:'punch', note:'Traffic' });
  assert.equal(db.data.attendance_events.find(e=>e.id===id).auto_generated, true);
  assert.equal(db.data.attendance_events.find(e=>e.id===id).note, 'Traffic');
  await assert.rejects(saveGeneratedAttendanceNote(db, { event_date:'2026-10-11', event_type:'no_show', employee_id:'wyatt', shift_id:'shift', note:'Stale flag' }), /has changed/);
  db.data.time_punches[0].clock_in = '2026-10-11T15:00:00Z';
  const result = buildAttendanceReport({ ...fixture, punches: db.data.time_punches, events: db.data.attendance_events });
  assert.ok(!types(result).includes('late'));
  assert.ok(result.employees[0].records[0].notes.some(n=>n.note==='Traffic'));
});
