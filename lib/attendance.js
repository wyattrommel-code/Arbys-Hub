import { STORE_ID } from "./constants";
import { fetchEmployees, matchesEmployeeByName } from "./employees";
import {
  SCHEDULE_STORE_ID,
  formatClock,
  isUnassignedName,
  normalizeTime,
  timeToMinutes,
} from "./schedule";
import { addDaysISO, getStoreToday, storeWallClockToDate } from "./store-time";

export const ATTENDANCE_STORE_ID = SCHEDULE_STORE_ID;

export const DEFAULT_ATTENDANCE_SETTINGS = {
  grace_minutes_late: 10,
  grace_minutes_early_in: 10,
  grace_minutes_early_out: 10,
  require_face_on_clock_in: true,
  require_photo_on_clock_out: false,
  subtract_scheduled_break: true,
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

function minutesBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / 60000;
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

export async function getAttendanceSettings(supabase) {
  const defaults = { ...DEFAULT_ATTENDANCE_SETTINGS };
  for (const storeId of [ATTENDANCE_STORE_ID, STORE_ID]) {
    const { data, error } = await supabase
      .from("attendance_settings")
      .select(
        "store_id, grace_minutes_late, grace_minutes_early_in, grace_minutes_early_out, require_face_on_clock_in, require_photo_on_clock_out, subtract_scheduled_break, updated_at"
      )
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      return {
        grace_minutes_late: asInt(data.grace_minutes_late, defaults.grace_minutes_late),
        grace_minutes_early_in: asInt(data.grace_minutes_early_in, defaults.grace_minutes_early_in),
        grace_minutes_early_out: asInt(data.grace_minutes_early_out, defaults.grace_minutes_early_out),
        require_face_on_clock_in: data.require_face_on_clock_in !== false,
        require_photo_on_clock_out: Boolean(data.require_photo_on_clock_out),
        subtract_scheduled_break: data.subtract_scheduled_break !== false,
        updated_at: data.updated_at || null,
      };
    }
  }
  return defaults;
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
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase
    .from("attendance_settings")
    .select("store_id")
    .eq("store_id", ATTENDANCE_STORE_ID)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("attendance_settings")
      .update(next)
      .eq("store_id", ATTENDANCE_STORE_ID);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("attendance_settings").insert(next);
    if (error) throw error;
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
  const existing = await findEvent(supabase, event);
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
  if (!existing || existing.auto_generated === false) return;
  const { error } = await supabase.from("attendance_events").delete().eq("id", existing.id);
  if (error) throw error;
}

function punchEventDate(punch, shift) {
  if (shift?.shift_date) return shift.shift_date;
  if (punch?.clock_in) return getStoreToday(new Date(punch.clock_in));
  return getStoreToday();
}

