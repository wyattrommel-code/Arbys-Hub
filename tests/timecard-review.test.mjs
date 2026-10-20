import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

function offlineFixture() {
  const times = { clock_in: punch.clock_in, break_start: '2026-09-09T18:00:00Z', break_end: '2026-09-09T18:30:00Z', clock_out: punch.clock_out };
  const receipts = Object.entries(times).map(([kind, time]) => ({
    id: kind, punch_id: punch.id, employee_id: punch.employee_id, status: 'applied', issue: null,
    event: { kind, employee_id: punch.employee_id, occurred_at: time, captured_at: time },
    photo_url: `https://synthetic.invalid/${kind}.jpg`, occurred_at: time, captured_at: time,
  }));
  const corrections = receipts.map(r => ({
    id: r.id, time_punch_id: punch.id, source: 'offline', correction_type: `forgot_${r.event.kind}`,
    claimed_time: r.occurred_at, photo_captured_at: r.captured_at, photo_url: r.photo_url,
  }));
  return { receipts, card: { ...punch, worked_minutes: 330, break_minutes: 30,
    breaks: [{ id: 'break', start: times.break_start, end: times.break_end, minutes: 30, open: false }], corrections } };
}

test('validated offline clock and break punches clear without a manager and export unchanged hours', () => {
  const { card, receipts } = offlineFixture();
  const result = timecardReview(card, shift, settings, [], receipts);
  assert.deepEqual(result.review_flags, []);
  assert.equal(result.pending_approval, false);
  assert.equal(result.payroll_ready, true);
  assert.equal(result.approval, null); // Automatic eligibility is not a fabricated manager approval.
  assert.deepEqual(result.review_snapshot.corrections, card.corrections);
  const grouped = groupTimecards([{ ...card, ...result }]);
  assert.equal(grouped.approvedDisplay, '5.50');
  assert.equal(grouped.pendingDisplay, '0.00');
  assert.match(buildPayrollCsv(grouped, '2026-09-09', '2026-09-09'), /PERIOD TOTAL/);
  // A shift may combine normal online punches and a single offline action.
  for (const receipt of receipts) {
    assert.equal(timecardReview({ ...card, corrections: card.corrections.filter(c => c.id === receipt.id) }, shift, settings, [], [receipt]).payroll_ready, true);
  }
});

test('missing, held, mismatched and missed offline punches still require review', () => {
  const { card, receipts } = offlineFixture();
  assert.equal(timecardReview(card, shift, settings).pending_approval, true);
  assert.equal(timecardReview(card, shift, settings, [], receipts.slice(1)).pending_approval, true);
  for (const patch of [
    { status: 'review' }, { issue: 'PIN did not match' }, { punch_id: 'other' }, { employee_id: 'other' },
    { photo_url: 'https://synthetic.invalid/other.jpg' }, { occurred_at: punch.clock_out },
    { captured_at: punch.clock_out }, { event: null },
    { event: { ...receipts[0].event, employee_id: 'other' } },
    { event: { ...receipts[0].event, occurred_at: 'invalid' } },
  ]) {
    assert.equal(timecardReview(card, shift, settings, [], [{ ...receipts[0], ...patch }, ...receipts.slice(1)]).pending_approval, true, JSON.stringify(patch));
  }
  for (let i = 0; i < receipts.length; i++) {
    const missed = receipts.map((r, n) => n === i ? { ...r, event: { ...r.event, kind: `forgot_${r.event.kind}` } } : r);
    assert.equal(timecardReview(card, shift, settings, [], missed).pending_approval, true);
  }
  const noPhoto = { ...card, corrections: card.corrections.map(c => ({ ...c, photo_url: null })) };
  assert.equal(timecardReview(noPhoto, shift, settings, [], receipts).pending_approval, true);
});

test('offline exemption preserves schedule, correction, edit and incomplete-shift safeguards', () => {
  const { card, receipts } = offlineFixture();
  for (const patch of [
    { unscheduled: true }, { clock_in: '2026-09-09T15:00:00Z' }, { clock_out: '2026-09-09T23:00:00Z' },
    { edited: true, status: 'edited' }, { corrections: [...card.corrections, { id: 'online-correction' }] },
    { breaks: [{ id: 'b', start: '2026-09-09T15:00:00Z', end: '2026-09-09T15:30:00Z' }] },
  ]) {
    const result = timecardReview({ ...card, ...patch }, shift, settings, [], receipts);
    assert.equal(result.pending_approval, true);
    assert.equal(result.payroll_ready, false);
    assert.equal(result.review_flags.includes('Offline punch'), false);
  }
  for (const patch of [{ open: true, clock_out: null }, { on_break: true }, { breaks: [{ id: 'b', open: true }] }]) {
    assert.equal(timecardReview({ ...card, ...patch }, shift, settings, [], receipts).payroll_ready, false);
  }
});

test('existing offline approvals survive removal of only the offline flag, but not later changes', () => {
  const { card, receipts } = offlineFixture();
  const flagged = { ...card, unscheduled: true, edited: true, status: 'edited' };
  const before = timecardReview(flagged, shift, settings); // Original flags, without validated receipts.
  assert.deepEqual(before.review_flags, ['Unscheduled shift', 'Offline punch', 'Edited punch']);
  const hash = createHash('sha256').update(JSON.stringify(before.review_snapshot)).digest('hex');
  const approvals = [{ punch_id: card.id, snapshot_hash: hash, approved_by_name: 'Synthetic Manager' }];
  const after = timecardReview(flagged, shift, settings, approvals, receipts);
  assert.deepEqual(after.review_flags, ['Unscheduled shift', 'Edited punch']);
  assert.equal(after.approval, approvals[0]);
  assert.equal(after.payroll_ready, true);
  for (const patch of [{ worked_minutes: 320 }, { edit_revision: 1 }, { clock_out: '2026-09-09T22:01:00Z' },
    { breaks: [{ ...card.breaks[0], minutes: 40 }] }, { corrections: [...card.corrections, { id: 'new' }] }]) {
    assert.equal(timecardReview({ ...flagged, ...patch }, shift, settings, approvals, receipts).pending_approval, true);
  }
  assert.equal(timecardReview(flagged, { ...shift, scheduled_end: '17:00:00' }, settings, approvals, receipts).pending_approval, true);
  assert.equal(timecardReview(flagged, shift, { ...settings, grace_minutes_late: 15 }, approvals, receipts).pending_approval, true);
});
