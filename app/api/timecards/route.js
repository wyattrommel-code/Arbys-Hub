import { secureJson } from "@/lib/security/http";
import { getAttendanceSettings } from "@/lib/attendance";
import { requireFeature } from "@/lib/api-auth";
import { STORE_ID } from "@/lib/constants";
import { canEditPunches } from "@/lib/permissions";
import { addDaysISO, getStoreToday } from "@/lib/store-time";
import { weekStartSunday } from "@/lib/schedule";
import {
  TIMECARD_STORE_ID,
  groupTimecards,
  punchRangeBounds,
  serializeTimecardPunch,
} from "@/lib/timecards";
import { fetchBreaksForPunches } from "@/lib/break-punches";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request) {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const url = new URL(request.url);
    const today = getStoreToday();
    const from = url.searchParams.get("from") || weekStartSunday(today);
    const to = url.searchParams.get("to") || addDaysISO(weekStartSunday(today), 6);
    const supabase = getSupabaseServer();
    const settings = await getAttendanceSettings(supabase);
    const { from: fromUtc, toExclusive } = punchRangeBounds(from, to);

    let punchQuery = await supabase
      .from("time_punches")
      .select(
        "id, employee_id, employee_name, shift_id, clock_in, clock_out, clock_in_photo_url, clock_out_photo_url, face_detected_in, face_detected_out, worked_minutes, total_break_minutes, on_break, unscheduled, authorized_by, status"
      )
      .eq("store_id", TIMECARD_STORE_ID)
      .gte("clock_in", fromUtc.toISOString())
      .lt("clock_in", toExclusive.toISOString())
      .order("clock_in", { ascending: true });
    if (punchQuery.error) {
      punchQuery = await supabase
        .from("time_punches")
        .select(
          "id, employee_id, employee_name, shift_id, clock_in, clock_out, clock_in_photo_url, clock_out_photo_url, face_detected_in, worked_minutes, unscheduled, authorized_by, status"
        )
        .eq("store_id", TIMECARD_STORE_ID)
        .gte("clock_in", fromUtc.toISOString())
        .lt("clock_in", toExclusive.toISOString())
        .order("clock_in", { ascending: true });
    }
    if (punchQuery.error) throw punchQuery.error;
    const punches = punchQuery.data;

    const rows = punches || [];
    const punchIds = rows.map((p) => p.id).filter(Boolean);
    const breakRows = await fetchBreaksForPunches(supabase, punchIds);
    const breaksByPunch = new Map();
    for (const row of breakRows) {
      if (!breaksByPunch.has(row.time_punch_id)) breaksByPunch.set(row.time_punch_id, []);
      breaksByPunch.get(row.time_punch_id).push(row);
    }
    const shiftIds = [...new Set(rows.map((p) => p.shift_id).filter(Boolean))];
    let shifts = [];
    if (shiftIds.length) {
      const { data: shiftRows, error: shiftErr } = await supabase
        .from("schedule_shifts")
        .select(
          "id, shift_date, scheduled_start, scheduled_end, unpaid_break_minutes, scheduled_hours, role, station"
        )
        .in("id", shiftIds);
      if (shiftErr) throw shiftErr;
      shifts = shiftRows || [];
    }
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const employeeIds = [...new Set(rows.map((p) => p.employee_id).filter(Boolean))];
    const employeeMap = new Map();
    if (employeeIds.length) {
      let empQuery = await supabase
        .from("employees")
        .select("id, primary_role, profile_photo_url")
        .eq("store_id", STORE_ID)
        .in("id", employeeIds);
      if (empQuery.error) {
        empQuery = await supabase
          .from("employees")
          .select("id, primary_role")
          .eq("store_id", STORE_ID)
          .in("id", employeeIds);
      }
      if (!empQuery.error) {
        for (const emp of empQuery.data || []) employeeMap.set(emp.id, emp);
      }
    }
    const serialized = rows.map((punch) =>
      serializeTimecardPunch(
        punch,
        shiftMap.get(punch.shift_id),
        {
          subtractScheduledBreak: settings.subtract_scheduled_break,
          useBreakPunches: settings.use_break_punches,
          breaks: breaksByPunch.get(punch.id) || [],
        },
        employeeMap.get(punch.employee_id)
      )
    );
    const grouped = groupTimecards(serialized);
    const groups = grouped.groups.map((group) => ({
      ...group,
      profile_photo_url: employeeMap.get(group.key)?.profile_photo_url || null,
    }));
    return secureJson({
      ok: true,
      from,
      to,
      can_edit: canEditPunches(employee.role),
      subtract_scheduled_break: Boolean(settings.subtract_scheduled_break),
      use_break_punches: Boolean(settings.use_break_punches),
      groups,
      grand_display: grouped.grandDisplay,
      grand_exact: grouped.grandExact,
      open_count: grouped.openCount,
    });
  } catch (err) {
    return secureJson(
      { ok: false, error: err.message || "Could not load timecards." },
      { status: 500 }
    );
  }
}