export async function evaluatePunchFlags(supabase, punch, options = {}) {
  if (!punch) return;
  const settings = options.settings || (await getAttendanceSettings(supabase));
  const unscheduled = punch.unscheduled === true || !punch.shift_id;

  if (unscheduled) {
    await upsertAutoEvent(supabase, {
      employee_id: punch.employee_id,
      employee_name: punch.employee_name,
      event_date: punchEventDate(punch, null),
      event_type: "unscheduled",
      shift_id: null,
      punch_id: punch.id,
      minutes_delta: null,
    });
    for (const type of ["late", "clock_in_early", "left_early"]) {
      await deleteAutoEvent(supabase, { event_type: type, punch_id: punch.id });
    }
    return;
  }

  await deleteAutoEvent(supabase, { event_type: "unscheduled", punch_id: punch.id });

  let shift = options.shift || null;
  if (!shift) {
    const { data, error } = await supabase
      .from("schedule_shifts")
      .select(
        "id, shift_date, employee_name, jolt_employee_id, scheduled_start, scheduled_end, role, station"
      )
      .eq("id", punch.shift_id)
      .maybeSingle();
    if (error) throw error;
    shift = data;
  }
  if (!shift) return;

  const start = scheduledStartDate(shift);
  const end = scheduledEndDate(shift);
  const clockIn = punch.clock_in ? new Date(punch.clock_in) : null;
  const clockOut = punch.clock_out ? new Date(punch.clock_out) : null;
  const wanted = new Set();
  const eventDate = punchEventDate(punch, shift);
  const base = {
    employee_id: punch.employee_id,
    employee_name: punch.employee_name || shift.employee_name,
    event_date: eventDate,
    shift_id: shift.id,
    punch_id: punch.id,
  };

  if (clockIn && start) {
    const lateBy = minutesBetween(clockIn, start);
    if (lateBy > settings.grace_minutes_late) {
      wanted.add("late");
      await upsertAutoEvent(supabase, {
        ...base,
        event_type: "late",
        minutes_delta: Math.round(lateBy),
      });
    }
    const earlyBy = minutesBetween(start, clockIn);
    if (earlyBy > settings.grace_minutes_early_in) {
      wanted.add("clock_in_early");
      await upsertAutoEvent(supabase, {
        ...base,
        event_type: "clock_in_early",
        minutes_delta: Math.round(earlyBy),
      });
    }
  }

  if (clockOut && end) {
    const earlyOutBy = minutesBetween(end, clockOut);
    if (earlyOutBy > settings.grace_minutes_early_out) {
      wanted.add("left_early");
      await upsertAutoEvent(supabase, {
        ...base,
        event_type: "left_early",
        minutes_delta: Math.round(earlyOutBy),
      });
    }
  }

  for (const type of ["late", "clock_in_early", "left_early"]) {
    if (!wanted.has(type)) {
      await deleteAutoEvent(supabase, { event_type: type, punch_id: punch.id });
    }
  }

  await deleteAutoEvent(supabase, { event_type: "no_show", shift_id: shift.id });
}

export async function evaluatePunchAndSweep(supabase, punch) {
  await evaluatePunchFlags(supabase, punch);
  const today = getStoreToday();
  await sweepNoShows(supabase, addDaysISO(today, -1), today);
}

function employeeForShift(shift, employees) {
  if (!shift) return null;
  const jolt = shift.jolt_employee_id != null ? String(shift.jolt_employee_id) : "";
  if (jolt) {
    const match = (employees || []).find((emp) => String(emp.jolt_employee_id || "") === jolt);
    if (match) return match;
  }
  return (employees || []).find((emp) => matchesEmployeeByName(shift.employee_name, emp)) || null;
}

export async function sweepNoShows(supabase, fromDate, toDate, options = {}) {
  const now = options.now || new Date();
  const employees =
    options.employees ||
    (await fetchEmployees(supabase, {
      storeId: STORE_ID,
      select: "id, first_name, last_name, jolt_employee_id, is_active",
    }));

  const { data: shifts, error: shiftErr } = await supabase
    .from("schedule_shifts")
    .select(
      "id, shift_date, employee_name, jolt_employee_id, scheduled_start, scheduled_end, role, station"
    )
    .eq("store_id", ATTENDANCE_STORE_ID)
    .gte("shift_date", fromDate)
    .lte("shift_date", toDate);
  if (shiftErr) throw shiftErr;

  const eligible = (shifts || []).filter((shift) => !isUnassignedName(shift.employee_name));
  if (!eligible.length) return { created: 0 };

  const shiftIds = eligible.map((s) => s.id);
  const [{ data: punches, error: punchErr }, { data: callouts, error: callErr }] = await Promise.all([
    supabase.from("time_punches").select("id, shift_id").in("shift_id", shiftIds),
    supabase
      .from("attendance_events")
      .select("id, shift_id")
      .eq("store_id", ATTENDANCE_STORE_ID)
      .eq("event_type", "call_out")
      .in("shift_id", shiftIds),
  ]);
  if (punchErr) throw punchErr;
  if (callErr) throw callErr;

  const punched = new Set((punches || []).map((p) => p.shift_id).filter(Boolean));
  const calledOut = new Set((callouts || []).map((e) => e.shift_id).filter(Boolean));
  let created = 0;

  for (const shift of eligible) {
    const end = scheduledEndDate(shift);
    const ended = end ? end.getTime() < now.getTime() : shift.shift_date < getStoreToday(now);
    if (!ended) {
      await deleteAutoEvent(supabase, { event_type: "no_show", shift_id: shift.id });
      continue;
    }
    if (punched.has(shift.id) || calledOut.has(shift.id)) {
      await deleteAutoEvent(supabase, { event_type: "no_show", shift_id: shift.id });
      continue;
    }
    const emp = employeeForShift(shift, employees);
    await upsertAutoEvent(supabase, {
      employee_id: emp?.id || null,
      employee_name: shift.employee_name,
      event_date: shift.shift_date,
      event_type: "no_show",
      shift_id: shift.id,
      punch_id: null,
      minutes_delta: null,
    });
    created += 1;
  }
  return { created };
}

