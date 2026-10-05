import { computeScheduledHours, minutesToTime, timeToMinutes } from "./schedule";

export const DAY_MINUTES = 1440;
export const SNAP_MINUTES = 15;

export function shiftWindow(shift) {
  const start = timeToMinutes(shift.scheduled_start) ?? 0;
  let end = timeToMinutes(shift.scheduled_end) ?? start;
  if (end < start) end += DAY_MINUTES;
  return { start, end };
}

// Keep the start on this date. Ends may cross midnight, but never imply a
// zero-length / ambiguous 24-hour shift in the existing time-only columns.
export function adjustShiftWindow(window, action, delta, timelineEnd = DAY_MINUTES) {
  const step = Math.round(delta / SNAP_MINUTES) * SNAP_MINUTES;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const { start, end } = window;
  if (action === "start") {
    return { start: clamp(start + step, Math.max(0, end - DAY_MINUTES + SNAP_MINUTES), Math.min(end - SNAP_MINUTES, DAY_MINUTES - SNAP_MINUTES)), end };
  }
  if (action === "end") {
    return { start, end: clamp(end + step, start + SNAP_MINUTES, Math.min(timelineEnd, start + DAY_MINUTES - SNAP_MINUTES)) };
  }
  const duration = Math.max(SNAP_MINUTES, end - start);
  const nextStart = clamp(start + step, 0, Math.min(DAY_MINUTES - SNAP_MINUTES, timelineEnd - duration));
  return { start: nextStart, end: nextStart + duration };
}

export function windowFields(window, breakMinutes) {
  const scheduled_start = minutesToTime(window.start);
  const scheduled_end = minutesToTime(window.end);
  return {
    scheduled_start,
    scheduled_end,
    scheduled_hours: computeScheduledHours(scheduled_start, scheduled_end, breakMinutes),
  };
}

// Overlapping shifts get separate lanes so every card and resize handle remains reachable.
export function layoutDayShifts(shifts) {
  const ends = [];
  return [...shifts].sort((a, b) => shiftWindow(a).start - shiftWindow(b).start).map((shift) => {
    const window = shiftWindow(shift);
    let lane = ends.findIndex((end) => end <= window.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = window.end;
    return { shift, ...window, lane };
  });
}
