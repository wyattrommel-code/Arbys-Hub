import { NextResponse } from "next/server";
import { requireFeature, requireSession } from "@/lib/api-auth";
import { fetchEmployeeRoleAssignments, rolesHttpError, setEmployeeRoles } from "@/lib/roles";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(_request, context) {
  const { error } = await requireSession();
  if (error) return error;
  try {
    const { id } = await context.params;
    const assignments = await fetchEmployeeRoleAssignments(getSupabaseServer(), id);
    return NextResponse.json({ ok: true, assignments });
  } catch (err) {
    const { status, message } = rolesHttpError(err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PUT(request, context) {
  const { employee, error } = await requireFeature("people");
  if (error) return error;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const result = await setEmployeeRoles(
      getSupabaseServer(),
      id,
      body.role_ids || body.roleIds || [],
      body.primary_role_id || body.primaryRoleId,
      employee
    );
    const assignments = await fetchEmployeeRoleAssignments(getSupabaseServer(), id);
    return NextResponse.json({ ok: true, assignments, ...result });
  } catch (err) {
    const { status, message } = rolesHttpError(err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
