import { secureJson } from "@/lib/security/http";
import { hasClockDevice } from "@/lib/security/clock-device";

// Compatibility for an older clock page. Pairing is sufficient; never issue a
// manager session or treat this station access as unscheduled-work approval.
export async function POST() {
  try {
    if (!(await hasClockDevice({ throwOnError: true }))) return secureJson({ ok: false, error: "This device is not authorized. Ask your GM to pair the store iPad." }, { status: 403 });
    return secureJson({ ok: true });
  } catch {
    return secureJson({ ok: false, error: "Time clock connection unavailable." }, { status: 503 });
  }
}
