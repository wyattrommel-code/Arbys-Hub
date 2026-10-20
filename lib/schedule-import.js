import { fetchEmployees } from "./employees";
import { computeScheduledHours, formatLongDate, nameKey, SCHEDULE_STORE_ID, weekStartSunday } from "./schedule";

// Jolt exports can contain quoted commas/newlines in fields we do not import.
function csvRecords(text) {
  const records = [];
  let cells = [], cell = "", quoted = false;
  const input = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      cells.push(cell);
      if (cells.some((value) => value.trim())) records.push(cells);
      cells = []; cell = "";
      if (char === "\r" && input[i + 1] === "\n") i += 1;
    } else cell += char;
  }
  if (quoted) throw new Error("The CSV contains an unfinished quoted field. Please export it again.");
  cells.push(cell);
  if (cells.some((value) => value.trim())) records.push(cells);
  return records;
}

function parseTime(raw) {
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::00)?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > (match[3] ? 12 : 23) || (match[3] && hour < 1)) return null;
  if (match[3]) hour = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2]}:00`;
}

function employeeName(employee) {
  return employee.full_name?.trim() || `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function resolveEmployee(roster, name, externalId) {
  const active = roster.filter((employee) => employee.is_active !== false);
  const byExternalId = externalId ? active.filter((employee) => employee.jolt_employee_id === externalId) : [];
  const matches = byExternalId.length ? byExternalId : active.filter((employee) => nameKey(employeeName(employee)) === nameKey(name));
  if (matches.length > 1) throw new Error(`More than one active profile matches ${name}. Resolve the duplicate profile before importing.`);
  if (!matches[0]?.id) throw new Error(`No active employee matches ${name}. Check their name and active status in People before importing.`);
  return matches[0];
}

const timeKey = (value) => String(value).slice(0, 5);
const shiftKey = (row) => JSON.stringify([row.store_id, row.employee_id, row.shift_date, timeKey(row.scheduled_start)]);
const importedFields = ["employee_id", "employee_name", "jolt_employee_id", "shift_date", "week_start_date", "role", "store_id"];
function sameShift(a, b) {
  return importedFields.every((key) => (a[key] || null) === (b[key] || null)) &&
    timeKey(a.scheduled_start) === timeKey(b.scheduled_start) && timeKey(a.scheduled_end) === timeKey(b.scheduled_end) &&
    Number(a.scheduled_hours) === Number(b.scheduled_hours) && Number(a.unpaid_break_minutes || 0) === Number(b.unpaid_break_minutes || 0);
}

