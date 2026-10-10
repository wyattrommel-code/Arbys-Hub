import { addDaysISO, storeWallClockToDate } from './store-time';

// Schedule checks explain and flag an action; they never authorize or block it.
export function clockActionScheduleFlag(action, context, settings = {}, at = new Date()) {
  if (!['clock_out', 'break_start', 'break_end'].includes(action) || context?.unavailable) return null;
  if (context?.unscheduled) return 'Unscheduled shift';
  const shift = context?.shift;
  if (!shift?.shift_date || !shift.scheduled_start || !shift.scheduled_end || !at) return null;
  let start, end;
  try {
    start = storeWallClockToDate(shift.shift_date, shift.scheduled_start)?.getTime();
    const endDay = shift.scheduled_end <= shift.scheduled_start ? addDaysISO(shift.shift_date, 1) : shift.shift_date;
    end = storeWallClockToDate(endDay, shift.scheduled_end)?.getTime();
  } catch { return null; }
  const time = new Date(at).getTime();
  if (![start, end, time].every(Number.isFinite)) return null;
  if (action === 'clock_out') {
    const grace = Math.max(0, Number(settings.grace_minutes_early_out) || 0) * 60000;
    if (time < end - grace) return 'Early clock-out';
    if (time > end + grace) return 'Late clock-out';
  } else if (time < start || time > end) {
    return 'Break outside scheduled hours';
  }
  return null;
}

export function clockActionScheduleNotice(action, context, settings, at, offline = false) {
  if (!['clock_out', 'break_start', 'break_end'].includes(action)) return null;
  const flag = clockActionScheduleFlag(action, context, settings, at);
  if (flag) return `${flag}. You can continue; your manager will be notified in the Hub for review${offline ? ' when this iPad reconnects' : ''}.`;
  if (!context || context.unavailable) return `You can continue. Any schedule exception will be flagged for manager review${offline ? ' when this iPad reconnects' : ' in the Hub'}.`;
  return null;
}
