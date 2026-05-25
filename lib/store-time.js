import { STORE_TIMEZONE } from "./constants";

function storeDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
  };
}

/** Today's date as YYYY-MM-DD in store timezone (Payson, UT). */
export function getStoreToday(date = new Date()) {
  const { year, month, day } = storeDateParts(date);
  return `${year}-${month}-${day}`;
}

/** Day of week 0=Sun … 6=Sat in store timezone. */
export function getStoreDayOfWeek(date = new Date()) {
  const today = getStoreToday(date);
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** AM if local hour < 14, else PM (store timezone). */
export function getCurrentShift(date = new Date()) {
  const { hour } = storeDateParts(date);
  return hour < 14 ? "AM" : "PM";
}

/** Format a timestamp for display in store timezone. */
export function formatStoreTime(isoString) {
  if (!isoString) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

/** Parse YYYY-MM-DD to Date at noon UTC (safe for day arithmetic). */
export function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Add days to an ISO date string, return ISO date string. */
export function addDaysISO(iso, days) {
  const dt = parseISODate(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
