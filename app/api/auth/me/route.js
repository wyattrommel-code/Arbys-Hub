import { NextResponse } from "next/server";
import { hubRoleFromAccessTier } from "@/lib/access-tier";
import { getCurrentEmployee } from "@/lib/auth";
import { getEffectiveAccess } from "@/lib/roles";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ employee: null }, { status: 401 });
  }
  let role = employee.role;
  try {
    role = hubRoleFromAccessTier(await getEffectiveAccess(getSupabaseServer(), employee.employee_id));
  } catch {
    role = employee.role;
  }
  const next = { ...employee, role, access_tier: role };
  const response = NextResponse.json({ employee: next });
  if (role !== employee.role) {
    const token = await createSessionToken({
      employee_id: employee.employee_id,
      first_name: employee.first_name,
      last_name: employee.last_name,
      role,
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  }
  return response;
}
