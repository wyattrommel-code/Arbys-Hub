import { attendanceRange, ATTENDANCE_LABELS } from './attendance-records';
import { STORE_TIMEZONE } from './constants';
import { formatStoreTime, getStoreToday } from './store-time';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const dateLabel = date => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
function csvCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function attendanceExportOptions(params, now = new Date()) {
  let range;
  try { range = attendanceRange(params.get('from'), params.get('to'), now); }
  catch (error) { fail(error.message); }
  const from = params.get('from') || range.from;
  const to = params.get('to') || range.to;
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365) fail('Choose a range of one year or less.');
  const type = params.get('type') || 'summary';
  const scope = params.get('scope') || 'all';
  const employeeIds = [...new Set(params.getAll('employee_id').filter(Boolean))];
  if (!['summary', 'details'].includes(type)) fail('Choose an employee summary or detailed attendance report.');
  if (!['all', 'selected'].includes(scope)) fail('Choose everyone or selected employees.');
  if (scope === 'selected' && !employeeIds.length) fail('Select at least one employee.');
  if (scope === 'all' && employeeIds.length) fail('Choose selected employees to export specific people.');
  return { from, to, through: range.to, type, scope, employeeIds };
}

function actualLabel(punch, date) {
  const clock = value => `${getStoreToday(new Date(value)) !== date ? `${dateLabel(getStoreToday(new Date(value)))} ` : ''}${formatStoreTime(value, { seconds: true })}`;
  return `${clock(punch.clock_in)} – ${punch.clock_out ? clock(punch.clock_out) : 'Still clocked in'}`;
}

/** Uses the same report as the workspace, including its corrected absence counts. */
export function buildAttendanceExport(report, options) {
  const people = options.scope === 'all' ? report.employees : report.employees.filter(person => options.employeeIds.includes(person.id));
  if (options.scope === 'selected' && people.length !== options.employeeIds.length) fail('One or more employees are unavailable in this period. Refresh attendance and select them again.');
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const countTypes = ['late', 'call_out', 'no_show', 'left_early', 'clock_in_early', 'unscheduled'];
  let rows;
  if (options.type === 'summary') {
    const values = person => [person.completed, ...countTypes.map(type => person.counts[type] || 0), person.covered_count || 0, person.extra_hours_count || 0];
    rows = [['Employee', 'Completed shifts', 'Late arrivals', 'Call-outs', 'No-shows', 'Left early', 'Early clock-ins', 'Unscheduled punches', 'Covered shifts', 'Extra-hours shifts'],
      ...sorted.map(person => [person.name, ...values(person)])];
    rows.push(['PERIOD TOTAL', ...sorted.reduce((totals, person) => totals.map((n, i) => n + values(person)[i]), Array(9).fill(0))]);
  } else {
    rows = [['Employee', 'Date', 'Scheduled time', 'Actual punches', 'Status', 'Attendance flags', 'Late minutes', 'Left early minutes', 'Early clock-in minutes', 'Schedule status', 'Manager notes', 'Work type', 'Coverage']];
    for (const person of sorted) {
      if (!person.records.length) rows.push([person.name, '', '', '', 'No attendance activity in this period', '', '', '', '', '', '', '', '']);
      for (const record of [...person.records].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
        const minutes = type => record.flags.filter(flag => flag.event_type === type).reduce((total, flag) => total + (Number(flag.minutes_delta) || 0), 0);
        rows.push([person.name, dateLabel(record.date), record.scheduled_label, record.actual.map(p => actualLabel(p, record.date)).join('; ') || (record.ambiguous ? 'Punch found; check timecard' : 'No punch recorded'),
          record.status, record.flags.map(flag => ATTENDANCE_LABELS[flag.event_type] || flag.event_type).join('; ') || 'None', minutes('late'), minutes('left_early'), minutes('clock_in_early'),
          record.schedule_state === 'published' ? 'Published' : record.schedule_state === 'draft' ? 'Draft; automatic flags not counted' : 'No published schedule; automatic flags not counted',
          [...record.notes.map(note => `${note.label}: ${note.note || '(no note)'}`), ...(record.work_note ? [record.work_note] : [])].join('\n'), record.work_label || '', record.coverage_note || '']);
      }
    }
  }
  rows.push([], ['Period', `${dateLabel(options.from)} – ${dateLabel(options.to)}`], ['Data through', dateLabel(report.to)],
    ['Employees', options.scope === 'all' ? `Everyone (${people.length})` : sorted.map(person => person.name).join('; ')],
    ['Times', `Restaurant time (${STORE_TIMEZONE}); detailed punches include seconds.`],
    ['Attendance rules', 'Future shifts excluded. No-shows require a published shift that has ended with no matching punch or call-out.'],
    ['Generated', report.generated_at]);
  const slug = text => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'employee';
  const who = options.scope === 'all' ? 'everyone' : people.length === 1 ? slug(people[0].name) : `${people.length}-employees`;
  return { csv: '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n',
    filename: `attendance-${options.type}-${who}-${options.from}-to-${options.to}.csv` };
}
