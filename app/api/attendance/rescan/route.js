import { secureJson } from "@/lib/security/http";
import { rescanAttendance } from "@/lib/attendance";
import { requireFeature } from "@/lib/api-auth";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request) {
  const { error } = await requireFeature("timeclock.full");
  if (error) return error;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await rescanAttendance(getSupabaseServer(), body.from, body.to);
    return secureJson({ ok: true, ...result });
  } catch (err) {
    return secureJson({ ok: false, error: err.message || "Re-scan failed." }, { status: 500 });
  }
}
