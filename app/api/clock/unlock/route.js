import { guardPinAttempt } from "@/lib/security/pin-guard";
import { KIOSK_COOKIE } from "@/lib/security/kiosk";
import { secureJson } from "@/lib/security/http";
import { fetchEmployeeByPin } from "@/lib/employees";
import { getSupabaseServer } from "@/lib/supabase-server";
import { currentActor } from "@/lib/security/current-actor";
import { canAccess } from "@/lib/permissions";
import { createSessionToken, sessionCookieOptions } from "@/lib/session";
export async function POST(request) {
  const limited = await guardPinAttempt(request);
  if (limited) return limited;
  try {
    const { pin } = await request.json();
    const db = getSupabaseServer();
    const employee = await fetchEmployeeByPin(db, String(pin || ""));
    const actor = employee && await currentActor(db, { employee_id: employee.id });
    if (!actor || !canAccess(actor.role, "timeclock.full")) return secureJson({ ok: false, error: "Invalid manager PIN" }, { status: 401 });
    const response = secureJson({ ok: true });
    response.cookies.set(KIOSK_COOKIE, await createSessionToken(actor, "kiosk"), sessionCookieOptions());
    return response;
  } catch {
    return secureJson({ ok: false, error: "Could not unlock time clock" }, { status: 503 });
  }
}
