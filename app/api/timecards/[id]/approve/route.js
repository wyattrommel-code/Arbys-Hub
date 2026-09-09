import { requireFeature, actorName } from "@/lib/api-auth";
import { canEditPunches } from "@/lib/permissions";
import { secureJson } from "@/lib/security/http";
import { getSupabaseServer } from "@/lib/supabase-server";
import { loadTimecards } from "@/lib/timecards-server";

export async function POST(request, { params }) {
  const { employee, error } = await requireFeature("timeclock.full");
  if (error) return error;
  if (!canEditPunches(employee.role)) return secureJson({ error: "Manager approval required." }, { status: 403 });
  try {
    const { id } = await params;
    const body = await request.json();
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note || note.length > 1000) return secureJson({ error: "Enter a review note (1–1000 characters)." }, { status: 400 });
    const data = await loadTimecards(null, null, id);
    const punch = data.groups.flatMap((group) => group.punches)[0];
    if (!punch) return secureJson({ error: "Timecard not found." }, { status: 404 });
    if (punch.open || punch.on_break || punch.breaks.some((row) => row.open)) return secureJson({ error: "Close the punch and its breaks before approval." }, { status: 409 });
    if (body.version !== punch.review_version) return secureJson({ error: "This timecard changed. Refresh and review it again." }, { status: 409 });
    if (!punch.pending_approval) return secureJson({ ok: true });
    const { error: saveError } = await getSupabaseServer().from("timecard_approvals").insert({
      punch_id: id, snapshot_hash: punch.review_version, approved_by: employee.employee_id,
      approved_by_name: actorName(employee), note,
      review_flags: punch.review_flags,
      reviewed_snapshot: punch.review_snapshot,
    });
    if (saveError && saveError.code !== "23505") throw saveError;
    return secureJson({ ok: true });
  } catch (err) {
    return secureJson({ error: err.message || "Could not approve timecard." }, { status: 500 });
  }
}
