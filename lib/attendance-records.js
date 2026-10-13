import { addDaysISO, getStoreToday, storeWallClockToDate, formatStoreTime } from './store-time';
import { formatClock, isUnassignedShift, weekStartSunday } from './schedule';

export const ATTENDANCE_LABELS = {
  late: 'Late', clock_in_early: 'Clocked in early', left_early: 'Left early',
  no_show: 'No show', call_out: 'Call-out', unscheduled: 'Unscheduled',
};
const normalType = type => type === 'early_out' ? 'left_early' : type;
const nameKey = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const timestamp = value => value ? new Date(value).getTime() : NaN;

export function attendanceRange(from, to, now = new Date()) {
  const today = getStoreToday(now);
  from ||= addDaysISO(today, -29);
  to ||= today;
  for (const value of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Choose valid attendance dates.');
  }
  to = to > today ? today : to;
  if (from > to) throw new Error('Choose a start date on or before the end date and today.');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365) throw new Error('Choose a range of one year or less.');
  return { from, to, today };
}

export function shiftInterval(shift) {
  const start = storeWallClockToDate(shift.shift_date, shift.scheduled_start)?.getTime();
  const endDate = shift.scheduled_end <= shift.scheduled_start ? addDaysISO(shift.shift_date, 1) : shift.shift_date;
  const end = storeWallClockToDate(endDate, shift.scheduled_end)?.getTime();
  return { start, end };
}

// IDs take precedence. Legacy rows may use a unique exact Jolt ID or full name;
// a shared last name must never make one employee's punch clear another's shift.
function identityResolver(employees) {
  return row => {
    if (row.employee_id) return String(row.employee_id);
    const byJolt = row.jolt_employee_id ? employees.filter(e => e.jolt_employee_id === row.jolt_employee_id) : [];
    if (byJolt.length === 1) return String(byJolt[0].id);
    const name = nameKey(row.employee_name);
    const byName = name ? employees.filter(e => nameKey(`${e.first_name || ''} ${e.last_name || ''}`) === name) : [];
    return byName.length === 1 ? String(byName[0].id) : null;
  };
}

export function attendanceEventKey(event) {
  return `${normalType(event.event_type)}:${event.shift_id || event.punch_id || `${event.employee_id}:${event.event_date}`}`;
}