export async function rescanAttendance(supabase, fromDate, toDate) {
  const settings = await getAttendanceSettings(supabase);
  const from = fromDate || addDaysISO(getStoreToday(), -14);
  const to = toDate || getStoreToday();
  const rangeStart = storeWallClockToDate(from, "00:00:00");
  const rangeEnd = storeWallClockToDate(addDaysISO(to, 1), "00:00:00");

  const { data: punchRows, error: punchErr } = await supabase
    .from("time_punches")
    .select("*")
    .eq("store_id", ATTENDANCE_STORE_ID)
    .gte("clock_in", rangeStart.toISOString())
    .lt("clock_in", rangeEnd.toISOString());
  if (punchErr) throw punchErr;

  const { data: rangeShifts, error: shiftErr } = await supabase
    .from("schedule_shifts")
    .select("id")
    .eq("store_id", ATTENDANCE_STORE_ID)
    .gte("shift_date", from)
    .lte("shift_date", to);
  if (shiftErr) throw shiftErr;

  const extraIds = (rangeShifts || []).map((s) => s.id);
  let linked = [];
  if (extraIds.length) {
    const { data, error } = await supabase
      .from("time_punches")
      .select("*")
      .eq("store_id", ATTENDANCE_STORE_ID)
      .in("shift_id", extraIds);
    if (error) throw error;
    linked = data || [];
  }

  const byId = new Map();
  for (const punch of [...(punchRows || []), ...linked]) byId.set(punch.id, punch);

  for (const punch of byId.values()) {
    await evaluatePunchFlags(supabase, punch, { settings });
  }

  const noShows = await sweepNoShows(supabase, from, to);
  return { punches: byId.size, noShows: noShows.created, from, to };
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
      .select("id, employee_name, jolt_employee_id")
      .eq("store_id", ATTENDANCE_STORE_ID)
      .eq("shift_date", eventDate);
    const employees = await fetchEmployees(supabase, {
      storeId: STORE_ID,
      select: "id, first_name, last_name, jolt_employee_id",
    });
    const emp = employees.find((row) => row.id === employeeId) || null;
    const match = (shifts || []).find((shift) => {
      if (emp && employeeForShift(shift, [emp])) return true;
      return String(shift.employee_name || "").toLowerCase() === employeeName.toLowerCase();
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
    .select("id, shift_date, employee_name, jolt_employee_id, scheduled_start, scheduled_end")
    .eq("id", shiftId)
    .eq("store_id", ATTENDANCE_STORE_ID)
    .maybeSingle();
  if (error) throw error;
  if (!shift) throw new Error("Shift not found.");
  if (isUnassignedName(shift.employee_name)) throw new Error("Assign the shift before marking a call-out.");

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
      employee_id: emp?.id || null,
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
