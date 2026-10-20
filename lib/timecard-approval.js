import { createHash } from "node:crypto";
import { addDaysISO, storeWallClockToDate } from "./store-time";
import { clockActionScheduleFlag } from "./clock-schedule";
import { approvedClockWork, workSchedule } from './clock-work';

const liveOfflineKinds = new Set(["clock_in", "clock_out", "break_start", "break_end"]);
const sameTime = (a, b) => Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
const snapshotHash = (snapshot) => createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

// Sync reuses the correction transaction for its audit trail. Only a matching,
// successfully applied live event is exempt; an offline label alone is not proof.
function isValidatedOfflinePunch(correction, punch, events) {
  return events.some((receipt) => {
    const event = receipt.event;
    return receipt.status === "applied" && receipt.issue == null &&
      receipt.punch_id === punch.id && receipt.employee_id === punch.employee_id &&
      correction.time_punch_id === punch.id && event?.employee_id === punch.employee_id &&
      liveOfflineKinds.has(event.kind) && correction.correction_type === `forgot_${event.kind}` &&
      Boolean(correction.photo_url) && correction.photo_url === receipt.photo_url &&
      sameTime(correction.claimed_time, receipt.occurred_at) &&
      sameTime(correction.photo_captured_at, receipt.captured_at) &&
      sameTime(event.occurred_at, receipt.occurred_at) &&
      sameTime(event.captured_at, receipt.captured_at) &&
      sameTime(event.occurred_at, event.captured_at);
  });
}

// Server-generated review version. A changed punch, break, schedule or rule needs a new review.
export function timecardReview(punch, shift, settings, approvals = [], offlineEvents = []) {
  const flags = [];
  const work = approvedClockWork(punch);
  if(work?.reason==='covering') shift=workSchedule(work);
  if (!work && (punch.unscheduled || !shift)) flags.push("Unscheduled shift");
  if(work?.reason==='schedule_issue' && !shift) flags.push('Check timecard');
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
  if (shift && punch.breaks.some(row =>
    (row.start && clockActionScheduleFlag('break_start', { shift }, settings, row.start)) ||
    (row.end && clockActionScheduleFlag('break_end', { shift }, settings, row.end)))) {
    flags.push('Break outside scheduled hours');
  }
  if (punch.corrections?.some(row => row.source !== "offline")) flags.push("Missed punch correction");
  const offlineCorrections = (punch.corrections || []).filter(row => row.source === "offline");
  const offlineFlagIndex = flags.length;
  const offlineNeedsReview = offlineCorrections.some(row => !isValidatedOfflinePunch(row, punch, offlineEvents));
  if (offlineNeedsReview) flags.push("Offline punch");
  if (punch.edited) flags.push("Edited punch");
  if (Date.parse(punch.clock_out) - Date.parse(punch.clock_in) > 16 * 3600000) flags.push("Over 16 hours");
  const incomplete = punch.open || punch.on_break || punch.breaks.some((row) => row.open);
  const snapshot = {
    id: punch.id, employee: punch.employee_id, in: punch.clock_in, out: punch.clock_out,
    minutes: punch.worked_minutes, breaks: [...punch.breaks].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    unpaid: punch.break_minutes, status: punch.status, incomplete, shift: shift || null,
    ...(punch.corrections?.length ? { corrections: punch.corrections } : {}),
    ...(punch.edit_revision ? { edit_revision:punch.edit_revision } : {}),
    ...(work ? { work_context:work } : {}),
    rules: [settings.grace_minutes_early_in, settings.grace_minutes_late, settings.grace_minutes_early_out,
      settings.use_break_punches, settings.subtract_scheduled_break], flags,
  };
  const version = snapshotHash(snapshot);
  // Removing only the offline flag must not reopen an otherwise unchanged,
  // previously approved timecard. All punch, break, schedule and audit data still match.
  const legacyFlags = [...flags];
  legacyFlags.splice(offlineFlagIndex, 0, "Offline punch");
  const legacyVersion = offlineCorrections.length && !offlineNeedsReview
    ? snapshotHash({ ...snapshot, flags: legacyFlags }) : null;
  const approval = approvals.find((row) => row.punch_id === punch.id && row.snapshot_hash === version) ||
    approvals.find((row) => row.punch_id === punch.id && legacyVersion && row.snapshot_hash === legacyVersion) || null;
  return { review_flags: flags, review_version: version, review_snapshot: snapshot, approval,
    pending_approval: flags.length > 0 && !approval,
    payroll_ready: !incomplete && (!flags.length || Boolean(approval)) };
}
