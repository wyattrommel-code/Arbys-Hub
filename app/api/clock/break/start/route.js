import { NextResponse } from "next/server";
import {
  clockEmployeeName,
  fetchClockEmployeeByPin,
  fetchOpenPunch,
  getAttendanceSettings,
  parsePin,
} from "@/lib/clock";
import { startBreakPunch } from "@/lib/break-punches";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request) {
  try {
    const body = await request.json();
    const pin = parsePin(body.pin);
    const employeeId = String(body.employee_id || "").trim();
    if (!employeeId || !pin) {
      return NextResponse.json({ ok: false, error: "Enter your PIN." }, { status: 400 });
    }
    const supabase = getSupabaseServer();
    const settings = await getAttendanceSettings(supabase);
    if (!settings.use_break_punches) {
      return NextResponse.json({ ok: false, error: "Break punches are turned off." }, { status: 409 });
    }
    const employee = await fetchClockEmployeeByPin(supabase, pin);
    if (!employee || employee.id !== employeeId) {
      return NextResponse.json({ ok: false, error: "Invalid PIN" }, { status: 401 });
    }
    const punch = await fetchOpenPunch(supabase, employee.id);
    if (!punch) {
      return NextResponse.json({ ok: false, error: "Clock in before starting a break." }, { status: 409 });
    }
    const row = await startBreakPunch(supabase, {
      punch,
      employee,
      employeeName: clockEmployeeName(employee),
    });
    return NextResponse.json({
      ok: true,
      action: "break_start",
      break: row,
      employee: { name: clockEmployeeName(employee) },
    });
  } catch (err) {
    const status = err.status || 500;
    return NextResponse.json({ ok: false, error: err.message || "Could not start break." }, { status });
  }
}
