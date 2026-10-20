import { addDaysISO, getStoreToday } from './store-time';
import { weekStartSunday } from './schedule';
import { approvedClockWork } from './clock-work';

export async function fetchClockWorkShifts(db, at = new Date(), days = 0) {
  const today = getStoreToday(at), first = addDaysISO(today,-1), last = addDaysISO(today,days);
  const [shifts, weeks, punches] = await Promise.all([
    db.from('schedule_shifts').select('id,employee_id,employee_name,shift_date,scheduled_start,scheduled_end,role,station').eq('store_id','payson').gte('shift_date',first).lte('shift_date',last).order('shift_date').limit(1000),
    db.from('schedule_weeks').select('week_start_date,status').eq('store_id','payson').gte('week_start_date',weekStartSunday(first)).lte('week_start_date',weekStartSunday(last)),
    db.from('time_punches').select('id,employee_id,shift_id,clock_in,clock_out,work_context,authorized_by_id').eq('store_id','payson').gte('clock_in',new Date(new Date(at).getTime()-36*3600000).toISOString()).limit(1000),
  ]);
  for (const result of [shifts,weeks,punches]) if (result.error) throw result.error;
  if (shifts.data.length === 1000 || punches.data.length === 1000) throw new Error('Schedule list is too large. Ask your manager to check the schedule.');
  return { used_shift_ids: punches.data.map(p=>p.shift_id).filter(Boolean), shifts: shifts.data.map(s=>({ ...s,
    published: weeks.data.some(w=>w.week_start_date===weekStartSunday(s.shift_date) && w.status==='published'),
    owner_clocked_in: punches.data.some(p=>p.employee_id===s.employee_id && !p.clock_out),
    coverage_taken: punches.data.some(p=>approvedClockWork(p)?.covered_shift_id===s.id && !p.clock_out),
  })) };
}