// Stable import IDs make retrying a request safe without a composite UNIQUE
// constraint: the builder deliberately permits multiple shifts in one cell.
async function importId(row) {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`jolt-schedule-v1:${shiftKey(row)}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function prepareScheduleImport(csvText, roster, storeId = SCHEDULE_STORE_ID) {
  const [headers, ...records] = csvRecords(csvText);
  if (!headers) throw new Error("CSV file is empty.");
  const columns = new Map(headers.map((header, index) => [header.trim(), index]));
  const required = ["Role", "Employee", "Employee Id", "Date", "Time In", "Time Out", "Hours"];
  const missing = required.filter((name) => !columns.has(name));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);
  const byKey = new Map();
  let skippedSystemCount = 0, duplicateCount = 0;
  for (const [index, cells] of records.entries()) {
    const get = (column) => String(cells[columns.get(column)] || "").trim();
    const name = get("Employee");
    if (["joshua api", "store ."].includes(nameKey(name))) { skippedSystemCount += 1; continue; }
    const rowLabel = `Row ${index + 2}${name ? ` (${name})` : ""}`;
    if (!name) throw new Error(`${rowLabel}: employee name is missing.`);
    const date = get("Date");
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error(`${rowLabel}: invalid shift date.`);
    }
    const start = parseTime(get("Time In")), end = parseTime(get("Time Out"));
    if (!start || !end || start === end) throw new Error(`${rowLabel}: check the shift start and end times.`);
    const rawBreak = get("Break Time");
    if (rawBreak && !/^\d+\s*(?:min(?:ute)?s?)?$/i.test(rawBreak)) throw new Error(`${rowLabel}: break time must be whole minutes.`);
    const breakMinutes = rawBreak ? Number.parseInt(rawBreak, 10) : 0;
    const durationMinutes = Math.round(computeScheduledHours(start, end) * 60);
    if (breakMinutes > durationMinutes) throw new Error(`${rowLabel}: break time exceeds the shift length.`);
    const employee = resolveEmployee(roster, name, get("Employee Id"));
    const row = {
      employee_id: employee.id,
      employee_name: employeeName(employee),
      jolt_employee_id: get("Employee Id") || employee.jolt_employee_id || null,
      shift_date: date, week_start_date: weekStartSunday(date), store_id: storeId,
      scheduled_start: start, scheduled_end: end,
      unpaid_break_minutes: breakMinutes,
      scheduled_hours: computeScheduledHours(start, end, breakMinutes),
      role: get("Role") || null,
    };
    const existing = byKey.get(shiftKey(row));
    if (existing) {
      if (!sameShift(existing, row)) throw new Error(`${rowLabel}: conflicting shifts share the same employee and start time. Review the CSV before importing.`);
      duplicateCount += 1;
    } else byKey.set(shiftKey(row), row);
  }
  const rows = await Promise.all([...byKey.values()].map(async (row) => ({ ...row, id: await importId(row) })));
  if (!rows.length) throw new Error("No employee shifts were found in this file.");
  const days = [...new Set(rows.map((row) => row.shift_date))].sort();
  return { rows, summary: {
    importedCount: rows.length, skippedSystemCount, duplicateCount,
    daysCovered: days.length, employeesScheduled: new Set(rows.map((row) => row.employee_id)).size,
    dateRange: { start: days[0], end: days.at(-1) },
  } };
}

export function planScheduleImport(rows, existingShifts, weeks = []) {
  const existingById = new Map(existingShifts.map((row) => [row.id, row]));
  const existingByKey = new Map();
  for (const row of existingById.values()) {
    const key = shiftKey(row);
    existingByKey.set(key, [...(existingByKey.get(key) || []), row]);
  }
  const writes = [];
  let addedCount = 0, updatedCount = 0, unchangedCount = 0;
  for (const row of rows) {
    const importedBefore = existingById.get(row.id);
    if (importedBefore && shiftKey(importedBefore) !== shiftKey(row)) {
      throw new Error(`${row.employee_name}'s shift on ${formatLongDate(row.shift_date)} has been moved or reassigned in the Hub. Review it in Schedule Builder before reimporting.`);
    }
    const matches = existingByKey.get(shiftKey(row)) || [];
    if (matches.length > 1) throw new Error(`${row.employee_name} has multiple shifts with this start time on ${formatLongDate(row.shift_date)}. Review them in Schedule Builder before importing.`);
    const existing = matches[0];
    if (existing && sameShift(existing, row)) { unchangedCount += 1; continue; }
    if (weeks.some((week) => week.store_id === row.store_id && week.week_start_date === row.week_start_date && week.status === "published")) {
      throw new Error(`The week of ${formatLongDate(row.week_start_date)} is published. Unlock it in Schedule Builder before importing changes.`);
    }
    writes.push({ ...row, id: existing?.id || row.id, station: existing?.station || null, notes: existing?.notes || null, source: existing?.source || "jolt_import" });
    if (existing) updatedCount += 1;
    else addedCount += 1;
  }
  return { writes, addedCount, updatedCount, unchangedCount };
}

export async function importScheduleCsv(supabase, csvText) {
  const roster = await fetchEmployees(supabase, { select: "id, first_name, last_name, full_name, jolt_employee_id, is_active" });
  const prepared = await prepareScheduleImport(csvText, roster);
  const existing = [];
  // Read every row, including large exports; never assume the REST page is complete.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("schedule_shifts").select("*")
      .eq("store_id", SCHEDULE_STORE_ID).gte("shift_date", prepared.summary.dateRange.start).lte("shift_date", prepared.summary.dateRange.end)
      .order("id").range(offset, offset + 499);
    if (error) throw error;
    existing.push(...(data || []));
    if ((data || []).length < 500) break;
  }
  // Also find previously imported shifts moved outside this date range.
  for (let index = 0; index < prepared.rows.length; index += 100) {
    const { data, error } = await supabase.from("schedule_shifts").select("*").eq("store_id", SCHEDULE_STORE_ID)
      .in("id", prepared.rows.slice(index, index + 100).map((row) => row.id));
    if (error) throw error;
    existing.push(...(data || []));
  }
  const { data: weeks, error: weekError } = await supabase.from("schedule_weeks").select("week_start_date,store_id,status")
    .eq("store_id", SCHEDULE_STORE_ID).gte("week_start_date", weekStartSunday(prepared.summary.dateRange.start))
    .lte("week_start_date", weekStartSunday(prepared.summary.dateRange.end));
  if (weekError) throw weekError;
  const plan = planScheduleImport(prepared.rows, existing, weeks || []);
  if (plan.writes.length) {
    // Preserve IDs referenced by punches/offers. The only required unique key is id.
    const { error } = await supabase.from("schedule_shifts").upsert(plan.writes, { onConflict: "id" });
    if (error) throw error;
  }
  return { rows: prepared.rows, summary: { ...prepared.summary, addedCount: plan.addedCount, updatedCount: plan.updatedCount, unchangedCount: plan.unchangedCount } };
}
