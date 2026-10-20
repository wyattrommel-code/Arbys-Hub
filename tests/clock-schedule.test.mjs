import test from 'node:test';
import assert from 'node:assert/strict';
import { clockActionScheduleFlag, clockActionScheduleNotice } from '../lib/clock-schedule.js';
import { fetchPunchSchedules, publicSettings } from '../lib/clock.js';
import { offlineActions, projectRoster } from '../lib/offline-clock.js';
import { timecardReview } from '../lib/timecard-approval.js';

const shift = { id: 'shift', shift_date: '2026-10-09', scheduled_start: '10:00:00', scheduled_end: '16:00:00' };
const settings = { grace_minutes_early_out: 10, grace_minutes_early_in: 10, grace_minutes_late: 10 };
const context = { shift, unscheduled: false };
const flag = (action, at, schedule = context) => clockActionScheduleFlag(action, schedule, settings, at);

test('clock-out warnings match the Hub review grace period, including overnight shifts', () => {
  assert.equal(flag('clock_out', '2026-10-09T21:49:59Z'), 'Early clock-out');
  assert.equal(flag('clock_out', '2026-10-09T21:50:00Z'), null);
  assert.equal(flag('clock_out', '2026-10-09T22:10:00Z'), null);
  assert.equal(flag('clock_out', '2026-10-09T22:10:01Z'), 'Late clock-out');
  const overnight = { shift: { ...shift, scheduled_start: '22:00:00', scheduled_end: '02:00:00' } };
  assert.equal(flag('clock_out', '2026-10-10T08:00:00Z', overnight), null);
  assert.equal(flag('clock_out', '2026-10-10T07:00:00Z', overnight), 'Early clock-out');
  assert.equal(flag('break_start', '2026-10-10T06:00:00Z', overnight), null);
  assert.equal(flag('break_start', '2026-10-10T09:00:00Z', overnight), 'Break outside scheduled hours');
  assert.equal(publicSettings(settings).grace_minutes_early_out, 10);
});

test('breaks are allowed at any point in a shift; out-of-schedule breaks receive review flags', () => {
  for (const action of ['break_start', 'break_end']) {
    assert.equal(flag(action, '2026-10-09T20:00:00Z'), null);
    assert.equal(flag(action, '2026-10-09T15:59:59Z'), 'Break outside scheduled hours');
    assert.equal(flag(action, '2026-10-09T22:00:01Z'), 'Break outside scheduled hours');
    assert.match(clockActionScheduleNotice(action, context, settings, '2026-10-09T23:00:00Z'), /You can continue; your manager will be notified in the Hub/);
  }
  const punch = { id: 'punch', clock_in: '2026-10-09T16:00:00Z', clock_out: '2026-10-09T22:05:00Z', breaks: [] };
  assert.deepEqual(timecardReview(punch, shift, settings).review_flags, []);
  const outside = { ...punch, breaks: [{ id: 'b', start: '2026-10-09T21:45:00Z', end: '2026-10-09T22:02:00Z' }] };
  const review = timecardReview(outside, shift, settings);
  assert.deepEqual(review.review_flags, ['Break outside scheduled hours']);
  assert.equal(review.pending_approval, true);
  assert.equal(timecardReview(outside, shift, settings, [{ punch_id: punch.id, snapshot_hash: review.review_version }]).pending_approval, false);
  assert.deepEqual(timecardReview({ ...punch, breaks: [{ start: '2026-10-09T20:00:00Z', end: null, open: true }] }, shift, settings).review_flags, []);
});

test('offline and unscheduled open shifts retain clock-out and break actions', () => {
  for (const clock_schedule of [context, { unscheduled: true }, { unavailable: true }, null]) {
    assert.deepEqual(offlineActions({ clocked_in: true, clock_schedule }), ['clock_out', 'forgot_clock_out', 'break_start', 'forgot_break_start']);
  }
  assert.match(clockActionScheduleNotice('clock_out', { unscheduled: true }, settings, new Date(), true), /when this iPad reconnects/);
  assert.match(clockActionScheduleNotice('break_start', null, settings, new Date(), true), /You can continue/);
  assert.equal(clockActionScheduleNotice('clock_in', { unscheduled: true }, settings), null);
  assert.equal(clockActionScheduleNotice('forgot_clock_out', context, settings), null);
  assert.equal(flag('clock_out', new Date(), { shift: { ...shift, shift_date: 'invalid' } }), null);
  const roster = projectRoster({ employees: [{ id: 'employee', clock_schedule: context }] }, [{ sequence: 1, event: { employee_id: 'employee', id: 'event', kind: 'clock_in', occurred_at: '2026-10-10T16:00:00Z' } }]);
  assert.equal(roster[0].clock_schedule, null, 'A new offline shift must not inherit an old schedule');
});

test('linked schedules are optional and can belong to an earlier day', async () => {
  const punches = [{ id: 'punch', shift_id: shift.id }, { id: 'unscheduled', unscheduled: true }];
  const calls = [];
  const db = { from(table) { calls.push(table); return {
    select() { return this; }, eq(key, value) { calls.push([key, value]); return this; },
    async in(key, ids) { calls.push([key, ids]); return { data: [shift] }; },
  }; } };
  const schedules = await fetchPunchSchedules(db, punches);
  assert.deepEqual(schedules.get('punch').shift, shift);
  assert.equal(schedules.get('unscheduled').unscheduled, true);
  assert.deepEqual(calls, ['schedule_shifts', ['store_id', 'payson'], ['id', [shift.id]]]);
  const unavailable = await fetchPunchSchedules({ from() { throw new Error('Schedule unavailable'); } }, punches);
  assert.equal(unavailable.get('punch').unavailable, true);
  assert.equal(unavailable.get('unscheduled').unscheduled, true);
  assert.match(clockActionScheduleNotice('clock_out', unavailable.get('punch'), settings), /You can continue/);
});
