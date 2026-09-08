import { getCurrentEmployee } from "@/lib/auth";
import { getKioskActor } from "@/lib/security/kiosk";
import { getSupabaseServer } from "@/lib/supabase-server";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export async function GET(_request, context) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const { bucket, path } = await context.params;
    if (!["profile-photos", "punch-photos", "checklist-photos"].includes(bucket) || !Array.isArray(path) || path.some((p) => !p || p === "." || p === ".." || /[\\/\x00?#%]/.test(p))) return new Response(null, { status: 404, headers });
    const actor = await getCurrentEmployee();
    const kiosk = !actor && bucket === "profile-photos" ? await getKioskActor() : null;
    if (!actor && !kiosk) return new Response(null, { status: 401, headers });
    if (bucket === "checklist-photos" ? path[0] !== "07462" : path[0] !== "payson") return new Response(null, { status: 404, headers });
    if (bucket === "punch-photos" && !canAccess(actor.role, "timeclock.full") && path[1] !== actor.employee_id) return new Response(null, { status: 403, headers });
    const { data, error } = await getSupabaseServer().storage.from(bucket).download(path.join("/"));
    if (error || !data || !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(data.type)) return new Response(null, { status: 404, headers });
    return new Response(data, { headers: { ...headers, "Content-Type": data.type } });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
