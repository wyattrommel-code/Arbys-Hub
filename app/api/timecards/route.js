import { NextResponse } from "next/server";
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
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request) {
  const { employee, error } = await requireFeature("schedule.full");
  if (error) return error;
  try {
    const url = new URL(request.url);
    const today = getStoreToday();
    const from = url.searchParams.get("from") || weekStartSunday(today);
    const to = url.searchParams.get("to") || addDaysISO(weekStartSunday(today), 6);
    const supabase = getSupabaseServer();
    const settings = await getAttendanceSettings(supabase);
    const { from: fromUtc, toExclusive } = punchRangeBounds(from, to);

    const { data: punches, error: punchErr } = await supabase
      .from("time_punches")
      .select(
        "id, employee_id, employee_name, shift_id, clock_in, clock_out, clock_in_photo_url, clock_out_photo_url, face_detected_in, worked_minutes, unscheduled, authorized_by, status"
      )
      .eq("store_id", TIMECARD_STORE_ID)
      .gte("clock_in", fromUtc.toISOString())
      .lt("clock_in", toExclusive.toISOString())
      .order("clock_in", { ascending: true });
    if (punchErr) throw punchErr;

    const rows = punches || [];
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
      const empQuery = await supabase
        .from("employees")
        .select("id, primary_role")
        .eq("store_id", STORE_ID)
        .in("id", employeeIds);
      if (!empQuery.error) {
        for (const emp of empQuery.data || []) employeeMap.set(emp.id, emp);
      }
    }
    const serialized = rows.map((punch) =>
      serializeTimecardPunch(
        punch,
        shiftMap.get(punch.shift_id),
        settings.subtract_scheduled_break,
        employeeMap.get(punch.employee_id)
      )
    );
    const grouped = groupTimecards(serialized);
    return NextResponse.json({
      ok: true,
      from,
      to,
      can_edit: canEditPunches(employee.role),
      subtract_scheduled_break: Boolean(settings.subtract_scheduled_break),
      groups: grouped.groups,
      grand_display: grouped.grandDisplay,
      grand_exact: grouped.grandExact,
      open_count: grouped.openCount,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || "Could not load timecards." },
      { status: 500 }
    );
  }
}
