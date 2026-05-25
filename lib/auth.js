import { cookies } from "next/headers";
import { MANAGER_ROLES } from "./constants";
import { SESSION_COOKIE, verifySessionToken } from "./session";

/** @returns {Promise<import("./session.js").SessionPayload | null>} */
export async function getCurrentEmployee() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

/** @param {{ role?: string } | null | undefined} employee */
export function isManager(employee) {
  if (!employee?.role) return false;
  return MANAGER_ROLES.has(String(employee.role).toLowerCase());
}
