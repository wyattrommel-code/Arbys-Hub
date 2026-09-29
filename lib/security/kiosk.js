import { cookies } from "next/headers";
import { verifySessionToken } from "../session";
import { getSupabaseServer } from "../supabase-server";
import { canAccess } from "../permissions";
import { currentActor } from "./current-actor";
import { secureJson } from "./http";
import { hasClockDevice } from "./clock-device";
export const KIOSK_COOKIE = "hub_kiosk";
export async function getKioskActor() {
  try {
    if (!(await hasClockDevice())) return null;
    const token = (await cookies()).get(KIOSK_COOKIE)?.value;
    const session = await verifySessionToken(token, "kiosk");
    if (!session) return null;
    const actor = await currentActor(getSupabaseServer(), session);
    return actor && canAccess(actor.role, "timeclock.full") ? actor : null;
  } catch {
    return null;
  }
}
export async function requireKiosk() {
  if (await getKioskActor()) return null;
  return secureJson({ ok: false, error: "Use the authorized store iPad and have a shift lead or manager unlock it." }, { status: 401 });
}
