import { secureJson } from "@/lib/security/http";
import { requireFeature, requireSession } from "@/lib/api-auth";
import { createManagedRole, fetchAllRoleAssignments, fetchRoles, rolesHttpError } from "@/lib/roles";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request) {
  const { error } = await requireSession();
  if (error) return error;
  try {
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get("inactive") === "1" || url.searchParams.get("all") === "1";
    const includeAssignments = url.searchParams.get("assignments") === "1";
    if (includeInactive) {
      const gated = await requireFeature("people");
      if (gated.error) return gated.error;
    }
    const supabase = getSupabaseServer();
    const roles = await fetchRoles(supabase, { includeInactive });
    if (!includeAssignments) {
      return secureJson({ ok: true, roles });
    }
    const assignments = await fetchAllRoleAssignments(supabase);
    return secureJson({ ok: true, roles, assignments });
  } catch (err) {
    const { status, message } = rolesHttpError(err);
    return secureJson({ ok: false, error: message }, { status });
  }
}

export async function POST(request) {
  const { employee, error } = await requireFeature("people");
  if (error) return error;
  try {
    const body = await request.json();
    const role = await createManagedRole(getSupabaseServer(), body, employee);
    return secureJson({ ok: true, role });
  } catch (err) {
    const { status, message } = rolesHttpError(err);
    return secureJson({ ok: false, error: message }, { status });
  }
}
