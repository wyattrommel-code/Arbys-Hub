import { addDaysISO, getStoreToday, parseISODate } from "./store-time";

/** Schedule tables (shifts, weeks, stations, templates) use this store id. */
export const SCHEDULE_STORE_ID = "payson";

export const SHIFT_SOURCE_HUB = "hub";

export const UNASSIGNED_EMPLOYEE_NAME = "Unassigned";
export const UNASSIGNED_ROW_ID = "__unassigned__";

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const SHIFT_ROLE_OPTIONS = [
  "Crew",
  "Shift Lead",
  "Morning",
  "Breakfast",
  "Open",
  "Day Lead",
  "Mid Shift",
  "Night",
  "Night Lead",
  "Closing",
  "Manager",
];

export function weekStartSunday(isoDate = getStoreToday()) {
  const dow = parseISODate(isoDate).getUTCDay();
  return addDaysISO(isoDate, -dow);
}

export function weekEndSaturday(weekStart) {
  return addDaysISO(weekStart, 6);
}

export function weekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
}

export function dayOfWeekFromIso(isoDate) {
  return parseISODate(isoDate).getUTCDay();
}

export function formatWeekRange(weekStart) {
  const start = parseISODate(weekStart);
  const end = parseISODate(weekEndSaturday(weekStart));
  const startLabel = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endLabel = end.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${startLabel} – ${endLabel}`;
}

export function formatShortDate(isoDate) {
  return parseISODate(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatLongDate(isoDate) {
  return parseISODate(isoDate).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Normalize Postgres time / timetz values to HH:MM:SS. */
export function normalizeTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return "";
  return `${match[1]}:${match[2]}:${match[3] || "00"}`;
}

export function timeToMinutes(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  const [h, m] = normalized.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(total) {
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

export function formatClock(value) {
  const mins = timeToMinutes(value);
  if (!Number.isFinite(mins)) return "—";
  const hour24 = Math.floor(mins / 60);
  const minute = mins % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

export function timeInputValue(value) {
  const normalized = normalizeTime(value);
  return normalized ? normalized.slice(0, 5) : "";
}

export function fromTimeInput(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}:00`;
}

