import { cookies } from "next/headers";
import { canAccess } from "./permissions";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { getSupabaseServer } from "./supabase-server";
import { currentActor } from "./security/current-actor";

/** @returns {Promise<import("./session.js").SessionPayload | null>} */
export async function getCurrentEmployee() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) return null;
  try {
    return await currentActor(getSupabaseServer(), session);
  } catch {
    return null;
  }
}

/** @param {{ role?: string } | null | undefined} employee @param {string} feature */
export function employeeCanAccess(employee, feature) {
  return canAccess(employee?.role, feature);
}

/** @deprecated Use employeeCanAccess(employee, 'checklists.manage') */
export function isManager(employee) {
  return canAccess(employee?.role, "checklists.manage");
}
