import { getAttendanceSettings } from "@/lib/attendance";
import { STORE_ID } from "@/lib/constants";
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

import { timecardReview } from "@/lib/timecard-approval";
async function allRows(query) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const result = await query.range(offset, offset + 499);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < 500) return rows;
  }
}
export async function loadTimecards(fromDate, toDate, punchId = null) {
    const today = getStoreToday();
    const from = fromDate || weekStartSunday(today);
    const to = toDate || addDaysISO(weekStartSunday(today), 6);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error("Invalid date range.");
    const supabase = getSupabaseServer();
    const settings = await getAttendanceSettings(supabase);
    const { from: fromUtc, toExclusive } = punchRangeBounds(from, to);

    let query = supabase.from("time_punches").select("*").eq("store_id", TIMECARD_STORE_ID);
    query = punchId ? query.eq("id", punchId) : query.gte("clock_in", fromUtc.toISOString()).lt("clock_in", toExclusive.toISOString());
    const rows = await allRows(query.order("clock_in", { ascending: true }).order("id"));
    const punchIds = rows.map((p) => p.id).filter(Boolean);
    const breakRows = [];
    for (let offset = 0; offset < punchIds.length; offset += 100) {
      const batch = await fetchBreaksForPunches(supabase, punchIds.slice(offset, offset + 100));
      if (batch.length >= 1000) throw new Error("Too many break records. Select a smaller date range.");
      breakRows.push(...batch);
    }
    const breaksByPunch = new Map();
    for (const row of breakRows) {
      if (!breaksByPunch.has(row.time_punch_id)) breaksByPunch.set(row.time_punch_id, []);
      breaksByPunch.get(row.time_punch_id).push(row);
    }
    const shiftIds = [...new Set(rows.map((p) => p.shift_id).filter(Boolean))];
    let shifts = [];
    for (let offset = 0; offset < shiftIds.length; offset += 100) {
      const { data: shiftRows, error: shiftErr } = await supabase
        .from("schedule_shifts")
        .select(
          "id, shift_date, scheduled_start, scheduled_end, unpaid_break_minutes, scheduled_hours, role, station"
        )
        .eq("store_id", TIMECARD_STORE_ID)
        .in("id", shiftIds.slice(offset, offset + 100));
      if (shiftErr) throw shiftErr;
      shifts.push(...(shiftRows || []));
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
    const approvals = [];
    for (let offset = 0; offset < punchIds.length; offset += 100) {
      approvals.push(...await allRows(supabase.from("timecard_approvals")
        .select("punch_id, snapshot_hash, approved_by_name, approved_at, note")
        .in("punch_id", punchIds.slice(offset, offset + 100)).order("id")));
    }
    const serialized = rows.map((punch) => {
      const card = serializeTimecardPunch(
        punch,
        shiftMap.get(punch.shift_id),
        {
          subtractScheduledBreak: settings.subtract_scheduled_break,
          useBreakPunches: settings.use_break_punches,
          breaks: breaksByPunch.get(punch.id) || [],
        },
        employeeMap.get(punch.employee_id)
      );
      return { ...card, ...timecardReview(card, shiftMap.get(punch.shift_id), settings, approvals) };
    });
    const grouped = groupTimecards(serialized);
    const groups = grouped.groups.map((group) => ({
      ...group,
      profile_photo_url: employeeMap.get(group.key)?.profile_photo_url || null,
    }));
    return {
      ok: true,
      from,
      to,
      subtract_scheduled_break: Boolean(settings.subtract_scheduled_break),
      use_break_punches: Boolean(settings.use_break_punches),
      groups,
      grand_display: grouped.grandDisplay,
      grand_exact: grouped.grandExact,
      open_count: grouped.openCount,
      pending_count: serialized.filter((p) => p.pending_approval).length,
      payroll_blocked: serialized.some((p) => !p.payroll_ready),
      approved_display: grouped.approvedDisplay,
      pending_display: grouped.pendingDisplay,
    };
}
