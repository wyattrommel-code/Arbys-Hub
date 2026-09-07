import { PUNCH_PHOTOS_BUCKET, STORE_ID } from "./constants";
import { employeeFullName, fetchEmployeeByPin } from "./employees";
import { isGmOrAssistantManager, normalizeRole } from "./permissions";
import { SCHEDULE_STORE_ID, timeToMinutes, unpaidBreakMinutes } from "./schedule";
import { addDaysISO, getStoreMinutes, getStoreToday } from "./store-time";
import { getAttendanceSettings } from "./attendance";

/** Attendance / punches live on the schedule store id. */
export const CLOCK_STORE_ID = SCHEDULE_STORE_ID;

export { getAttendanceSettings };

const CLOCK_EMPLOYEE_SELECTS = [
  "id, first_name, last_name, role, is_manager, is_assistant_manager, is_shift_lead, jolt_employee_id, is_active",
  "id, first_name, last_name, role, is_assistant_manager, is_shift_lead, jolt_employee_id, is_active",
  "id, first_name, last_name, role, is_shift_lead, jolt_employee_id, is_active",
  "id, first_name, last_name, role, is_active",
];

let brookelynnChecked = false;

function isMissingColumnError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /column|schema cache|could not find/i.test(msg);
}

export function parsePin(value) {
  const pin = String(value || "").trim();
  return /^\d{4}$/.test(pin) ? pin : null;
}

export function clockEmployeeName(emp) {
  if (!emp) return "";
  if (emp.full_name) return String(emp.full_name).trim();
  return employeeFullName(emp);
}

/**
 * Unscheduled-work override: GM or assistant manager only.
 * Shift leads cannot authorize even if is_manager is set.
 */
export function canAuthorizeUnscheduled(emp) {
  if (!emp) return false;
  const role = normalizeRole(emp.role);
  if (role === "shift_lead") return false;
  if (isGmOrAssistantManager(role)) return true;
  if (emp.is_assistant_manager) return true;
  if (emp.is_manager) return true;
  return false;
}

export { computeWorkedMinutes } from "./timecards";

export function formatWorkedHoursLabel(workedMinutes) {
  const hrs = Number(workedMinutes) / 60;
  if (!Number.isFinite(hrs) || hrs < 0) return "0.0 hrs";
  return `${hrs.toFixed(1)} hrs`;
}

export async function fetchClockEmployeeByPin(supabase, pin) {
  const parsed = parsePin(pin);
  if (!parsed) return null;
  let lastError = null;
  for (const select of CLOCK_EMPLOYEE_SELECTS) {
    try {
      const row = await fetchEmployeeByPin(supabase, parsed, STORE_ID, select);
      return row;
    } catch (err) {
      lastError = err;
      if (!isMissingColumnError(err)) throw err;
    }
  }
  if (lastError) throw lastError;
  return null;
}

/**
 * One-time roster fix: Brookelynn Rommel → assistant_manager unless she is already GM.
 */
export async function ensureBrookelynnAssistantManager(supabase) {
  if (brookelynnChecked) return;
  brookelynnChecked = true;
  try {
    const { data, error } = await supabase
      .from("employees")
      .select("id, first_name, last_name, role, is_assistant_manager")
      .eq("store_id", STORE_ID)
      .ilike("first_name", "Brookelynn")
      .ilike("last_name", "Rommel")
      .limit(1)
      .maybeSingle();
    if (error) {
      if (!isMissingColumnError(error)) {
        brookelynnChecked = false;
      }
      return;
    }
    if (!data) return;
    if (normalizeRole(data.role) === "gm") return;
    if (normalizeRole(data.role) === "assistant_manager" && data.is_assistant_manager) return;
    const { error: upErr } = await supabase
      .from("employees")
      .update({ role: "assistant_manager", is_assistant_manager: true })
      .eq("id", data.id);
    if (upErr && isMissingColumnError(upErr)) {
      await supabase.from("employees").update({ role: "assistant_manager" }).eq("id", data.id);
    }
  } catch {
    brookelynnChecked = false;
  }
}

function namesMatch(shiftName, employee) {
  const target = clockEmployeeName(employee).toLowerCase().replace(/\s+/g, " ").trim();
  const row = String(shiftName || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!target || !row || row === "unassigned") return false;
  if (row === target) return true;
  const last = String(employee.last_name || "")
    .toLowerCase()
    .trim();
  const rowLast = row.split(/\s+/).pop() || "";
  return Boolean(last && (rowLast === last || rowLast.includes(last) || last.includes(rowLast)));
}

export function shiftBelongsToEmployee(shift, employee) {
  if (!shift || !employee) return false;
  const joltEmp = employee.jolt_employee_id != null ? String(employee.jolt_employee_id) : "";
  const joltShift = shift.jolt_employee_id != null ? String(shift.jolt_employee_id) : "";
  if (joltEmp && joltShift && joltEmp === joltShift) return true;
  return namesMatch(shift.employee_name, employee);
}

