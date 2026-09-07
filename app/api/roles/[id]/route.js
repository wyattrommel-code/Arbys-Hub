import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/api-auth";
import { rolesHttpError, updateManagedRole } from "@/lib/roles";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function PATCH(request, context) {
  const { employee, error } = await requireFeature("people");
  if (error) return error;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const role = await updateManagedRole(getSupabaseServer(), id, body, employee);
    return NextResponse.json({ ok: true, role });
  } catch (err) {
    const { status, message } = rolesHttpError(err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