export function parseStationNames(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function serializeStationNames(names) {
  const list = (names || []).map((n) => String(n).trim()).filter(Boolean);
  return list.length ? list.join(", ") : null;
}

export function unpaidBreakMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

export function computeScheduledHours(start, end, breakMinutes = 0) {
  const a = timeToMinutes(start);
  const b = timeToMinutes(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60;
  if (diff === 0) return 0;
  const worked = Math.max(0, diff - unpaidBreakMinutes(breakMinutes));
  return Math.round((worked / 60) * 100) / 100;
}

export function formatHours(n) {
  return `${(Number(n) || 0).toFixed(1)}h`;
}

export function nameKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function contrastText(hex) {
  const raw = String(hex || "").replace("#", "");
  if (raw.length !== 6) return "#ffffff";
  const n = Number.parseInt(raw, 16);
  if (!Number.isFinite(n)) return "#ffffff";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#111111" : "#ffffff";
}

export function unassignedEmployeeRow() {
  return {
    id: UNASSIGNED_ROW_ID,
    fullName: UNASSIGNED_EMPLOYEE_NAME,
    first_name: UNASSIGNED_EMPLOYEE_NAME,
    last_name: "",
    role: "crew",
    isUnassigned: true,
    jolt_employee_id: null,
    primary_role: "",
  };
}

export function isUnassignedName(name) {
  return nameKey(name) === nameKey(UNASSIGNED_EMPLOYEE_NAME) || !String(name || "").trim();
}

export function shiftPayload(shift, weekStart) {
  const start = normalizeTime(shift.scheduled_start);
  const end = normalizeTime(shift.scheduled_end);
  const breakMin = unpaidBreakMinutes(shift.unpaid_break_minutes);
  return {
    shift_date: shift.shift_date,
    employee_name: shift.employee_name || UNASSIGNED_EMPLOYEE_NAME,
    jolt_employee_id: shift.jolt_employee_id || null,
    role: shift.role || null,
    station: shift.station || null,
    scheduled_start: start,
    scheduled_end: end,
    scheduled_hours: computeScheduledHours(start, end, breakMin),
    unpaid_break_minutes: breakMin,
    week_start_date: weekStart,
    store_id: SCHEDULE_STORE_ID,
    notes: shift.notes || null,
    source: shift.source || SHIFT_SOURCE_HUB,
  };
}

export function timeOutsideWindow(start, end, windowStart, windowEnd) {
  const shiftStart = timeToMinutes(start);
  const shiftEnd = timeToMinutes(end);
  const availStart = timeToMinutes(windowStart);
  const availEnd = timeToMinutes(windowEnd);
  if (
    !Number.isFinite(shiftStart) ||
    !Number.isFinite(shiftEnd) ||
    !Number.isFinite(availStart) ||
    !Number.isFinite(availEnd)
  ) {
    return false;
  }
  let shiftEndAdj = shiftEnd;
  if (shiftEndAdj <= shiftStart) shiftEndAdj += 24 * 60;
  let availEndAdj = availEnd;
  if (availEndAdj <= availStart) availEndAdj += 24 * 60;
  return shiftStart < availStart || shiftEndAdj > availEndAdj;
}

export function shiftWarningMessages(shift, availability, approvedTimeOff) {
  const messages = [];
  if (availability && availability.is_available === false) {
    messages.push("Marked unavailable this day");
  }
  if (
    availability &&
    availability.is_available !== false &&
    availability.available_start &&
    availability.available_end &&
    timeOutsideWindow(
      shift.scheduled_start,
      shift.scheduled_end,
      availability.available_start,
      availability.available_end
    )
  ) {
    messages.push("Outside availability window");
  }
  const date = shift.shift_date;
  const overlapping = (approvedTimeOff || []).filter(
    (req) => req.start_date <= date && req.end_date >= date
  );
  if (overlapping.length) {
    messages.push("Approved time off");
  }
  return messages;
}

export function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function shiftsToCsv(shifts, weekStart) {
  const header = [
    "Employee",
    "Date",
    "Day",
    "Role",
    "Station",
    "Start",
    "End",
    "Unpaid Break (min)",
    "Hours",
    "Notes",
  ];
  const dates = weekDates(weekStart);
  const rows = [...shifts]
    .filter((s) => s.shift_date >= dates[0] && s.shift_date <= dates[6])
    .sort((a, b) => {
      const nameCmp = String(a.employee_name || "").localeCompare(
        String(b.employee_name || "")
      );
      if (nameCmp !== 0) return nameCmp;
      const dateCmp = String(a.shift_date).localeCompare(String(b.shift_date));
      if (dateCmp !== 0) return dateCmp;
      return (timeToMinutes(a.scheduled_start) ?? 0) - (timeToMinutes(b.scheduled_start) ?? 0);
    })
    .map((s) =>
      [
        s.employee_name,
        s.shift_date,
        DAY_LABELS[dayOfWeekFromIso(s.shift_date)] || "",
        s.role || "",
        s.station || "",
        formatClock(s.scheduled_start),
        formatClock(s.scheduled_end),
        unpaidBreakMinutes(s.unpaid_break_minutes),
        Number(s.scheduled_hours) || 0,
        s.notes || "",
      ]
        .map(csvEscape)
        .join(",")
    );
  return [header.join(","), ...rows].join("\n");
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function employeeSortRank(emp) {
  if (emp?.isUnassigned) return -1;
  const role = String(emp?.role || "").toLowerCase();
  if (role === "gm" || emp?.is_manager) return 0;
  if (role === "assistant_manager" || emp?.is_assistant_manager) return 1;
  if (role === "shift_lead" || emp?.is_shift_lead) return 2;
  if (emp?.isSynthetic) return 4;
  return 3;
}

export function compareEmployees(a, b) {
  const rank = employeeSortRank(a) - employeeSortRank(b);
  if (rank !== 0) return rank;
  const aLast = String(a.last_name || a.fullName || "").toLowerCase();
  const bLast = String(b.last_name || b.fullName || "").toLowerCase();
  if (aLast !== bLast) return aLast.localeCompare(bLast);
  return String(a.first_name || "").localeCompare(String(b.first_name || ""));
}
