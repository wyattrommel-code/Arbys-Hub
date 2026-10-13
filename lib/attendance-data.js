import { STORE_ID } from './constants';
import { SCHEDULE_STORE_ID, weekStartSunday } from './schedule';
import { addDaysISO, storeWallClockToDate } from './store-time';
import { attendanceRange } from './attendance-records';

// Supabase caps each response. Page every source so a busy period is not truncated.
export async function attendanceRows(query) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query().order('id', { ascending: true }).range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

export async function loadAttendanceSources(db, fromDate, toDate, now = new Date()) {
  const range = attendanceRange(fromDate, toDate, now);
  const first = addDaysISO(range.from, -1);
  const after = addDaysISO(range.to, 2);
  const start = storeWallClockToDate(first, '00:00:00').toISOString();
  const end = storeWallClockToDate(after, '00:00:00').toISOString();
  const store = SCHEDULE_STORE_ID;
  const [employees, shifts, punches, weeks, events] = await Promise.all([
    attendanceRows(() => db.from('employees').select('id,first_name,last_name,jolt_employee_id,is_active').eq('store_id', STORE_ID)),
    attendanceRows(() => db.from('schedule_shifts').select('id,employee_id,employee_name,jolt_employee_id,shift_date,scheduled_start,scheduled_end,role,station').eq('store_id', store).gte('shift_date', first).lte('shift_date', addDaysISO(range.to, 1))),
    attendanceRows(() => db.from('time_punches').select('id,employee_id,employee_name,shift_id,clock_in,clock_out,needs_approval').eq('store_id', store).lt('clock_in', end).or(`clock_out.gte.${start},clock_out.is.null`)),
    // schedule_weeks has a composite key, not an id column; a year is < 55 rows.
    db.from('schedule_weeks').select('week_start_date,status').eq('store_id', store).gte('week_start_date', weekStartSunday(first)).lte('week_start_date', weekStartSunday(after)).then(({ data, error }) => { if (error) throw error; return data || []; }),
    attendanceRows(() => db.from('attendance_events').select('id,employee_id,employee_name,event_date,event_type,shift_id,punch_id,minutes_delta,auto_generated,note').eq('store_id', store).gte('event_date', first).lte('event_date', range.to)),
  ]);
  return { ...range, now, employees, shifts, punches, weeks, events };
}