/** Read-only attendance projection. Never relinks or edits payroll punches. */
export function buildAttendanceReport({ employees = [], shifts = [], punches = [], weeks = [], events = [], settings = {}, from, to, now = new Date() }) {
  now = new Date(now);
  const range = attendanceRange(from, to, now);
  const nowMs = now.getTime();
  const inRange = date => date >= range.from && date <= range.to;
  const identify = identityResolver(employees);
  const weekMap = new Map(weeks.map(w => [w.week_start_date, w.status]));
  const published = date => weekMap.get(weekStartSunday(date)) === 'published';
  const roster = new Map(employees.map(e => [String(e.id), { id: String(e.id), name: `${e.first_name || ''} ${e.last_name || ''}`.trim(), active: e.is_active !== false }]));
  const usablePunches = punches.filter(p => Number.isFinite(timestamp(p.clock_in)) && timestamp(p.clock_in) <= nowMs);
  const candidates = shifts.filter(s => !isUnassignedShift(s)).map(s => ({ ...s, ...shiftInterval(s), employee_key: identify(s), punches: [], ambiguous: [] }));
  const matched = new Set();
  const ambiguous = new Set();
  for (const punch of usablePunches) {
    const employeeId = identify(punch);
    if (!employeeId) continue;
    const start = timestamp(punch.clock_in);
    // An unclosed old punch is not evidence of attendance on every later day.
    const end = punch.clock_out ? timestamp(punch.clock_out) : Math.min(nowMs, start + 24 * 3600000);
    const overlaps = candidates.filter(s => s.employee_key === employeeId && start < s.end && (end > s.start || (end === start && start >= s.start)));
    const linked = candidates.find(s => s.id === punch.shift_id && s.employee_key === employeeId);
    // A link with no time overlap needs inspection, rather than a false absence.
    if (linked && !overlaps.includes(linked)) linked.ambiguous.push(punch.id);
    const explicit = overlaps.find(s => s.id === punch.shift_id);
    const matches = explicit ? [explicit] : overlaps;
    if (matches.length === 1) {
      matches[0].punches.push(punch);
      matched.add(punch.id);
    } else if (matches.length > 1) {
      matches.forEach(s => s.ambiguous.push(punch.id));
      ambiguous.add(punch.id);
    }
  }

  const records = [];
  const autoEvents = [];
  const makeRecord = (id, employeeId, name, date, shift, recordPunches, status) => {
    const ordered = [...recordPunches].sort((a, b) => timestamp(a.clock_in) - timestamp(b.clock_in));
    const actual = ordered.map(p => {
      const out = p.clock_out && timestamp(p.clock_out) <= nowMs ? p.clock_out : null;
      const outDay = out ? getStoreToday(new Date(out)) : null;
      return { id: p.id, clock_in: p.clock_in, clock_out: out,
        label: `${formatStoreTime(p.clock_in)} – ${out ? `${outDay !== getStoreToday(new Date(p.clock_in)) ? `${outDay} ` : ''}${formatStoreTime(out)}` : 'Still clocked in'}` };
    });
    return { id, employee_id: employeeId, employee_name: name || roster.get(employeeId)?.name || 'Unknown employee', date,
      shift_id: shift?.id || null, scheduled_label: shift ? `${formatClock(shift.scheduled_start)} – ${formatClock(shift.scheduled_end)}` : 'No matching shift',
      schedule_state: weekMap.get(weekStartSunday(date)) || 'missing', role: shift?.role || '', actual, status, flags: [], notes: [],
      completed: actual.length > 0 && actual.every(p => p.clock_out), ambiguous: false };
  };
  const addAuto = (record, type, punchId = null, minutes = null) => {
    const event = { employee_id: record.employee_id, employee_name: record.employee_name, event_date: record.date,
      event_type: type, shift_id: record.shift_id, punch_id: punchId, minutes_delta: minutes, auto_generated: true };
    autoEvents.push(event);
    record.flags.push(event);
  };
  const stored = events.filter(e => inRange(e.event_date)).map(e => ({ ...e, employee_id: identify(e), event_type: normalType(e.event_type) }));
  for (const shift of candidates) {
    // Neither an upcoming date nor a later shift today belongs in attendance totals.
    if (!inRange(shift.shift_date) || (!(shift.start <= nowMs) && !shift.punches.length)) continue;
    const record = makeRecord(`shift:${shift.id}`, shift.employee_key, shift.employee_name, shift.shift_date, shift, shift.punches, 'Awaiting punch');
    record.ambiguous = shift.ambiguous.length > 0;
    const callout = stored.some(e => e.event_type === 'call_out' && (e.shift_id ? e.shift_id === shift.id : e.employee_id && e.employee_id === shift.employee_key && e.event_date === shift.shift_date));
    if (shift.punches.length) record.status = record.completed ? 'Worked' : 'Clocked in';
    else if (record.ambiguous) record.status = 'Needs matching';
    else if (callout) record.status = 'Call-out';
    else if (!published(shift.shift_date)) record.status = 'Not counted';
    else if (shift.end <= nowMs && shift.employee_key) {
      record.status = 'No show';
      addAuto(record, 'no_show');
    } else if (!shift.employee_key) record.status = 'Needs matching';
    if (shift.punches.length && published(shift.shift_date) && !record.ambiguous) {
      const first = [...shift.punches].sort((a, b) => timestamp(a.clock_in) - timestamp(b.clock_in))[0];
      const last = [...shift.punches].sort((a, b) => timestamp(b.clock_out) - timestamp(a.clock_out))[0];
      const late = (timestamp(first.clock_in) - shift.start) / 60000;
      const earlyOut = record.completed ? (shift.end - timestamp(last.clock_out)) / 60000 : 0;
      if (late > (settings.grace_minutes_late ?? 10)) addAuto(record, 'late', first.id, Math.round(late));
      if (-late > (settings.grace_minutes_early_in ?? 10)) addAuto(record, 'clock_in_early', first.id, Math.round(-late));
      if (earlyOut > (settings.grace_minutes_early_out ?? 10)) addAuto(record, 'left_early', last.id, Math.round(earlyOut));
    }
    records.push(record);
  }
  for (const punch of usablePunches) {
    const date = getStoreToday(new Date(punch.clock_in));
    if (matched.has(punch.id) || !inRange(date)) continue;
    const record = makeRecord(`punch:${punch.id}`, identify(punch), punch.employee_name, date, null, [punch], punch.clock_out ? 'Worked' : 'Clocked in');
    record.ambiguous = ambiguous.has(punch.id);
    if (record.ambiguous || !record.employee_id) record.status = 'Needs matching';
    else if (published(date)) addAuto(record, 'unscheduled', punch.id);
    records.push(record);
  }

  // Carry notes onto current evidence; obsolete automatic flags cannot inflate counts.
  const desired = new Map(autoEvents.map(e => [attendanceEventKey(e), e]));
  for (const event of stored) {
    const existing = desired.get(attendanceEventKey(event));
    const record = records.find(r => event.shift_id && r.shift_id === event.shift_id) ||
      records.find(r => r.actual.some(p => p.id === event.punch_id)) ||
      records.find(r => event.employee_id && r.employee_id === event.employee_id && r.date === event.event_date);
    if (event.auto_generated) {
      if (existing && !existing.id) { existing.id = event.id; existing.note = event.note || ''; }
      if (event.note && record) record.notes.push({ id: event.id, note: event.note, label: existing ? ATTENDANCE_LABELS[event.event_type] : 'Previous flag · no longer counted' });
      // A deleted shift or punch can still have a manager's historical note.
      if (!existing && event.note && !record) {
        const history = makeRecord(`note:${event.id}`, event.employee_id, event.employee_name, event.event_date, null, [], 'Previous note');
        history.notes.push({ id: event.id, note: event.note, label: 'Previous flag · no longer counted' });
        records.push(history);
      }
      continue;
    }
    const target = record || makeRecord(`event:${event.id}`, event.employee_id, event.employee_name, event.event_date, null, [], 'Manager entry');
    if (!record) records.push(target);
    // Preserve conflicting manual entries for inspection, without calling a worked or
    // not-yet-ended shift a no-show. The underlying manager record is never deleted.
    const noShowConflict = event.event_type === 'no_show' && (!target.shift_id || target.actual.length || target.ambiguous || !published(event.event_date) ||
      candidates.find(s => s.id === target.shift_id)?.end > nowMs);
    if (!noShowConflict) {
      const index = target.flags.findIndex(e => attendanceEventKey(e) === attendanceEventKey(event));
      if (index >= 0) target.flags[index] = event;
      else target.flags.push(event);
    }
    if (event.note || noShowConflict) target.notes.push({ id: event.id, note: event.note || '', label: noShowConflict ? 'Manager no-show entry · conflicts with current records' : `Manager entry · ${ATTENDANCE_LABELS[event.event_type] || event.event_type}` });
  }
  const resultEvents = [];
  for (const record of records) {
    record.flags = record.flags.map(e => ({ ...e, key: attendanceEventKey(e), label: ATTENDANCE_LABELS[e.event_type] || e.event_type }));
    resultEvents.push(...record.flags);
    const key = record.employee_id || `unmatched:${nameKey(record.employee_name)}`;
    record.employee_key = key;
    if (!roster.has(key)) roster.set(key, { id: key, name: record.employee_name, active: false });
  }
  const people = [...roster.values()].map(employee => {
    const history = records.filter(r => r.employee_key === employee.id).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const counts = Object.fromEntries(Object.keys(ATTENDANCE_LABELS).map(type => [type, 0]));
    for (const record of history) for (const type of new Set(record.flags.map(e => e.event_type))) counts[type] += 1;
    return { ...employee, records: history, counts, completed: history.filter(r => r.completed).length,
      exception_count: Object.values(counts).reduce((a, b) => a + b, 0), matching_count: history.filter(r => r.ambiguous || r.status === 'Needs matching').length };
  }).filter(e => e.active || e.records.length).sort((a, b) => a.name.localeCompare(b.name));
  return { ...range, generated_at: now.toISOString(), employees: people, events: resultEvents, autoEvents,
    draft_shift_count: records.filter(r => r.shift_id && r.schedule_state !== 'published').length };
}
