import { secureJson } from "@/lib/security/http";
import { attendanceReport, createManualEvent, saveGeneratedAttendanceNote } from "@/lib/attendance";
import { actorName, requireFeature } from "@/lib/api-auth";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request) {
  const { error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const url = new URL(request.url);
    const { report } = await attendanceReport(getSupabaseServer(), url.searchParams.get("from"), url.searchParams.get("to"));
    const { autoEvents: _automatic, ...workspace } = report;
    return secureJson({ ok: true, ...workspace });
  } catch (err) {
    return secureJson({ ok: false, error: err.message || "Could not load attendance." }, { status: 500 });
  }
}

export async function POST(request) {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const body = await request.json();
    const id = body?.generated_note === true
      ? await saveGeneratedAttendanceNote(getSupabaseServer(), body)
      : await createManualEvent(getSupabaseServer(), body || {}, actorName(employee));
    return secureJson({ ok: true, id });
  } catch (err) {
    return secureJson({ ok: false, error: err.message || "Could not add event." }, { status: 500 });
  }
}
