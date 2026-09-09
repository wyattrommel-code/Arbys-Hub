import {
  SCHEDULE_STORE_ID,
  computeScheduledHours,
  csvEscape,
  formatClock,
  formatLongDate,
  unpaidBreakMinutes,
} from "./schedule";
import {
  addDaysISO,
  formatStoreDateTime,
  formatStoreDateTimeCsv,
  formatStoreTime,
  getStoreToday,
  storeWallClockToDate,
} from "./store-time";

export const TIMECARD_STORE_ID = SCHEDULE_STORE_ID;

/** Integer minutes for `time_punches.worked_minutes`. Never return a float. */
export function toStoredMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.round(n));
}

/**
 * Whole paid minutes from exact clock timestamps minus unpaid break minutes.
 * Timestamps stay unrounded; only this derived integer is rounded.
 */
export function computePaidWorkedMinutes(clockIn, clockOut, unpaidMinutes = 0) {
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const elapsedMinutes = Math.round((end - start) / 60000);
  return toStoredMinutes(elapsedMinutes - toStoredMinutes(unpaidMinutes));
}

/**
 * @deprecated Prefer computePaidWorkedMinutes with an explicit unpaid-minutes total.
 */
export function computeWorkedMinutes(clockIn, clockOut, breakMinutes = 0, subtractBreak = false) {
  return computePaidWorkedMinutes(
    clockIn,
    clockOut,
    subtractBreak ? unpaidBreakMinutes(breakMinutes) : 0
  );
}

/** Precise hours from stored/computed minutes. No rounding. */
export function exactHoursFromMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n < 0) return null;
  return n / 60;
}

/** Display-only rounding to 2 decimals. */
export function displayHoursFromMinutes(minutes) {
  const hours = exactHoursFromMinutes(minutes);
  if (hours == null) return "—";
  return hours.toFixed(2);
}

export function csvHoursFromMinutes(minutes) {
  const hours = exactHoursFromMinutes(minutes);
  if (hours == null) return "";
  return String(hours);
}

export function punchRangeBounds(fromDate, toDate) {
  const from = storeWallClockToDate(fromDate, "00:00:00");
  const toExclusive = storeWallClockToDate(addDaysISO(toDate, 1), "00:00:00");
  return { from, toExclusive };
}

export function serializeTimecardPunch(punch, shift, options = {}, employee = null) {
  const opts = typeof options === "boolean" ? { subtractScheduledBreak: options } : options || {};
  const useBreakPunches = opts.useBreakPunches !== false;
  const subtractBreak = Boolean(opts.subtractScheduledBreak);
  const breakRows = opts.breaks || [];
  const breakMinScheduled = shift ? unpaidBreakMinutes(shift.unpaid_break_minutes) : 0;
  const actualBreakMin = toStoredMinutes(
    punch.total_break_minutes ??
      breakRows
        .filter((row) => row.status !== "open")
        .reduce((sum, row) => sum + toStoredMinutes(row.break_minutes), 0)
  );
  const unpaidMinutes = useBreakPunches
    ? actualBreakMin
    : subtractBreak && shift
      ? breakMinScheduled
      : 0;
  const open = !punch.clock_out;
  const workedMinutes = open
    ? null
    : punch.worked_minutes != null && Number.isFinite(Number(punch.worked_minutes))
      ? toStoredMinutes(punch.worked_minutes)
      : computePaidWorkedMinutes(punch.clock_in, punch.clock_out, unpaidMinutes);
  const date = punch.clock_in ? getStoreToday(new Date(punch.clock_in)) : "";
  const scheduledHours = shift
    ? Number(shift.scheduled_hours) ||
      computeScheduledHours(shift.scheduled_start, shift.scheduled_end, shift.unpaid_break_minutes)
    : null;
  const shiftLabel = shift
    ? `${formatClock(shift.scheduled_start)} – ${formatClock(shift.scheduled_end)}`
    : "—";
  const extra = shift ? [shift.role, shift.station].filter(Boolean).join(" · ") : "";
  const scheduledHoursLabel =
    scheduledHours != null && Number.isFinite(Number(scheduledHours))
      ? `${Number(scheduledHours).toFixed(2)} hrs sched`
      : "";
  const scheduledParts = [shiftLabel, extra, scheduledHoursLabel].filter(Boolean);
  const breaks = breakRows.map((row) => ({
    id: row.id,
    start: row.break_start,
    end: row.break_end,
    start_label: row.break_start ? formatStoreTime(row.break_start, { seconds: true }) : "—",
    end_label: row.break_end ? formatStoreTime(row.break_end, { seconds: true }) : "Open",
    minutes: row.status === "open" ? null : toStoredMinutes(row.break_minutes),
    open: row.status === "open",
  }));
  return {
    id: punch.id,
    employee_id: punch.employee_id,
    employee_name: punch.employee_name,
    date,
    date_label: date ? formatLongDate(date) : "—",
    clock_in: punch.clock_in,
    clock_out: punch.clock_out,
    clock_in_label: punch.clock_in ? formatStoreDateTime(punch.clock_in) : "—",
    clock_out_label: punch.clock_out ? formatStoreDateTime(punch.clock_out) : "—",
    clock_in_time: punch.clock_in ? formatStoreTime(punch.clock_in, { seconds: true }) : "—",
    clock_out_time: punch.clock_out ? formatStoreTime(punch.clock_out, { seconds: true }) : "—",
    clock_in_csv: punch.clock_in ? formatStoreDateTimeCsv(punch.clock_in) : "",
    clock_out_csv: punch.clock_out ? formatStoreDateTimeCsv(punch.clock_out) : "",
    clock_in_photo_url: punch.clock_in_photo_url || null,
    clock_out_photo_url: punch.clock_out_photo_url || null,
    face_detected_in: Boolean(punch.face_detected_in),
    face_detected_out: Boolean(punch.face_detected_out),
    worked_minutes: workedMinutes,
    worked_hours_display: displayHoursFromMinutes(workedMinutes),
    worked_hours_exact: exactHoursFromMinutes(workedMinutes),
    scheduled_label: scheduledParts.join(" · "),
    scheduled_hours: scheduledHours,
    break_minutes: unpaidMinutes,
    breaks,
    on_break: Boolean(punch.on_break),
    role: shift?.role || employee?.primary_role || "",
    unscheduled: Boolean(punch.unscheduled),
    authorized_by: punch.authorized_by || "",
    status: punch.status || (open ? "open" : "closed"),
    open,
    edited: punch.status === "edited",
  };
}

