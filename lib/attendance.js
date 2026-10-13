import { STORE_ID } from "./constants";
import { fetchEmployees } from "./employees";
import {
  SCHEDULE_STORE_ID,
  findEmployeeForShift,
  formatClock,
  isUnassignedShift,
  normalizeTime,
  timeToMinutes,
} from "./schedule";
import { addDaysISO, getStoreToday, storeWallClockToDate } from "./store-time";
import { buildAttendanceReport, attendanceEventKey } from "./attendance-records";
import { loadAttendanceSources } from "./attendance-data";

export const ATTENDANCE_STORE_ID = SCHEDULE_STORE_ID;

export const DEFAULT_ATTENDANCE_SETTINGS = {
  grace_minutes_late: 10,
  grace_minutes_early_in: 10,
  grace_minutes_early_out: 10,
  require_face_on_clock_in: true,
  require_photo_on_clock_out: true,
  subtract_scheduled_break: true,
  use_break_punches: true,
  breaks_are_paid: false,
};

export const EVENT_TYPES = [
  "late",
  "clock_in_early",
  "left_early",
  "early_out",
  "no_show",
  "call_out",
  "unscheduled",
];

export const EVENT_TYPE_LABELS = {
  late: "Late",
  clock_in_early: "Clocked in early",
  left_early: "Left early",
  early_out: "Left early",
  no_show: "No show",
  call_out: "Call-out",
  unscheduled: "Unscheduled",
};

const PUNCH_FLAG_TYPES = ["late", "clock_in_early", "left_early", "unscheduled"];

function asInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

export function scheduledStartDate(shift) {
  if (!shift) return null;
  return storeWallClockToDate(shift.shift_date, shift.scheduled_start);
}

export function scheduledEndDate(shift) {
  if (!shift) return null;
  const startMin = timeToMinutes(shift.scheduled_start);
  const endMin = timeToMinutes(shift.scheduled_end);
  let date = shift.shift_date;
  if (Number.isFinite(startMin) && Number.isFinite(endMin) && endMin <= startMin) {
    date = addDaysISO(shift.shift_date, 1);
  }
  return storeWallClockToDate(date, shift.scheduled_end);
}

function isMissingColumnError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /column|schema cache|could not find/i.test(msg);
}

function normalizeSettingsRow(data) {
  const defaults = { ...DEFAULT_ATTENDANCE_SETTINGS };
  if (!data) return defaults;
  return {
    grace_minutes_late: asInt(data.grace_minutes_late, defaults.grace_minutes_late),
    grace_minutes_early_in: asInt(data.grace_minutes_early_in, defaults.grace_minutes_early_in),
    grace_minutes_early_out: asInt(data.grace_minutes_early_out, defaults.grace_minutes_early_out),
    require_face_on_clock_in: data.require_face_on_clock_in !== false,
    require_photo_on_clock_out: data.require_photo_on_clock_out !== false,
    subtract_scheduled_break: data.subtract_scheduled_break !== false,
    use_break_punches: data.use_break_punches !== false,
    breaks_are_paid: Boolean(data.breaks_are_paid),
    updated_at: data.updated_at || null,
  };
}

export async function getAttendanceSettings(supabase) {
  const selects = [
    "store_id, grace_minutes_late, grace_minutes_early_in, grace_minutes_early_out, require_face_on_clock_in, require_photo_on_clock_out, subtract_scheduled_break, use_break_punches, breaks_are_paid, updated_at",
    "store_id, grace_minutes_late, grace_minutes_early_in, grace_minutes_early_out, require_face_on_clock_in, require_photo_on_clock_out, subtract_scheduled_break, updated_at",
  ];
  for (const storeId of [ATTENDANCE_STORE_ID, STORE_ID]) {
    for (const select of selects) {
      const { data, error } = await supabase
        .from("attendance_settings")
        .select(select)
        .eq("store_id", storeId)
        .maybeSingle();
      if (error) {
        if (isMissingColumnError(error)) continue;
        throw error;
      }
      if (data) return normalizeSettingsRow(data);
    }
  }
  return { ...DEFAULT_ATTENDANCE_SETTINGS };
}

