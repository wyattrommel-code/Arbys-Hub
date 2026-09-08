import { secureJson } from "@/lib/security/http";
import { getCurrentEmployee } from "@/lib/auth";
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
  const role = employee.role;
  const next = { ...employee, role, access_tier: role };
  const response = secureJson({ employee: next });
  {
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
