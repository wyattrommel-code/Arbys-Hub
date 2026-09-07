import { NextResponse } from "next/server";
import { getAttendanceSettings, saveAttendanceSettings } from "@/lib/attendance";
import { requireFeature } from "@/lib/api-auth";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET() {
  const { error } = await requireFeature("settings");
  if (error) return error;
  try {
    const settings = await getAttendanceSettings(getSupabaseServer());
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Could not load settings." }, { status: 500 });
  }
}

export async function PATCH(request) {
  const { error } = await requireFeature("settings");
  if (error) return error;
  try {
    const body = await request.json();
    const settings = await saveAttendanceSettings(getSupabaseServer(), body || {});
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Could not save settings." }, { status: 500 });
  }
}
