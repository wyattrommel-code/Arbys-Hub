import { STORE_TIMEZONE } from "./constants";
import { weekStartSunday } from "./schedule";
import { addDaysISO, formatStoreDateTimeCsv, getStoreToday, storeWallClockToDate } from "./store-time";
import { TIMECARD_STORE_ID } from "./timecards";

export function validateReportRange(from, to) {
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) throw Object.assign(new Error("Choose a valid start and end date."), { status: 400 });
}

const employeeKey = (p) => p.employee_id || p.employee_name || "unknown";
const hours = (minutes) => (minutes / 60).toFixed(2);
const complete = (p) => !p.open && p.clock_out && !p.on_break && !(p.breaks || []).some((b) => b.open) && Number.isFinite(p.worked_minutes);
const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));

// Keep approved whole paid minutes authoritative. Split only shifts crossing the
// store-local Sunday boundary; actual break positions determine the allocation.
function weekMinutes(punch) {
  const start = Date.parse(punch.clock_in), end = Date.parse(punch.clock_out);
  let week = weekStartSunday(getStoreToday(new Date(start)));
  if (end <= start) return [{ week, start, minutes: punch.worked_minutes }];
  const parts = [];
  for (let cursor = start; cursor < end;) {
    const next = storeWallClockToDate(addDaysISO(week, 7), "00:00:00").getTime();
    const stop = Math.min(next, end);
    parts.push({ week, start: cursor, end: stop, weight: stop - cursor });
    cursor = stop;
    week = addDaysISO(week, 7);
  }
  if (parts.length === 1) return [{ ...parts[0], minutes: punch.worked_minutes }];
  const breaks = (punch.breaks || []).filter((b) => !b.open && b.start && b.end);
  const locatedMinutes = breaks.reduce((sum, b) => sum + (b.minutes || 0), 0);
  // A scheduled deduction has no recorded position. Allocate it proportionally.
  if (locatedMinutes && locatedMinutes === punch.break_minutes) {
    for (const part of parts) {
      for (const b of breaks) {
        const a = Date.parse(b.start), z = Date.parse(b.end);
        if (z > a) part.weight -= overlap(part.start, part.end, a, z) / (z - a) * b.minutes * 60000;
      }
      part.weight = Math.max(0, part.weight);
    }
  }
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const denominator = totalWeight || end - start;
  for (const part of parts) {
    part.exact = punch.worked_minutes * (totalWeight ? part.weight : part.end - part.start) / denominator;
    part.minutes = Math.floor(part.exact);
  }
  let remaining = punch.worked_minutes - parts.reduce((sum, p) => sum + p.minutes, 0);
  for (const part of [...parts].sort((a, b) => (b.exact - b.minutes) - (a.exact - a.minutes) || a.start - b.start)) {
    if (remaining-- > 0) part.minutes++;
  }
  return parts;
}

export function buildTimecardReport(context, from, to, { wages = null } = {}) {
  validateReportRange(from, to);
  const selected = context.filter((p) => p.date >= from && p.date <= to);
  const selectedIds = new Set(selected.map((p) => p.id));
  const selectedEmployees = new Set(selected.map(employeeKey));
  const selectedWeeks = new Set();
  const pieces = [];
  const byPunch = new Map();
  for (const punch of context) {
    if (!complete(punch)) continue;
    byPunch.set(punch.id, { regular_minutes: 0, overtime_minutes: 0 });
    for (const part of weekMinutes(punch)) {
      const key = `${employeeKey(punch)}:${part.week}`;
      pieces.push({ ...part, key, punch });
      if (selectedIds.has(punch.id)) selectedWeeks.add(key);
    }
  }
  const running = new Map();
  for (const part of pieces.sort((a, b) => a.start - b.start || String(a.punch.id).localeCompare(String(b.punch.id)))) {
    const previous = running.get(part.key) || 0;
    const regular = Math.min(part.minutes, Math.max(0, 2400 - previous));
    const totals = byPunch.get(part.punch.id);
    totals.regular_minutes += regular;
    totals.overtime_minutes += part.minutes - regular;
    running.set(part.key, previous + part.minutes);
  }
  const contextPending = context.filter((p) => !selectedIds.has(p.id) && !p.payroll_ready &&
    (complete(p) ? weekMinutes(p).some((part) => selectedWeeks.has(`${employeeKey(p)}:${part.week}`)) :
      selectedEmployees.has(employeeKey(p))));
  const groupMap = new Map();
  const punches = selected.map((p) => ({ ...p, ...byPunch.get(p.id) }));
  const rates = [...(wages || [])].sort((a, b) => a.effective_date.localeCompare(b.effective_date) || String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id)));
  for (const p of punches) {
    if (wages !== null) {
      const rate = rates.findLast((w) => w.employee_id === p.employee_id && w.effective_date <= p.date);
      const available = rate && rate.hourly_rate != null && Number.isFinite(Number(rate.hourly_rate)) && Number(rate.hourly_rate) >= 0 && complete(p);
      p.regular_pay_cents = available ? Math.round(p.regular_minutes / 60 * Number(rate.hourly_rate) * 100) : null;
      p.overtime_pay_cents = available ? Math.round(p.overtime_minutes / 60 * Number(rate.hourly_rate) * 150) : null;
    }
    const key = employeeKey(p);
    if (!groupMap.has(key)) groupMap.set(key, { key, name: p.employee_name || "Unknown", punch_count: 0, break_count: 0,
      worked_minutes: 0, regular_minutes: 0, overtime_minutes: 0, break_minutes: 0,
      ...(wages !== null ? { regular_pay_cents: 0, overtime_pay_cents: 0, missing_rate_count: 0 } : {}) });
    const group = groupMap.get(key);
    group.punch_count++;
    group.break_count += (p.breaks || []).filter((b) => !b.open).length;
    group.break_minutes += p.break_minutes || 0;
    group.worked_minutes += complete(p) ? p.worked_minutes : 0;
    group.regular_minutes += p.regular_minutes || 0;
    group.overtime_minutes += p.overtime_minutes || 0;
    if (wages !== null) {
      if (p.regular_pay_cents === null) group.missing_rate_count++;
      group.regular_pay_cents += p.regular_pay_cents || 0;
      group.overtime_pay_cents += p.overtime_pay_cents || 0;
    }
  }
  const groups = [...groupMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totals = groups.reduce((sum, g) => {
    for (const key of Object.keys(sum)) sum[key] += g[key];
    return sum;
  }, { punch_count: 0, break_count: 0, worked_minutes: 0, regular_minutes: 0, overtime_minutes: 0, break_minutes: 0,
    ...(wages !== null ? { regular_pay_cents: 0, overtime_pay_cents: 0, missing_rate_count: 0 } : {}) });
  return { from, to, punches, groups, totals, include_pay: wages !== null, context_pending_count: contextPending.length,
    blocked: selected.some((p) => !complete(p) || !p.payroll_ready) || contextPending.length > 0 };
}

