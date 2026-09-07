import { NextResponse } from "next/server";
import { markShiftCallOut } from "@/lib/attendance";
import { actorName, requireFeature } from "@/lib/api-auth";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request) {
  const { employee, error } = await requireFeature("schedule.full");
  if (error) return error;
  try {
    const body = await request.json();
    const shiftId = body.shift_id;
    if (!shiftId) {
      return NextResponse.json({ ok: false, error: "Shift is required." }, { status: 400 });
    }
    const id = await markShiftCallOut(getSupabaseServer(), shiftId, actorName(employee));
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Could not mark call-out." }, { status: 500 });
  }
}
