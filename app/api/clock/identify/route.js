import { guardPinAttempt } from "@/lib/security/pin-guard";
import { requireKiosk } from "@/lib/security/kiosk";
import { secureJson } from "@/lib/security/http";
import {
  canAuthorizeUnscheduled,
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
import { fetchOpenBreak, healOrphanOnBreak, isOnBreak, serializeOpenBreak } from "@/lib/break-punches";
import { attachEffectiveAccess } from "@/lib/roles";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request) {
  const pinError = await guardPinAttempt(request);
  if (pinError) return pinError;
  const kioskError = await requireKiosk();
  if (kioskError) return kioskError;
  try {
    const body = await request.json();
    const pin = parsePin(body.pin);
    const employeeId = String(body.employee_id || "").trim();
    if (!employeeId) {
      return secureJson({ ok: false, error: "Select your name first." }, { status: 400 });
    }
    if (!pin) {
      return secureJson({ ok: false, error: "Enter a 4-digit PIN." }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    const employee = await attachEffectiveAccess(supabase, await fetchClockEmployeeByPin(supabase, pin));
    if (!employee || employee.id !== employeeId) {
      return secureJson({ ok: false, error: "Invalid PIN" }, { status: 401 });
    }

    const [settings, openPunch, shifts, punches] = await Promise.all([
      getAttendanceSettings(supabase),
      fetchOpenPunch(supabase, employee.id),
      fetchTodaysShiftsForEmployee(supabase, employee),
      fetchRecentPunches(supabase, employee.id),
    ]);

    if (openPunch) {
      const punch = await healOrphanOnBreak(supabase, openPunch);
      const openBreak = await fetchOpenBreak(supabase, punch.id);
      return secureJson({
        ok: true,
        action: "clock_out",
        employee: serializeEmployee(employee),
        openPunch: {
          id: punch.id,
          clock_in: punch.clock_in,
          on_break: isOnBreak(punch),
        },
        openBreak: serializeOpenBreak(openBreak),
        on_break: isOnBreak(punch),
        scheduled: !openPunch.unscheduled,
        shift: null,
        needsAuthorization: false,
        settings: publicSettings(settings),
      });
    }

    const shift = pickClockInShift(shifts, punches);
    const scheduled = Boolean(shift);

    return secureJson({
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
    return secureJson(
      { ok: false, error: err.message || "Could not look up PIN." },
      { status: 500 }
    );
  }
}