export async function saveAttendanceSettings(supabase, patch) {
  const current = await getAttendanceSettings(supabase);
  const next = {
    store_id: ATTENDANCE_STORE_ID,
    grace_minutes_late: asInt(patch.grace_minutes_late, current.grace_minutes_late),
    grace_minutes_early_in: asInt(patch.grace_minutes_early_in, current.grace_minutes_early_in),
    grace_minutes_early_out: asInt(patch.grace_minutes_early_out, current.grace_minutes_early_out),
    require_face_on_clock_in:
      patch.require_face_on_clock_in !== undefined
        ? Boolean(patch.require_face_on_clock_in)
        : current.require_face_on_clock_in,
    require_photo_on_clock_out:
      patch.require_photo_on_clock_out !== undefined
        ? Boolean(patch.require_photo_on_clock_out)
        : current.require_photo_on_clock_out,
    subtract_scheduled_break:
      patch.subtract_scheduled_break !== undefined
        ? Boolean(patch.subtract_scheduled_break)
        : current.subtract_scheduled_break,
    use_break_punches:
      patch.use_break_punches !== undefined
        ? Boolean(patch.use_break_punches)
        : current.use_break_punches,
    breaks_are_paid: false,
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase
    .from("attendance_settings")
    .select("store_id")
    .eq("store_id", ATTENDANCE_STORE_ID)
    .maybeSingle();

  async function write(payload) {
    if (existing) {
      const { error } = await supabase
        .from("attendance_settings")
        .update(payload)
        .eq("store_id", ATTENDANCE_STORE_ID);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("attendance_settings").insert(payload);
      if (error) throw error;
    }
  }

  try {
    await write(next);
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    const { use_break_punches: _u, breaks_are_paid: _b, ...legacy } = next;
    await write(legacy);
  }
  return getAttendanceSettings(supabase);
}

async function findEvent(supabase, { event_type, punch_id, shift_id }) {
  let query = supabase
    .from("attendance_events")
    .select("id, auto_generated, note")
    .eq("store_id", ATTENDANCE_STORE_ID)
    .eq("event_type", event_type)
    .limit(8);
  if (punch_id) query = query.eq("punch_id", punch_id);
  else if (shift_id) query = query.eq("shift_id", shift_id);
  else return null;
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  return rows.find((row) => row.auto_generated) || rows[0] || null;
}

async function upsertAutoEvent(supabase, event) {
  const existing = await findEvent(supabase, { ...event, punch_id: event.shift_id ? null : event.punch_id });
  if (existing && existing.auto_generated === false) return existing.id;
  const payload = {
    employee_id: event.employee_id || null,
    employee_name: event.employee_name || null,
    event_date: event.event_date,
    event_type: event.event_type,
    shift_id: event.shift_id || null,
    punch_id: event.punch_id || null,
    minutes_delta:
      event.minutes_delta == null || event.minutes_delta === ""
        ? null
        : Math.max(0, Math.round(Number(event.minutes_delta))),
    auto_generated: true,
    store_id: ATTENDANCE_STORE_ID,
  };
  if (existing) {
    const { error } = await supabase
      .from("attendance_events")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { error } = await supabase.from("attendance_events").insert({ ...payload, note: null });
  if (error) throw error;
  return true;
}

async function deleteAutoEvent(supabase, { event_type, punch_id, shift_id }) {
  const existing = await findEvent(supabase, { event_type, punch_id, shift_id });
  if (!existing || existing.auto_generated === false || existing.note) return;
  const { error } = await supabase.from("attendance_events").delete().eq("id", existing.id);
  if (error) throw error;
}

// Both scans and the workspace derive attendance from the same current evidence.
// Payroll punches are deliberately read-only: missing schedule links are resolved
// in the attendance projection, without changing approved timecard snapshots.
export async function attendanceReport(supabase, from, to, options = {}) {
  const [source, settings] = await Promise.all([
    loadAttendanceSources(supabase, from, to, options.now),
    options.settings || getAttendanceSettings(supabase),
  ]);
  return { source, report: buildAttendanceReport({ ...source, settings }) };
}

async function reconcileAttendance(supabase, from, to, options = {}) {
  const { source, report } = await attendanceReport(supabase, from, to, options);
  const desired = report.autoEvents.filter(event => !options.noShowsOnly || event.event_type === "no_show");
  const keys = new Set(desired.map(attendanceEventKey));
  const fields = ['employee_id', 'employee_name', 'event_date', 'event_type', 'shift_id', 'punch_id', 'minutes_delta'];
  for (const event of desired) {
    const existing = source.events.find(old => attendanceEventKey(old) === attendanceEventKey(event));
    if (existing && (existing.auto_generated === false || fields.every(key => (existing[key] ?? null) === (event[key] ?? null)))) continue;
    await upsertAutoEvent(supabase, event);
  }
  for (const old of source.events) {
    if (!old.auto_generated || old.event_date < report.from || old.event_date > report.to) continue;
    if (options.noShowsOnly && old.event_type !== "no_show") continue;
    // Keep a manager's note available in history even after its automatic flag
    // stops applying. GET never counts these obsolete flags.
    if (!keys.has(attendanceEventKey(old)) && !old.note) {
      const { error } = await supabase.from("attendance_events").delete()
        .eq("store_id", ATTENDANCE_STORE_ID).eq("id", old.id).eq("auto_generated", true).is("note", null);
      if (error) throw error;
    }
  }
  return { punches: source.punches.length, noShows: report.autoEvents.filter(e => e.event_type === "no_show").length, from: report.from, to: report.to };
}

export async function evaluatePunchFlags(supabase, punch, options = {}) {
  if (!punch?.clock_in) return;
  const day = getStoreToday(new Date(punch.clock_in));
  return reconcileAttendance(supabase, addDaysISO(day, -1), day, options);
}

export async function evaluatePunchAndSweep(supabase, punch) {
  await evaluatePunchFlags(supabase, punch);
  const today = getStoreToday();
  const punchDay = punch?.clock_in ? getStoreToday(new Date(punch.clock_in)) : null;
  if (punchDay !== today) await sweepNoShows(supabase, addDaysISO(today, -1), today);
}

function employeeForShift(shift, employees) {
  return findEmployeeForShift(employees, shift);
}

export async function sweepNoShows(supabase, fromDate, toDate, options = {}) {
  const result = await reconcileAttendance(supabase, fromDate, toDate, { ...options, noShowsOnly: true });
  return { created: result.noShows };
}

export async function rescanAttendance(supabase, fromDate, toDate) {
  return reconcileAttendance(supabase, fromDate, toDate);
}

export async function saveGeneratedAttendanceNote(supabase, input) {
  const { source, report } = await attendanceReport(supabase, input.event_date, input.event_date);
  const current = report.autoEvents.find(event => attendanceEventKey(event) === attendanceEventKey(input) && event.employee_id === input.employee_id);
  if (!current) throw new Error('This attendance flag has changed. Refresh attendance before adding a note.');
  const existing = source.events.find(event => attendanceEventKey(event) === attendanceEventKey(current));
  const note = String(input.note || '').trim().slice(0, 2000) || null;
  if (existing) {
    const { error } = await supabase.from('attendance_events').update({ note }).eq('store_id', ATTENDANCE_STORE_ID).eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await supabase.from('attendance_events').insert({ ...current, store_id: ATTENDANCE_STORE_ID, note }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function createManualEvent(supabase, input, actorName = "") {
  const eventType = normalizeEventType(String(input.event_type || "").trim());
  if (!EVENT_TYPE_LABELS[eventType]) throw new Error("Unknown event type.");
  const eventDate = String(input.event_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new Error("Date is required.");
  const note = String(input.note || "").trim() || null;

  let shiftId = input.shift_id || null;
  let employeeId = input.employee_id || null;
  let employeeName = String(input.employee_name || "").trim();

  if (employeeId && !employeeName) {
    const { data: emp } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("id", employeeId)
      .maybeSingle();
    if (emp) employeeName = `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
  }

  if (eventType === "call_out" && !shiftId && employeeName) {
    const { data: shifts } = await supabase
      .from("schedule_shifts")
      .select("id, employee_id, employee_name, jolt_employee_id")
      .eq("store_id", ATTENDANCE_STORE_ID)
      .eq("shift_date", eventDate);
    const employees = await fetchEmployees(supabase, {
      storeId: STORE_ID,
      select: "id, first_name, last_name, jolt_employee_id",
    });
    const emp = employees.find((row) => row.id === employeeId) || null;
    const match = (shifts || []).find((shift) => {
      if (employeeId && shift.employee_id && String(shift.employee_id) === String(employeeId)) return true;
      if (emp && findEmployeeForShift([emp], shift)) return true;
      return false;
    });
    if (match) shiftId = match.id;
  }

  if (eventType === "call_out" && shiftId) {
    await deleteAutoEvent(supabase, { event_type: "no_show", shift_id: shiftId });
  }

  const existing = await findEvent(supabase, {
    event_type: eventType,
    punch_id: input.punch_id || null,
    shift_id: shiftId,
  });
  if (existing && (input.punch_id || shiftId)) {
    const { error } = await supabase
      .from("attendance_events")
      .update({
        note: note || existing.note,
        employee_id: employeeId,
        employee_name: employeeName,
        event_date: eventDate,
        auto_generated: false,
      })
      .eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await supabase
    .from("attendance_events")
    .insert({
      employee_id: employeeId,
      employee_name: employeeName,
      event_date: eventDate,
      event_type: eventType,
      shift_id: shiftId,
      punch_id: input.punch_id || null,
      minutes_delta: input.minutes_delta ?? null,
      auto_generated: false,
      note: note ? (actorName ? `${note} (added by ${actorName})` : note) : actorName ? `Added by ${actorName}` : null,
      store_id: ATTENDANCE_STORE_ID,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function markShiftCallOut(supabase, shiftId, actorName = "") {
  const { data: shift, error } = await supabase
    .from("schedule_shifts")
    .select("id, shift_date, employee_id, employee_name, jolt_employee_id, scheduled_start, scheduled_end")
    .eq("id", shiftId)
    .eq("store_id", ATTENDANCE_STORE_ID)
    .maybeSingle();
  if (error) throw error;
  if (!shift) throw new Error("Shift not found.");
  if (isUnassignedShift(shift)) throw new Error("Assign the shift before marking a call-out.");

  const employees = await fetchEmployees(supabase, {
    storeId: STORE_ID,
    select: "id, first_name, last_name, jolt_employee_id",
  });
  const emp = employeeForShift(shift, employees);
  await deleteAutoEvent(supabase, { event_type: "no_show", shift_id: shift.id });
  return createManualEvent(
    supabase,
    {
      event_type: "call_out",
      event_date: shift.shift_date,
      employee_id: shift.employee_id || emp?.id || null,
      employee_name: shift.employee_name,
      shift_id: shift.id,
      note: `Call-out · ${formatClock(shift.scheduled_start)} – ${formatClock(shift.scheduled_end)}`,
    },
    actorName
  );
}

export function displayShiftLabel(shift) {
  if (!shift) return "—";
  const when = `${formatClock(shift.scheduled_start)} – ${formatClock(shift.scheduled_end)}`;
  const extra = [shift.role, shift.station].filter(Boolean).join(" · ");
  return extra ? `${when} · ${extra}` : when;
}

export function normalizeEventType(type) {
  if (type === "early_out") return "left_early";
  return type;
}

export { normalizeTime, PUNCH_FLAG_TYPES };
