import { NextResponse } from "next/server";
import {
  ATTENDANCE_STORE_ID,
  createManualEvent,
  displayShiftLabel,
  EVENT_TYPE_LABELS,
  normalizeEventType,
} from "@/lib/attendance";
import { actorName, requireFeature } from "@/lib/api-auth";
import { formatLongDate } from "@/lib/schedule";
import { getSupabaseServer } from "@/lib/supabase-server";

function serializeEvent(row, shift) {
  const type = normalizeEventType(row.event_type);
  return {
    id: row.id,
    employee_name: row.employee_name,
    employee_id: row.employee_id,
    event_date: row.event_date,
    event_date_label: formatLongDate(row.event_date),
    event_type: type,
    event_type_label: EVENT_TYPE_LABELS[type] || type,
    minutes_delta: row.minutes_delta,
    auto_generated: Boolean(row.auto_generated),
    note: row.note || "",
    shift_label: displayShiftLabel(shift),
  };
}

export async function GET(request) {
  const { error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const employeeId = url.searchParams.get("employee_id");
    const eventType = url.searchParams.get("event_type");

    const supabase = getSupabaseServer();
    let query = supabase
      .from("attendance_events")
      .select(
        "id, employee_id, employee_name, event_date, event_type, shift_id, punch_id, minutes_delta, auto_generated, note"
      )
      .eq("store_id", ATTENDANCE_STORE_ID)
      .order("event_date", { ascending: false });
    if (from) query = query.gte("event_date", from);
    if (to) query = query.lte("event_date", to);
    if (employeeId) query = query.eq("employee_id", employeeId);
    if (eventType) query = query.eq("event_type", normalizeEventType(eventType));

    const { data, error: qErr } = await query.limit(1000);
    if (qErr) throw qErr;
    const rows = data || [];
    const shiftIds = [...new Set(rows.map((r) => r.shift_id).filter(Boolean))];
    let shifts = [];
    if (shiftIds.length) {
      const { data: shiftRows, error: sErr } = await supabase
        .from("schedule_shifts")
        .select("id, scheduled_start, scheduled_end, role, station")
        .in("id", shiftIds);
      if (sErr) throw sErr;
      shifts = shiftRows || [];
    }
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    return NextResponse.json({
      ok: true,
      events: rows.map((row) => serializeEvent(row, shiftMap.get(row.shift_id))),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Could not load events." }, { status: 500 });
  }
}

export async function POST(request) {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const body = await request.json();
    const id = await createManualEvent(getSupabaseServer(), body || {}, actorName(employee));
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Could not add event." }, { status: 500 });
  }
}
