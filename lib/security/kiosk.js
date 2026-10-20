import { secureJson } from "./http";
import { hasClockDevice } from "./clock-device";
// Device enrollment authorizes station access, not employee punches or management.
// Every punch still validates the employee PIN and any required schedule approval.
export async function requireKiosk() {
  if (await hasClockDevice()) return null;
  return secureJson({ ok: false, error: "Use the authorized store iPad. Ask your GM to pair it if needed." }, { status: 401 });
}
