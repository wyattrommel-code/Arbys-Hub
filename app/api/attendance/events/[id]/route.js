import { NextResponse } from "next/server";
import { ATTENDANCE_STORE_ID } from "@/lib/attendance";
import { requireFeature } from "@/lib/api-auth";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function PATCH(request, context) {
  const { error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const note = String(body.note || "").trim() || null;
    const supabase = getSupabaseServer();
    const { data, error: upErr } = await supabase
      .from("attendance_events")
      .update({ note })
      .eq("id", id)
      .eq("store_id", ATTENDANCE_STORE_ID)
      .select("id, note")
      .maybeSingle();
    if (upErr) throw upErr;
    if (!data) return NextResponse.json({ ok: false, error: "Event not found." }, { status: 404 });
    return NextResponse.json({ ok: true, event: data });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Could not update note." }, { status: 500 });
  }
}
