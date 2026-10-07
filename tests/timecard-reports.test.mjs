import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimecardReport, buildTimecardReportCsv, validateReportRange } from '../lib/timecard-reports.js';
import { serializeTimecardPunch } from '../lib/timecards.js';

function card(id, date, minutes, extra = {}) {
  const start = `${date}T14:00:00Z`;
  return { ...serializeTimecardPunch({ id, employee_id: 'a', employee_name: 'Sample Employee', clock_in: start,
    clock_out: new Date(Date.parse(start) + minutes * 60000).toISOString(), worked_minutes: minutes, ...extra }, null),
    payroll_ready: true, ...extra };
}
test('overtime resets each week, not at an 80-hour pay-period threshold', () => {
  const cards = [0,1,2,3,4].map((n) => card(`a${n}`, `2026-09-${13+n}`, 540));
  cards.push(card('next', '2026-09-20', 300));
  cards.push(card('b', '2026-09-18', 600, { employee_id: 'b', employee_name: 'Other Employee' }));
  const report = buildTimecardReport(cards, '2026-09-13', '2026-09-26');
  assert.equal(report.groups.find((g) => g.key === 'a').overtime_minutes, 300);
  assert.equal(report.totals.regular_minutes, 3300);
  assert.equal(report.totals.worked_minutes, 3600);
  assert.equal(report.totals.regular_minutes + report.totals.overtime_minutes, report.totals.worked_minutes);
});
test('partial week carries earlier hours without exporting those earlier shifts', () => {
  const cards = [0,1,2,3,4].map((n) => card(`p${n}`, `2026-09-${13+n}`, 540));
  const report = buildTimecardReport(cards, '2026-09-17', '2026-09-17');
  assert.equal(report.punches.length, 1);
  assert.equal(report.totals.regular_minutes, 240);
  assert.equal(report.totals.overtime_minutes, 300);
  cards[0].payroll_ready = false;
  assert.throws(() => buildTimecardReportCsv(buildTimecardReport(cards, '2026-09-17', '2026-09-17'), 'summary'), /earlier punches/);
  assert.equal(buildTimecardReport([...cards, card('other', '2026-09-20', 60)], '2026-09-20', '2026-09-20').blocked, false);
  const staleOpen = card('open', '2026-09-05', 0, { open:true, clock_out:null, payroll_ready:false });
  assert.equal(buildTimecardReport([staleOpen, card('worked', '2026-09-20', 60)], '2026-09-20', '2026-09-20').blocked, true);
});
test('Sunday boundary divides overnight work and breaks in restaurant time', () => {
  const cards = [0,1,2,3].map((n) => card(`p${n}`, `2026-09-${13+n}`, 585)); // 39 hours
  cards.push(card('overnight', '2026-09-19', 210, {
    clock_in: '2026-09-20T04:00:00Z', clock_out: '2026-09-20T08:00:00Z',
    break_minutes: 30, breaks: [{ start: '2026-09-20T05:00:00Z', end: '2026-09-20T05:30:00Z', minutes: 30, open: false }],
  }));
  const report = buildTimecardReport(cards, '2026-09-19', '2026-09-19');
  assert.equal(report.totals.overtime_minutes, 30);
  assert.equal(report.totals.regular_minutes, 180);
});
test('DST fall-back overnight shift preserves actual elapsed paid minutes', () => {
  const p = card('dst', '2026-10-31', 360, { clock_in: '2026-11-01T04:00:00Z', clock_out: '2026-11-01T10:00:00Z' });
  const report = buildTimecardReport([p], '2026-10-31', '2026-10-31');
  assert.equal(report.totals.regular_minutes, 360);
  assert.equal(report.totals.overtime_minutes, 0);
});
test('every export refuses pending or incomplete work, including an open break', () => {
  for (const change of [{ payroll_ready: false }, { open: true, clock_out: null }, { on_break: true }, { breaks: [{ open: true }] }]) {
    const report = buildTimecardReport([card('p', '2026-09-14', 60, change)], '2026-09-14', '2026-09-14');
    for (const type of ['summary', 'punches']) assert.throws(() => buildTimecardReportCsv(report, type), /Close and approve/);
  }
});
test('detail export contains each break once and safely quotes names', () => {
  const p = card('p', '2026-09-14', 450, { employee_name: 'Doe, "Jamie"', break_minutes: 45,
    breaks: [{ start:'2026-09-14T18:00:00Z', end:'2026-09-14T18:30:00Z', minutes:30 },
      { start:'2026-09-14T20:00:00Z', end:'2026-09-14T20:15:00Z', minutes:15 }] });
  const report = buildTimecardReport([p], '2026-09-14', '2026-09-14');
  const csv = buildTimecardReportCsv(report, 'punches');
  assert.match(csv, /Break 1 Start,Break 1 End,Break 1 Minutes,Break 2 Start,Break 2 End,Break 2 Minutes/);
  assert.match(csv, /"Doe, ""Jamie"""/);
  assert.match(csv, /2026-09-14 12:00:00,2026-09-14 12:30:00,30/);
  assert.match(csv, /7.50,0.00,7.50,2,0.75,45/);
  assert.equal(report.totals.break_count, 2);
});
test('summary neutralizes spreadsheet formulas and contains a period total', () => {
  const report = buildTimecardReport([card('p', '2026-09-14', 60, { employee_name: '=HYPERLINK("x")' })], '2026-09-14', '2026-09-14');
  const csv = buildTimecardReportCsv(report, 'summary');
  assert.ok(csv.startsWith('\uFEFFEmployee,'));
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /PERIOD TOTAL,1,0,1.00,0.00,1.00/);
});
test('historical rates apply by shift date; missing is not a zero-dollar rate', () => {
  const cards = [card('p1', '2026-09-14', 60), card('p2', '2026-09-15', 60)];
  const wages = [{ id:'1', employee_id:'a', hourly_rate:10, effective_date:'2026-09-01' },
    { id:'2', employee_id:'a', hourly_rate:12, effective_date:'2026-09-15' }];
  const report = buildTimecardReport(cards, '2026-09-14', '2026-09-15', { wages });
  assert.equal(report.totals.regular_pay_cents, 2200);
  assert.match(buildTimecardReportCsv(report, 'summary'), /Estimated Regular Pay/);
  assert.match(buildTimecardReportCsv(report, 'summary'), /22.00,0.00,22.00/);
  assert.match(buildTimecardReportCsv(buildTimecardReport(cards, '2026-09-14', '2026-09-15', { wages: [] }), 'summary'), /Rate missing/);
  assert.doesNotMatch(buildTimecardReportCsv(buildTimecardReport(cards, '2026-09-14', '2026-09-15'), 'summary'), /Pay|Rate missing/);
});
test('overtime pay uses time-and-a-half without rounding hours first', () => {
  const cards = [0,1,2,3,4].map((n) => card(`p${n}`, `2026-09-${13+n}`, 481));
  const wages = [{ id:'w', employee_id:'a', hourly_rate:15, effective_date:'2026-01-01' }];
  const report = buildTimecardReport(cards, '2026-09-13', '2026-09-19', { wages });
  assert.equal(report.totals.overtime_minutes, 5);
  assert.equal(report.totals.overtime_pay_cents, 188);
});
test('empty ranges export headers and zero totals; impossible dates are rejected', () => {
  assert.match(buildTimecardReportCsv(buildTimecardReport([], '2026-09-13', '2026-09-19'), 'summary'), /PERIOD TOTAL,0,0,0.00/);
  for (const range of [['2026-02-30','2026-03-01'], ['2026-10-01','2026-09-01'], ['', '2026-09-01'], ['2026-9-1','2026-09-30']]) assert.throws(() => validateReportRange(...range));
});
