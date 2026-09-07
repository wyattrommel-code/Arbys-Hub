import { after, NextResponse } from "next/server";
import { evaluatePunchAndSweep, getAttendanceSettings } from "@/lib/attendance";
import { actorName, requireFeature } from "@/lib/api-auth";
import { canEditPunches } from "@/lib/permissions";
import { fromStoreDateTimeLocal } from "@/lib/store-time";
import { TIMECARD_STORE_ID, computeWorkedMinutes, toStoredMinutes } from "@/lib/timecards";
import { getSupabaseServer } from "@/lib/supabase-server";

function parsePunchTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && value.includes("T") && !value.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(value)) {
    const local = fromStoreDateTimeLocal(value);
    return local ? local.toISOString() : null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isMissingColumnError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return /column|schema cache|could not find/i.test(msg);
}

export async function PATCH(request, context) {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  if (!canEditPunches(employee.role)) {
    return NextResponse.json({ ok: false, error: "Only a GM or assistant manager can edit punches." }, { status: 403 });
  }
  try {
    const { id } = await context.params;
    const body = await request.json();
    const clockIn = parsePunchTime(body.clock_in);
    const clockOut = parsePunchTime(body.clock_out);
    if (!clockIn) {
      return NextResponse.json({ ok: false, error: "Clock-in time is required." }, { status: 400 });
    }
    if (clockOut && new Date(clockOut).getTime() <= new Date(clockIn).getTime()) {
      return NextResponse.json({ ok: false, error: "Clock-out must be after clock-in." }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { data: punch, error: fetchErr } = await supabase
      .from("time_punches")
      .select("*")
      .eq("id", id)
      .eq("store_id", TIMECARD_STORE_ID)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!punch) return NextResponse.json({ ok: false, error: "Punch not found." }, { status: 404 });

    const settings = await getAttendanceSettings(supabase);
    let breakMinutes = 0;
    if (settings.subtract_scheduled_break && punch.shift_id) {
      const { data: shift } = await supabase
        .from("schedule_shifts")
        .select("unpaid_break_minutes")
        .eq("id", punch.shift_id)
        .maybeSingle();
      breakMinutes = Number(shift?.unpaid_break_minutes) || 0;
    }

    const workedMinutes = clockOut
      ? toStoredMinutes(
          computeWorkedMinutes(
            clockIn,
            clockOut,
            breakMinutes,
            Boolean(settings.subtract_scheduled_break && punch.shift_id)
          )
        )
      : null;

    const patch = {
      clock_in: clockIn,
      clock_out: clockOut,
      worked_minutes: workedMinutes,
      status: "edited",
    };

    const note = String(body.note || "").trim();
    let updated;
    if (note) {
      const withNote = {
        ...patch,
        note: `${note} (edited by ${actorName(employee)})`,
      };
      const first = await supabase
        .from("time_punches")
        .update(withNote)
        .eq("id", id)
        .eq("store_id", TIMECARD_STORE_ID)
        .select("*")
        .maybeSingle();
      if (first.error && isMissingColumnError(first.error)) {
        const fallback = await supabase
          .from("time_punches")
          .update(patch)
          .eq("id", id)
          .eq("store_id", TIMECARD_STORE_ID)
          .select("*")
          .maybeSingle();
        if (fallback.error) throw fallback.error;
        updated = fallback.data;
      } else if (first.error) {
        throw first.error;
      } else {
        updated = first.data;
      }
    } else {
      const { data, error: upErr } = await supabase
        .from("time_punches")
        .update(patch)
        .eq("id", id)
        .eq("store_id", TIMECARD_STORE_ID)
        .select("*")
        .maybeSingle();
      if (upErr) throw upErr;
      updated = data;
    }

    if (!updated) {
      return NextResponse.json({ ok: false, error: "Punch not found." }, { status: 404 });
    }

    after(async () => {
      try {
        await evaluatePunchAndSweep(getSupabaseServer(), updated);
      } catch (flagErr) {
        console.error("attendance flags (punch edit)", flagErr);
      }
    });

    return NextResponse.json({ ok: true, punch: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Could not save punch." }, { status: 500 });
  }
}
