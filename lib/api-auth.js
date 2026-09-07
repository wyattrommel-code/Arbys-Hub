import { NextResponse } from "next/server";
import { hubRoleFromAccessTier } from "@/lib/access-tier";
import { getCurrentEmployee } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { getEffectiveAccess } from "@/lib/roles";
import { getSupabaseServer } from "@/lib/supabase-server";

async function withEffectiveAccess(employee) {
  if (!employee?.employee_id) return employee;
  try {
    const access = await getEffectiveAccess(getSupabaseServer(), employee.employee_id);
    return { ...employee, access_tier: access, role: hubRoleFromAccessTier(access) };
  } catch {
    return employee;
  }
}

export async function requireSession() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return {
      employee: null,
      error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { employee: await withEffectiveAccess(employee), error: null };
}

export async function requireFeature(feature) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return { employee: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const gated = await withEffectiveAccess(employee);
  if (!canAccess(gated.role, feature)) {
    return { employee: gated, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { employee: gated, error: null };
}

export function actorName(employee) {
  return `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim();
}
