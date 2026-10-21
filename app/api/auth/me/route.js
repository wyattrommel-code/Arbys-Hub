import { secureJson } from "@/lib/security/http";
import { getCurrentEmployee } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase-server";
import { publicStore, resolveStoreAccess } from "@/lib/store-access-server";
import { resourceApiError } from "@/lib/resources-api";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/session";

export async function GET() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return secureJson({ employee: null }, { status: 401 });
  }
  try {
    const context = await resolveStoreAccess(getSupabaseServer(), employee);
    const response = secureJson({ employee: { ...context.employee, access_tier: context.employee.role }, store: publicStore(context.store) });
    response.cookies.set(SESSION_COOKIE, await createSessionToken(context.employee), sessionCookieOptions());
    return response;
  } catch (error) { return resourceApiError(error); }
}
