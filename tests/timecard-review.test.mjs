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
