import { secureJson } from "@/lib/security/http";
import { getCurrentEmployee } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";

export async function requireSession() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return {
      employee: null,
      error: secureJson({ ok: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { employee, error: null };
}

export async function requireFeature(feature) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return { employee: null, error: secureJson({ error: "Unauthorized" }, { status: 401 }) };
  }
  const gated = employee;
  if (!canAccess(gated.role, feature)) {
    return { employee: gated, error: secureJson({ error: "Forbidden" }, { status: 403 }) };
  }
  return { employee: gated, error: null };
}

export function actorName(employee) {
  return `${employee?.first_name || ""} ${employee?.last_name || ""}`.trim();
}