// Spreadsheet applications must never execute employee names or notes as formulas.
function cell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function timecardReportFilename(type, from, to) {
  return `${type === "summary" ? "employee_totals" : "total_punches"}_${TIMECARD_STORE_ID}_${from}_${to}.csv`;
}

export function buildTimecardReportCsv(report, type) {
  if (!["summary", "punches"].includes(type)) throw Object.assign(new Error("Unknown report type."), { status: 400 });
  if (report.blocked) throw Object.assign(new Error("Close and approve all punches in this range and any earlier punches used for weekly overtime."), { status: 409 });
  const scope = [report.from, report.to, STORE_TIMEZONE];
  const countsAndHours = (g) => [g.punch_count, g.break_count, hours(g.regular_minutes), hours(g.overtime_minutes), hours(g.worked_minutes), hours(g.break_minutes), g.break_minutes];
  let rows;
  if (type === "summary") {
    const payHeaders = report.include_pay ? ["Estimated Regular Pay", "Estimated Overtime Pay", "Estimated Total Pay"] : [];
    const pay = (g) => !report.include_pay ? [] : g.missing_rate_count ? ["Rate missing", "Rate missing", "Rate missing"] :
      [g.regular_pay_cents, g.overtime_pay_cents, g.regular_pay_cents + g.overtime_pay_cents].map((n) => (n / 100).toFixed(2));
    rows = [["Employee", "Total Punches", "Total Breaks", "Regular Hours", "Overtime Hours", "Total Hours", "Total Unpaid Break Hours", "Total Unpaid Break Minutes", ...payHeaders, "Period Start", "Period End", "Time Zone"],
      ...report.groups.map((g) => [g.name, ...countsAndHours(g), ...pay(g), ...scope]),
      ["PERIOD TOTAL", ...countsAndHours(report.totals), ...pay(report.totals), ...scope]];
  } else {
    const breakCount = Math.max(0, ...report.punches.map((p) => (p.breaks || []).length));
    const breakHeaders = Array.from({ length: breakCount }, (_, i) => [`Break ${i + 1} Start`, `Break ${i + 1} End`, `Break ${i + 1} Minutes`]).flat();
    rows = [["Employee", "Date", "Clock In", "Clock Out", "Regular Hours", "Overtime Hours", "Total Hours", "Total Breaks", "Total Unpaid Break Hours", "Total Unpaid Break Minutes", ...breakHeaders, "Role", "Approval", "Punch ID", "Period Start", "Period End", "Time Zone"],
      ...[...report.punches].sort((a, b) => a.employee_name.localeCompare(b.employee_name) || a.clock_in.localeCompare(b.clock_in)).map((p) => {
        const breaks = [...(p.breaks || [])].sort((a, b) => String(a.start).localeCompare(String(b.start)));
        const values = Array.from({ length: breakCount }, (_, i) => breaks[i] ? [formatStoreDateTimeCsv(breaks[i].start), formatStoreDateTimeCsv(breaks[i].end), breaks[i].minutes] : ["", "", ""]).flat();
        return [p.employee_name, p.date, p.clock_in_csv, p.clock_out_csv, hours(p.regular_minutes), hours(p.overtime_minutes), hours(p.worked_minutes), breaks.length, hours(p.break_minutes), p.break_minutes, ...values, p.role, "Cleared", p.id, ...scope];
      })];
  }
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
