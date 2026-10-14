import { addDaysISO, getStoreToday, storeWallClockToDate, toStoreDateTimeLocal, fromStoreDateTimeLocal } from './store-time';

export const WORK_REASONS = { covering: "Covering someone's shift", extra_hours: 'Extra hours', schedule_issue: 'My schedule is incorrect' };
export const WORK_LABELS = { covering: 'Covered a shift', extra_hours: 'Extra hours', schedule_issue: 'Schedule correction requested' };
export const COVERAGE_OUTCOMES = { unchanged: 'Keep attendance as recorded', approved_swap: 'Approved shift swap', call_out: 'Employee called out' };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function workShiftBounds(shift) {
  const start = storeWallClockToDate(shift.shift_date, shift.scheduled_start);
  const endDay = shift.scheduled_end <= shift.scheduled_start ? addDaysISO(shift.shift_date, 1) : shift.shift_date;
  const end = storeWallClockToDate(endDay, shift.scheduled_end);
  return { start: start?.toISOString(), end: end?.toISOString() };
}
export function coverageChoices(shifts, employeeId, at = new Date()) {
  const now = new Date(at).getTime();
  return (shifts || []).filter(s => {
    const { start, end } = workShiftBounds(s);
    return s.employee_id && s.employee_id !== employeeId && s.published && !s.coverage_taken && !s.owner_clocked_in &&
      now >= Date.parse(start) - 2 * 3600000 && now < Date.parse(end);
  }).sort((a,b) => a.scheduled_start.localeCompare(b.scheduled_start) || a.employee_name.localeCompare(b.employee_name));
}
export function defaultClockWork() { return { reason: '', covered_shift_id: '', start: '', end: '', absence: 'unchanged', note: '' }; }
export function selectCoverage(work, shift, at = new Date()) {
  const bounds = workShiftBounds(shift);
  return { ...work, covered_shift_id: shift.id, start: toStoreDateTimeLocal(new Date(Math.max(Date.parse(bounds.start), new Date(at).getTime())).toISOString()).slice(0,16), end: toStoreDateTimeLocal(bounds.end).slice(0,16) };
}
export function clockWorkRequest(work) {
  if (!Object.hasOwn(WORK_REASONS, work?.reason)) throw new Error('Choose why you are clocking in.');
  const result = { reason: work.reason, note: String(work.note || '').trim().slice(0,500) };
  if (work.reason === 'covering') {
    if (!uuid(work.covered_shift_id)) throw new Error('Choose the shift you are covering.');
    const start = fromStoreDateTimeLocal(work.start), end = fromStoreDateTimeLocal(work.end);
    if (!start || !end || end <= start || end - start > 16 * 3600000) throw new Error('Choose valid coverage hours, up to 16 hours.');
    if (!Object.hasOwn(COVERAGE_OUTCOMES, work.absence)) throw new Error('Choose how to record the original employee’s attendance.');
    Object.assign(result, { covered_shift_id: work.covered_shift_id, expected_start: start.toISOString(), expected_end: end.toISOString(), absence: work.absence });
  }
  return result;
}
export function validateWorkRequest(work) {
  if (!work || typeof work !== 'object' || !Object.hasOwn(WORK_REASONS, work.reason) || typeof work.note !== 'string' || work.note.length > 500) throw new Error('Choose a valid clock-in reason.');
  if (work.reason === 'covering' && (!uuid(work.covered_shift_id) || !Object.hasOwn(COVERAGE_OUTCOMES, work.absence) ||
    !Number.isFinite(Date.parse(work.expected_start)) || !Number.isFinite(Date.parse(work.expected_end)) || Date.parse(work.expected_end) <= Date.parse(work.expected_start) || Date.parse(work.expected_end)-Date.parse(work.expected_start)>16*3600000)) throw new Error('Choose a valid shift and coverage hours.');
  return work;
}
export function approvedClockWork(punch) {
  const work = punch?.work_context;
  return work?.version === 1 && Object.hasOwn(WORK_LABELS, work.reason) && work.approved_by && work.approved_by === punch.authorized_by_id ? work : null;
}
export function workSchedule(work) {
  if (work?.reason !== 'covering' || !work.expected_start || !work.expected_end) return null;
  const start = toStoreDateTimeLocal(work.expected_start), end = toStoreDateTimeLocal(work.expected_end);
  return { shift_date: getStoreToday(new Date(work.expected_start)), scheduled_start: start.slice(11), scheduled_end: end.slice(11) };
}

// Cached own shifts are only a hint; the server rechecks at the captured time.
export function cachedScheduledShift(snapshot, employee, events = [], at = new Date()) {
  const used = new Set([...(snapshot?.used_shift_ids || []), ...events.map(row => row.event?.scheduled_shift_id).filter(Boolean)]);
  return (snapshot?.work_shifts || []).find(s => s.employee_id === employee.id && !used.has(s.id) && (() => {
    const { start, end } = workShiftBounds(s);
    return new Date(at).getTime() >= Date.parse(start)-2*3600000 && new Date(at).getTime()<Date.parse(end);
  })()) || null;
}
