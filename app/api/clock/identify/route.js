import { cookies } from 'next/headers';
import { DEVICE_COOKIE, hashCredential } from '@/lib/security/clock-device';
import { offlinePinVersion } from '@/lib/offline-clock-crypto';
import { guardPinAttempt } from "@/lib/security/pin-guard";
import { requireKiosk } from "@/lib/security/kiosk";
import { secureJson } from "@/lib/security/http";
import {
  canAuthorizeUnscheduled,
  fetchClockEmployeeByPin,
  fetchOpenPunch,
  fetchPunchSchedules,
  fetchRecentPunches,
  fetchRecentClockOuts,
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
  const kioskError = await requireKiosk();
  if (kioskError) return kioskError;
  const pinError = await guardPinAttempt(request);
  if (pinError) return pinError;
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

    const employee = await fetchClockEmployeeByPin(supabase, pin, employeeId);
    if (!employee || employee.id !== employeeId) {
      return secureJson({ ok: false, error: "Invalid PIN" }, { status: 401 });
    }

    const deviceHash = hashCredential((await cookies()).get(DEVICE_COOKIE).value);
    const offlinePin = { version: offlinePinVersion(deviceHash, employee) };
    const [settings, openPunch] = await Promise.all([
      getAttendanceSettings(supabase),
      fetchOpenPunch(supabase, employee.id),
    ]);

    if (openPunch) {
      const punch = await healOrphanOnBreak(supabase, openPunch);
      const [openBreak, schedules] = await Promise.all([
        fetchOpenBreak(supabase, punch.id),
        fetchPunchSchedules(supabase, [punch]),
      ]);
      return secureJson({
        ok: true,
        offlinePin,
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
        clock_schedule: schedules.get(punch.id),
        settings: publicSettings(settings),
      });
    }

    const [shifts, punches, clockOuts] = await Promise.all([
      fetchTodaysShiftsForEmployee(supabase, employee),
      fetchRecentPunches(supabase, employee.id),
      fetchRecentClockOuts(supabase, [employee.id]),
    ]);
    const shift = pickClockInShift(shifts, punches);
    const scheduled = Boolean(shift);
    const access = scheduled ? employee : await attachEffectiveAccess(supabase, employee);

    return secureJson({
      ok: true,
      offlinePin,
      action: "clock_in",
      employee: serializeEmployee(employee),
      openPunch: null,
      last_clock_out: clockOuts.get(employee.id) || null,
      scheduled,
      shift: serializeShift(shift),
      needsAuthorization: !scheduled,
      canSelfAuthorize: !scheduled && canAuthorizeUnscheduled(access),
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
