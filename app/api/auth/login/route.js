import { guardPinAttempt } from "@/lib/security/pin-guard";
import { secureJson } from "@/lib/security/http";
import { hubRoleFromAccessTier } from "@/lib/access-tier";
import { STORE_ID } from "@/lib/constants";
import { fetchEmployeeByPin } from "@/lib/employees";
import { getEffectiveAccess } from "@/lib/roles";
import { getSupabaseServer } from "@/lib/supabase-server";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/session";

export async function POST(request) {
  const pinError = await guardPinAttempt(request);
  if (pinError) return pinError;
  try {
    const body = await request.json();
    const pin = String(body.pin || "").trim();

    if (!/^\d{4}$/.test(pin)) {
      return secureJson({ ok: false, error: "Invalid PIN format" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const employee = await fetchEmployeeByPin(supabase, pin, STORE_ID);

    if (!employee) {
      return secureJson({ ok: false, error: "Invalid PIN" }, { status: 401 });
    }

    const tier = await getEffectiveAccess(supabase, employee.id);
    if (tier === "none") return secureJson({ ok: false, error: "Invalid PIN" }, { status: 401 });
    const accessRole = hubRoleFromAccessTier(tier);

    const sessionEmployee = {
      employee_id: employee.id,
      first_name: employee.first_name,
      last_name: employee.last_name,
      role: accessRole,
    };

    const token = await createSessionToken(sessionEmployee);
    const response = secureJson({ ok: true, employee: sessionEmployee });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (err) {
    return secureJson(
      { ok: false, error: "Login temporarily unavailable" },
      { status: 500 }
    );
  }
}
