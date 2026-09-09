import { guardPinAttempt } from "@/lib/security/pin-guard";
import { requireKiosk } from "@/lib/security/kiosk";
import { secureJson } from "@/lib/security/http";
import { after } from "next/server";
import { evaluatePunchAndSweep } from "@/lib/attendance";
import {
  CLOCK_STORE_ID,
  computePaidWorkedMinutes,
  fetchClockEmployeeByPin,
  fetchOpenPunch,
  getAttendanceSettings,
  parsePin,
  readPhotoFromRequest,
  uploadPunchPhoto,
} from "@/lib/clock";
import { isOnBreak, totalBreakMinutes } from "@/lib/break-punches";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request) {
  const pinError = await guardPinAttempt(request);
  if (pinError) return pinError;
  const kioskError = await requireKiosk();
  if (kioskError) return kioskError;
  try {
    const { pin, faceDetected, photo, employeeId } = await readPhotoFromRequest(request);
    if (!employeeId) {
      return secureJson({ ok: false, error: "Select your name first." }, { status: 400 });
    }
    if (!parsePin(pin)) {
      return secureJson({ ok: false, error: "Enter a 4-digit PIN." }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const employee = await fetchClockEmployeeByPin(supabase, pin);
    if (!employee || employee.id !== employeeId) {
      return secureJson({ ok: false, error: "Invalid PIN" }, { status: 401 });
    }

    const openPunch = await fetchOpenPunch(supabase, employee.id);
    if (!openPunch) {
      return secureJson({ ok: false, error: "No open punch to clock out." }, { status: 409 });
    }
    if (isOnBreak(openPunch)) {
      return secureJson(
        { ok: false, error: "End break first before clocking out." },
        { status: 409 }
      );
    }

    const settings = await getAttendanceSettings(supabase);

    let photoUrl = null;
    if (settings.require_photo_on_clock_out) {
      if (!photo) {
        return secureJson(
          { ok: false, error: "Photo is required to clock out." },
          { status: 400 }
        );
      }
      try {
        photoUrl = await uploadPunchPhoto(supabase, employee.id, photo, "out");
      } catch (err) {
        return secureJson(
          { ok: false, error: err.message || "Could not save photo. Try again." },
          { status: 500 }
        );
      }
    } else if (photo) {
      try {
        photoUrl = await uploadPunchPhoto(supabase, employee.id, photo, "out");
      } catch {
        photoUrl = null;
      }
    }

    let unpaidMinutes = 0;
    if (settings.use_break_punches) {
      unpaidMinutes = totalBreakMinutes(openPunch);
    } else if (settings.subtract_scheduled_break && openPunch.shift_id) {
      const { data: shift } = await supabase
        .from("schedule_shifts")
        .select("unpaid_break_minutes")
        .eq("id", openPunch.shift_id)
        .eq("store_id", CLOCK_STORE_ID)
        .maybeSingle();
      unpaidMinutes = Number(shift?.unpaid_break_minutes) || 0;
    }

    const clockOut = new Date().toISOString();
    const workedMinutes = computePaidWorkedMinutes(openPunch.clock_in, clockOut, unpaidMinutes);

    const closePatch = {
      clock_out: clockOut,
      clock_out_photo_url: photoUrl,
      face_detected_out: Boolean(faceDetected && photoUrl),
      worked_minutes: workedMinutes,
      status: "closed",
      on_break: false,
    };
    let closeRes = await supabase
      .from("time_punches")
      .update(closePatch)
      .eq("id", openPunch.id)
      .eq("status", "open")
      .select("id, clock_in, clock_out, worked_minutes, status")
      .maybeSingle();
    if (closeRes.error && /face_detected_out|clock_out_photo_url|on_break|column|schema cache/i.test(closeRes.error.message || "")) {
      const { face_detected_out: _f, on_break: _ob, ...legacy } = closePatch;
      closeRes = await supabase
        .from("time_punches")
        .update(legacy)
        .eq("id", openPunch.id)
        .eq("status", "open")
        .select("id, clock_in, clock_out, worked_minutes, status")
        .maybeSingle();
    }
    const { data: punch, error } = closeRes;

    if (error) throw error;
    if (!punch) {
      return secureJson({ ok: false, error: "Punch was already closed." }, { status: 409 });
    }

    after(async () => {
      try {
        await evaluatePunchAndSweep(getSupabaseServer(), {
          ...openPunch,
          ...punch,
          clock_out: punch.clock_out || clockOut,
          status: "closed",
        });
      } catch (flagErr) {
        console.error("attendance flags (clock out)", flagErr);
      }
    });

    return secureJson({ ok: true, punch });
  } catch (err) {
    return secureJson(
      { ok: false, error: err.message || "Clock out failed." },
      { status: 500 }
    );
  }
}