export function groupTimecards(punches) {
  const map = new Map();
  for (const punch of punches) {
    const key = punch.employee_id || punch.employee_name || "unknown";
    if (!map.has(key)) {
      map.set(key, { key, name: punch.employee_name || "Unknown", punches: [], totalMinutes: 0, approvedMinutes: 0, pendingMinutes: 0, openCount: 0 });
    }
    const group = map.get(key);
    group.punches.push(punch);
    if (punch.open) group.openCount += 1;
    else if (Number.isFinite(punch.worked_minutes)) {
      group.totalMinutes += punch.worked_minutes;
      if (punch.payroll_ready) group.approvedMinutes += punch.worked_minutes;
      else group.pendingMinutes += punch.worked_minutes;
    }
  }
  const groups = [...map.values()].map((group) => {
    group.punches.sort((a, b) => String(a.clock_in || "").localeCompare(String(b.clock_in || "")));
    return {
      ...group,
      totalDisplay: displayHoursFromMinutes(group.totalMinutes),
      approvedDisplay: displayHoursFromMinutes(group.approvedMinutes),
      pendingDisplay: displayHoursFromMinutes(group.pendingMinutes),
      totalExact: exactHoursFromMinutes(group.totalMinutes),
    };
  });
  groups.sort((a, b) => a.name.localeCompare(b.name));
  const grandMinutes = groups.reduce((sum, g) => sum + g.totalMinutes, 0);
  return {
    groups,
    grandMinutes,
    approvedDisplay: displayHoursFromMinutes(groups.reduce((sum, g) => sum + g.approvedMinutes, 0)),
    pendingDisplay: displayHoursFromMinutes(groups.reduce((sum, g) => sum + g.pendingMinutes, 0)),
    grandDisplay: displayHoursFromMinutes(grandMinutes),
    grandExact: exactHoursFromMinutes(grandMinutes),
    openCount: groups.reduce((sum, g) => sum + g.openCount, 0),
  };
}

export function buildPayrollCsv(grouped, fromDate, toDate) {
  if (grouped.groups.some((g) => g.punches.some((p) => !p.payroll_ready))) throw new Error("Resolve all timecard reviews before payroll export.");
  const header = [
    "Employee",
    "Date",
    "Clock In",
    "Clock Out",
    "Worked Hours",
    "Scheduled Hours",
    "Role",
    "Unscheduled",
    "Authorized By",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const group of grouped.groups) {
    for (const punch of group.punches) {
      lines.push(
        [
          punch.employee_name,
          punch.date,
          punch.clock_in_csv,
          punch.clock_out_csv,
          csvHoursFromMinutes(punch.worked_minutes),
          punch.scheduled_hours == null ? "" : String(punch.scheduled_hours),
          punch.role,
          punch.unscheduled ? "Y" : "N",
          punch.authorized_by,
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    lines.push(
      [group.name, "TOTAL", "", "", csvHoursFromMinutes(group.totalMinutes), "", "", "", ""]
        .map(csvEscape)
        .join(",")
    );
  }
  lines.push(
    ["PERIOD TOTAL", `${fromDate} – ${toDate}`, "", "", csvHoursFromMinutes(grouped.grandMinutes), "", "", "", ""]
      .map(csvEscape)
      .join(",")
  );
  return lines.join("\n");
}

export function payrollFilename(fromDate, toDate) {
  return `payroll_${SCHEDULE_STORE_ID}_${fromDate}_${toDate}.csv`;
}
