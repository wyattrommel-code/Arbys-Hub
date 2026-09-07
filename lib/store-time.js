import { STORE_TIMEZONE } from "./constants";

function storeDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute || 0),
    second: Number(parts.second || 0),
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

/** Minutes since midnight in store timezone. */
export function getStoreMinutes(date = new Date()) {
  const { hour, minute } = storeDateParts(date);
  return hour * 60 + minute;
}

/** AM if local hour < 14, else PM (store timezone). */
export function getCurrentShift(date = new Date()) {
  const { hour } = storeDateParts(date);
  return hour < 14 ? "AM" : "PM";
}

/** Format a timestamp for display in store timezone. */
export function formatStoreTime(isoString, { seconds = false } = {}) {
  if (!isoString) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  }).format(new Date(isoString));
}

/** Store-local date + time with seconds, e.g. 9/7/2026, 3:58:03 PM */
export function formatStoreDateTime(isoString) {
  if (!isoString) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIMEZONE,
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(isoString));
}

/** Exact store-local wall clock for payroll CSV: YYYY-MM-DD HH:MM:SS */
export function formatStoreDateTimeCsv(isoString) {
  if (!isoString) return "";
  const p = storeDateParts(new Date(isoString));
  return `${p.year}-${p.month}-${p.day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}`;
}

/** Value for <input type="datetime-local"> in store time. */
export function toStoreDateTimeLocal(isoString) {
  if (!isoString) return "";
  const p = storeDateParts(new Date(isoString));
  return `${p.year}-${p.month}-${p.day}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}`;
}

/** Interpret a datetime-local string as store-local wall clock → Date. */
export function fromStoreDateTimeLocal(value) {
  const match = String(value || "").trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const time = `${match[2]}:${match[3] || "00"}`;
  return storeWallClockToDate(match[1], time);
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

/**
 * Convert a store-local calendar date + wall-clock time to a UTC Date.
 * Handles DST by walking the timezone offset until the wall clock matches.
 */
export function storeWallClockToDate(isoDate, timeValue) {
  const date = String(isoDate || "").slice(0, 10);
  const match = String(timeValue || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 4; i += 1) {
    const shown = storeDateParts(new Date(utcMs));
    const shownDate = `${shown.year}-${shown.month}-${shown.day}`;
    const shownSeconds = shown.hour * 3600 + shown.minute * 60 + shown.second;
    const desiredSeconds = hour * 3600 + minute * 60 + second;
    let dayDiff = 0;
    if (shownDate < date) dayDiff = 1;
    else if (shownDate > date) dayDiff = -1;
    const deltaSeconds = dayDiff * 24 * 3600 + (desiredSeconds - shownSeconds);
    if (deltaSeconds === 0) break;
    utcMs += deltaSeconds * 1000;
  }
  return new Date(utcMs);
}
