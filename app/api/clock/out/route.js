import { after, NextResponse } from "next/server";
import { evaluatePunchAndSweep } from "@/lib/attendance";
import {
  CLOCK_STORE_ID,
  computeWorkedMinutes,
  fetchClockEmployeeByPin,
  fetchOpenPunch,
  getAttendanceSettings,
  parsePin,
  readPhotoFromRequest,
  uploadPunchPhoto,
} from "@/lib/clock";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request) {
  try {
    const { pin, faceDetected, photo, employeeId } = await readPhotoFromRequest(request);
    if (!employeeId) {
      return NextResponse.json({ ok: false, error: "Select your name first." }, { status: 400 });
    }
    if (!parsePin(pin)) {
      return NextResponse.json({ ok: false, error: "Enter a 4-digit PIN." }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const employee = await fetchClockEmployeeByPin(supabase, pin);
    if (!employee || employee.id !== employeeId) {
      return NextResponse.json({ ok: false, error: "Invalid PIN" }, { status: 401 });
    }

    const openPunch = await fetchOpenPunch(supabase, employee.id);
    if (!openPunch) {
      return NextResponse.json({ ok: false, error: "No open punch to clock out." }, { status: 409 });
    }

    const settings = await getAttendanceSettings(supabase);

    let photoUrl = null;
    if (settings.require_photo_on_clock_out) {
      if (!photo) {
        return NextResponse.json(
          { ok: false, error: "Photo is required to clock out." },
          { status: 400 }
        );
      }
      if (!faceDetected) {
        return NextResponse.json(
          { ok: false, error: "No face detected, please center your face." },
          { status: 400 }
        );
      }
      try {
        photoUrl = await uploadPunchPhoto(supabase, employee.id, photo);
      } catch (err) {
        return NextResponse.json(
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

    let breakMinutes = 0;
    if (settings.subtract_scheduled_break && openPunch.shift_id) {
      const { data: shift } = await supabase
        .from("schedule_shifts")
        .select("unpaid_break_minutes")
        .eq("id", openPunch.shift_id)
        .eq("store_id", CLOCK_STORE_ID)
        .maybeSingle();
      breakMinutes = Number(shift?.unpaid_break_minutes) || 0;
    }

    const clockOut = new Date().toISOString();
    const workedMinutes = computeWorkedMinutes(
      openPunch.clock_in,
      clockOut,
      breakMinutes,
      Boolean(settings.subtract_scheduled_break && openPunch.shift_id)
    );

    const { data: punch, error } = await supabase
      .from("time_punches")
      .update({
        clock_out: clockOut,
        clock_out_photo_url: photoUrl,
        face_detected_out: Boolean(faceDetected && photoUrl),
        worked_minutes: workedMinutes,
        status: "closed",
      })
      .eq("id", openPunch.id)
      .eq("status", "open")
      .select("id, clock_in, clock_out, worked_minutes, status")
      .maybeSingle();

    if (error) throw error;
    if (!punch) {
      return NextResponse.json({ ok: false, error: "Punch was already closed." }, { status: 409 });
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

    return NextResponse.json({ ok: true, punch });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || "Clock out failed." },
      { status: 500 }
    );
  }
}
