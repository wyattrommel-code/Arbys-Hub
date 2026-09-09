import test from 'node:test';
import assert from 'node:assert/strict';
import { payPeriodFor, filterTimecardGroups } from '../lib/timecard-review.js';

test('Payson fortnight boundaries match the observed Jolt pay periods', () => {
  assert.deepEqual(payPeriodFor('2026-09-09'), { from: '2026-08-30', to: '2026-09-12' });
  assert.deepEqual(payPeriodFor('2026-09-12'), { from: '2026-08-30', to: '2026-09-12' });
  assert.deepEqual(payPeriodFor('2026-09-13'), { from: '2026-09-13', to: '2026-09-26' });
  assert.deepEqual(payPeriodFor('2026-08-29'), { from: '2026-08-16', to: '2026-08-29' });
});
test('review filters do not alter payroll groups or totals', () => {
  const groups = [{ key: 'a', name: 'Sample Employee', totalDisplay: '8.50', punches: [{ id: 1, open: true }, { id: 2, edited: true }] }];
  const selected = filterTimecardGroups(groups, 'sample', 'open');
  assert.equal(selected[0].punches.length, 1);
  assert.equal(selected[0].totalDisplay, '8.50');
  assert.equal(groups[0].punches.length, 2);
  assert.equal(filterTimecardGroups(groups, 'unknown', 'all').length, 0);
  assert.equal(filterTimecardGroups(groups, '', 'edited')[0].punches[0].id, 2);
});

import { timecardReview } from '../lib/timecard-approval.js';
import { groupTimecards, buildPayrollCsv, serializeTimecardPunch } from '../lib/timecards.js';
const settings = { grace_minutes_early_in: 10, grace_minutes_late: 10, grace_minutes_early_out: 10 };
const shift = { id: 'shift', shift_date: '2026-09-09', scheduled_start: '10:00:00', scheduled_end: '16:00:00' };
const punch = { id: 'punch', employee_id: 'employee', employee_name: 'Synthetic', clock_in: '2026-09-09T16:00:00Z', clock_out: '2026-09-09T22:00:00Z', worked_minutes: 360, breaks: [], break_minutes: 0, open: false };
const review = (p = punch, s = shift, approvals = []) => timecardReview(p, s, settings, approvals);
test('schedule boundaries, grace windows and overnight shifts', () => {
  assert.equal(review().payroll_ready, true);
  assert.deepEqual(review({ ...punch, clock_in: '2026-09-09T15:50:00Z', clock_out: '2026-09-09T22:10:00Z' }).review_flags, []);
  assert.deepEqual(review({ ...punch, clock_in: '2026-09-09T15:49:59Z', clock_out: '2026-09-09T22:10:01Z' }).review_flags, ['Early clock-in', 'Late clock-out']);
  assert.deepEqual(review({ ...punch, clock_in: '2026-09-09T16:10:01Z', clock_out: '2026-09-09T21:49:59Z' }).review_flags, ['Late clock-in', 'Early clock-out']);
  assert.equal(review({ ...punch, clock_in: '2026-09-10T04:00:00Z', clock_out: '2026-09-10T08:00:00Z' }, { ...shift, scheduled_start: '22:00:00', scheduled_end: '02:00:00' }).payroll_ready, true);
});
test('approval applies to exactly the reviewed record and invalidates on changes', () => {
  const p = { ...punch, unscheduled: true };
  const before = review(p);
  assert.equal(before.payroll_ready, false);
  const approvals = [{ punch_id: p.id, snapshot_hash: before.review_version, approved_by_name: 'Synthetic Manager' }];
  assert.equal(review(p, shift, approvals).payroll_ready, true);
  for (const changed of [{ clock_out: '2026-09-09T22:30:00Z' }, { worked_minutes: 330 }, { breaks: [{ id: 'b', minutes: 30 }] }, { edited: true, status: 'edited' }]) {
    assert.equal(review({ ...p, ...changed }, shift, approvals).pending_approval, true);
  }
  assert.equal(review(p, { ...shift, scheduled_end: '17:00:00' }, approvals).pending_approval, true);
  assert.equal(review({ ...p, open: true, clock_out: null }, shift, approvals).payroll_ready, false);
  assert.equal(review({ ...p, on_break: true }, shift, approvals).payroll_ready, false);
  assert.equal(review(p, null, approvals).pending_approval, true);
});
test('pending hours remain recorded and block the entire payroll export', () => {
  const pending = { ...punch, ...review(punch, null) };
  const cleared = { ...punch, id: 'second', ...review() };
  const grouped = groupTimecards([pending, cleared]);
  assert.equal(grouped.grandDisplay, '12.00');
  assert.equal(grouped.approvedDisplay, '6.00');
  assert.equal(grouped.pendingDisplay, '6.00');
  assert.throws(() => buildPayrollCsv(grouped, '2026-09-09', '2026-09-09'), /review/);
  assert.match(buildPayrollCsv(groupTimecards([cleared]), '2026-09-09', '2026-09-09'), /PERIOD TOTAL/);
  assert.equal(serializeTimecardPunch({ ...punch, worked_minutes: null }, shift).worked_minutes, 360);
});
