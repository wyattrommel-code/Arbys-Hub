import { createHash } from "node:crypto";
import { addDaysISO, storeWallClockToDate } from "./store-time";

// Server-generated review version. A changed punch, break, schedule or rule needs a new review.
export function timecardReview(punch, shift, settings, approvals = []) {
  const flags = [];
  if (punch.unscheduled || !shift) flags.push("Unscheduled shift");
  if (shift) {
    const start = storeWallClockToDate(shift.shift_date, shift.scheduled_start).getTime();
    const endDate = shift.scheduled_end <= shift.scheduled_start ? addDaysISO(shift.shift_date, 1) : shift.shift_date;
    const end = storeWallClockToDate(endDate, shift.scheduled_end).getTime();
    const arrival = (Date.parse(punch.clock_in) - start) / 60000;
    const departure = (Date.parse(punch.clock_out) - end) / 60000;
    if (arrival < -settings.grace_minutes_early_in) flags.push("Early clock-in");
    if (arrival > settings.grace_minutes_late) flags.push("Late clock-in");
    if (departure < -settings.grace_minutes_early_out) flags.push("Early clock-out");
    if (departure > settings.grace_minutes_early_out) flags.push("Late clock-out");
  }
  if (punch.edited) flags.push("Edited punch");
  if (Date.parse(punch.clock_out) - Date.parse(punch.clock_in) > 16 * 3600000) flags.push("Over 16 hours");
  const incomplete = punch.open || punch.on_break || punch.breaks.some((row) => row.open);
  const snapshot = {
    id: punch.id, employee: punch.employee_id, in: punch.clock_in, out: punch.clock_out,
    minutes: punch.worked_minutes, breaks: [...punch.breaks].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    unpaid: punch.break_minutes, status: punch.status, incomplete, shift: shift || null,
    rules: [settings.grace_minutes_early_in, settings.grace_minutes_late, settings.grace_minutes_early_out,
      settings.use_break_punches, settings.subtract_scheduled_break], flags,
  };
  const version = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const approval = approvals.find((row) => row.punch_id === punch.id && row.snapshot_hash === version) || null;
  return { review_flags: flags, review_version: version, review_snapshot: snapshot, approval,
    pending_approval: flags.length > 0 && !approval,
    payroll_ready: !incomplete && (!flags.length || Boolean(approval)) };
}
