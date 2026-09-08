import { guardPinAttempt } from "@/lib/security/pin-guard";
import { requireKiosk } from "@/lib/security/kiosk";
import { secureJson } from "@/lib/security/http";
import { after } from "next/server";
import { evaluatePunchAndSweep } from "@/lib/attendance";
import {
  CLOCK_STORE_ID,
  canAuthorizeUnscheduled,
  clockEmployeeName,
  fetchClockEmployeeByPin,
  fetchOpenPunch,
  fetchRecentPunches,
  fetchTodaysShiftsForEmployee,
  getAttendanceSettings,
  parsePin,
  pickClockInShift,
  readPhotoFromRequest,
  uploadPunchPhoto,
} from "@/lib/clock";
import { attachEffectiveAccess } from "@/lib/roles";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request) {
  const pinError = await guardPinAttempt(request);
  if (pinError) return pinError;
  const kioskError = await requireKiosk();
  if (kioskError) return kioskError;
  try {
    const { pin, managerPin, faceDetected, photo, employeeId } = await readPhotoFromRequest(request);
    if (!employeeId) {
      return secureJson({ ok: false, error: "Select your name first." }, { status: 400 });
    }
    if (!parsePin(pin)) {
      return secureJson({ ok: false, error: "Enter a 4-digit PIN." }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const employee = await attachEffectiveAccess(supabase, await fetchClockEmployeeByPin(supabase, pin));
    if (!employee || employee.id !== employeeId) {
      return secureJson({ ok: false, error: "Invalid PIN" }, { status: 401 });
    }

    const openPunch = await fetchOpenPunch(supabase, employee.id);
    if (openPunch) {
      return secureJson(
        { ok: false, error: "Already clocked in. Clock out first." },
        { status: 409 }
      );
    }

    const [settings, shifts, punches] = await Promise.all([
      getAttendanceSettings(supabase),
      fetchTodaysShiftsForEmployee(supabase, employee),
      fetchRecentPunches(supabase, employee.id),
    ]);

    const shift = pickClockInShift(shifts, punches);
    let unscheduled = !shift;
    let authorizedBy = null;
    let authorizedById = null;

    if (unscheduled) {
      if (!parsePin(managerPin)) {
        return secureJson(
          { ok: false, error: "You're not scheduled today. A manager must authorize." },
          { status: 403 }
        );
      }
      const manager = await attachEffectiveAccess(supabase, await fetchClockEmployeeByPin(supabase, managerPin));
      if (!manager || !canAuthorizeUnscheduled(manager)) {
        return secureJson(
          { ok: false, error: "That PIN cannot authorize unscheduled work." },
          { status: 403 }
        );
      }
      authorizedBy = clockEmployeeName(manager);
      authorizedById = manager.id;
    }

    let photoUrl = null;
    if (settings.require_face_on_clock_in) {
      if (!photo) {
        return secureJson(
          { ok: false, error: "Photo is required to clock in." },
          { status: 400 }
        );
      }
      try {
        photoUrl = await uploadPunchPhoto(supabase, employee.id, photo);
      } catch (err) {
        return secureJson(
          { ok: false, error: err.message || "Could not save photo. Try again." },
          { status: 500 }
        );
      }
    } else if (photo) {
      try {
        photoUrl = await uploadPunchPhoto(supabase, employee.id, photo);
      } catch {
        photoUrl = null;
      }
    }

    const now = new Date().toISOString();
    const punchRow = {
      employee_id: employee.id,
      employee_name: clockEmployeeName(employee),
      jolt_employee_id: employee.jolt_employee_id || null,
      shift_id: shift?.id || null,
      clock_in: now,
      clock_out: null,
      clock_in_photo_url: photoUrl,
      clock_out_photo_url: null,
      face_detected_in: Boolean(faceDetected && photoUrl),
      face_detected_out: false,
      worked_minutes: null,
      unscheduled,
      authorized_by: authorizedBy,
      authorized_by_id: authorizedById,
      status: "open",
      store_id: CLOCK_STORE_ID,
      on_break: false,
      total_break_minutes: 0,
    };
    let punchRes = await supabase.from("time_punches").insert(punchRow).select("id, clock_in, status").single();
    if (punchRes.error && /on_break|total_break_minutes|column|schema cache/i.test(punchRes.error.message || "")) {
      const { on_break: _ob, total_break_minutes: _t, ...legacy } = punchRow;
      punchRes = await supabase.from("time_punches").insert(legacy).select("id, clock_in, status").single();
    }
    const { data: punch, error } = punchRes;

    if (error) throw error;

    after(async () => {
      try {
        await evaluatePunchAndSweep(getSupabaseServer(), {
          id: punch.id,
          employee_id: employee.id,
          employee_name: clockEmployeeName(employee),
          shift_id: shift?.id || null,
          clock_in: punch.clock_in || now,
          clock_out: null,
          unscheduled,
        });
      } catch (flagErr) {
        console.error("attendance flags (clock in)", flagErr);
      }
    });

    return secureJson({
      ok: true,
      punch,
      employee: { name: clockEmployeeName(employee) },
    });
  } catch (err) {
    return secureJson(
      { ok: false, error: err.message || "Clock in failed." },
      { status: 500 }
    );
  }
}