function isOvernightShift(shift) {
  const start = timeToMinutes(shift.scheduled_start);
  const end = timeToMinutes(shift.scheduled_end);
  return Number.isFinite(start) && Number.isFinite(end) && end <= start;
}

export async function fetchTodaysShiftsForEmployee(supabase, employee, now = new Date()) {
  const today = getStoreToday(now);
  const yesterday = addDaysISO(today, -1);
  const { data, error } = await supabase
    .from("schedule_shifts")
    .select(
      "id, shift_date, employee_name, jolt_employee_id, scheduled_start, scheduled_end, unpaid_break_minutes, role, station"
    )
    .eq("store_id", CLOCK_STORE_ID)
    .in("shift_date", [yesterday, today]);
  if (error) throw error;

  const nowMins = getStoreMinutes(now);
  return (data || []).filter((shift) => {
    if (!shiftBelongsToEmployee(shift, employee)) return false;
    if (shift.shift_date === today) return true;
    return isOvernightShift(shift) && nowMins < (timeToMinutes(shift.scheduled_end) ?? 0) + 180;
  });
}

export async function fetchRecentPunches(supabase, employeeId) {
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("time_punches")
    .select("id, shift_id, status, clock_in, clock_out")
    .eq("employee_id", employeeId)
    .gte("clock_in", since)
    .order("clock_in", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchOpenPunch(supabase, employeeId) {
  const { data, error } = await supabase
    .from("time_punches")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("status", "open")
    .order("clock_in", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export function pickClockInShift(shifts, punches, now = new Date()) {
  const used = new Set((punches || []).map((p) => p.shift_id).filter(Boolean));
  const available = (shifts || []).filter((s) => !used.has(s.id));
  if (!available.length) return null;
  if (available.length === 1) return available[0];

  const nowMins = getStoreMinutes(now);
  const scored = available.map((shift) => {
    const start = timeToMinutes(shift.scheduled_start);
    const end = timeToMinutes(shift.scheduled_end);
    let startAdj = start;
    let endAdj = end;
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) endAdj += 24 * 60;
    let n = nowMins;
    if (Number.isFinite(startAdj) && Number.isFinite(endAdj) && n < startAdj - 180 && endAdj > 24 * 60) {
      n += 24 * 60;
    }
    const inWindow =
      Number.isFinite(startAdj) &&
      Number.isFinite(endAdj) &&
      n >= startAdj - 120 &&
      n <= endAdj + 120;
    const dist = Number.isFinite(start) ? Math.abs(nowMins - start) : 9999;
    return { shift, inWindow, dist };
  });
  scored.sort((a, b) => Number(b.inWindow) - Number(a.inWindow) || a.dist - b.dist);
  return scored[0].shift;
}

export function publicSettings(settings) {
  return {
    require_face_on_clock_in: Boolean(settings?.require_face_on_clock_in),
    require_photo_on_clock_out: Boolean(settings?.require_photo_on_clock_out),
  };
}

export function serializeShift(shift) {
  if (!shift) return null;
  return {
    id: shift.id,
    scheduled_start: shift.scheduled_start,
    scheduled_end: shift.scheduled_end,
    unpaid_break_minutes: unpaidBreakMinutes(shift.unpaid_break_minutes),
    role: shift.role || null,
    station: shift.station || null,
  };
}

export function serializeEmployee(emp) {
  return {
    id: emp.id,
    first_name: emp.first_name,
    last_name: emp.last_name,
    name: clockEmployeeName(emp),
  };
}

/**
 * Public read is fine for now; tighten later alongside the known PIN-auth security item.
 */
export async function ensurePunchPhotosBucket(supabase) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  if ((buckets || []).some((b) => b.name === PUNCH_PHOTOS_BUCKET)) return;
  const { error: createErr } = await supabase.storage.createBucket(PUNCH_PHOTOS_BUCKET, {
    public: true,
    fileSizeLimit: 6 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
  });
  if (createErr && !/already exists|duplicate/i.test(createErr.message || "")) {
    throw createErr;
  }
}

export async function uploadPunchPhoto(supabase, employeeId, file) {
  await ensurePunchPhotosBucket(supabase);
  const path = `${CLOCK_STORE_ID}/${employeeId}/${Date.now()}.jpg`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from(PUNCH_PHOTOS_BUCKET).upload(path, buffer, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(PUNCH_PHOTOS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function readPhotoFromRequest(request) {
  const formData = await request.formData();
  const pin = formData.get("pin");
  const managerPin = formData.get("manager_pin");
  const faceDetectedRaw = formData.get("face_detected");
  const file = formData.get("file");
  const photo =
    file && typeof file !== "string" && typeof file.arrayBuffer === "function" ? file : null;
  return {
    pin: String(pin || ""),
    managerPin: String(managerPin || ""),
    faceDetected: String(faceDetectedRaw || "") === "true",
    photo,
  };
}
