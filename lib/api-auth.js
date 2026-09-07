import { NextResponse } from "next/server";
import { getCurrentEmployee } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";

export async function requireSession() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return {
      employee: null,
      error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { employee, error: null };
}

export async function requireFeature(feature) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return { employee: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canAccess(employee.role, feature)) {
    return { employee, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { employee, error: null };
}

export function actorName(employee) {
  return `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim();
}
