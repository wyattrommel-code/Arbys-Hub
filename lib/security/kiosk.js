import { cookies } from "next/headers";
import { verifySessionToken } from "../session";
import { getSupabaseServer } from "../supabase-server";
import { canAccess } from "../permissions";
import { currentActor } from "./current-actor";
import { secureJson } from "./http";
export const KIOSK_COOKIE = "hub_kiosk";
export async function getKioskActor() {
  try {
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
  return secureJson({ ok: false, error: "A shift lead or manager must unlock this time clock." }, { status: 401 });
}
