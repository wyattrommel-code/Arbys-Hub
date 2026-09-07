import { NextResponse } from "next/server";
import {
  canAuthorizeUnscheduled,
  ensureBrookelynnAssistantManager,
  fetchClockEmployeeByPin,
  fetchOpenPunch,
  fetchRecentPunches,
  fetchTodaysShiftsForEmployee,
  getAttendanceSettings,
  parsePin,
  pickClockInShift,
  publicSettings,
  serializeEmployee,
  serializeShift,
} from "@/lib/clock";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request) {
  try {
    const body = await request.json();
    const pin = parsePin(body.pin);
    const employeeId = String(body.employee_id || "").trim();
    if (!employeeId) {
      return NextResponse.json({ ok: false, error: "Select your name first." }, { status: 400 });
    }
    if (!pin) {
      return NextResponse.json({ ok: false, error: "Enter a 4-digit PIN." }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    await ensureBrookelynnAssistantManager(supabase);

    const employee = await fetchClockEmployeeByPin(supabase, pin);
    if (!employee || employee.id !== employeeId) {
      return NextResponse.json({ ok: false, error: "Invalid PIN" }, { status: 401 });
    }

    const [settings, openPunch, shifts, punches] = await Promise.all([
      getAttendanceSettings(supabase),
      fetchOpenPunch(supabase, employee.id),
      fetchTodaysShiftsForEmployee(supabase, employee),
      fetchRecentPunches(supabase, employee.id),
    ]);

    if (openPunch) {
      return NextResponse.json({
        ok: true,
        action: "clock_out",
        employee: serializeEmployee(employee),
        openPunch: { id: openPunch.id, clock_in: openPunch.clock_in },
        scheduled: !openPunch.unscheduled,
        shift: null,
        needsAuthorization: false,
        settings: publicSettings(settings),
      });
    }

    const shift = pickClockInShift(shifts, punches);
    const scheduled = Boolean(shift);

    return NextResponse.json({
      ok: true,
      action: "clock_in",
      employee: serializeEmployee(employee),
      openPunch: null,
      scheduled,
      shift: serializeShift(shift),
      needsAuthorization: !scheduled,
      canSelfAuthorize: canAuthorizeUnscheduled(employee),
      settings: publicSettings(settings),
      message: scheduled
        ? null
        : shifts.length
          ? "No remaining scheduled shift today."
          : "You're not scheduled today",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || "Could not look up PIN." },
      { status: 500 }
    );
  }
}
