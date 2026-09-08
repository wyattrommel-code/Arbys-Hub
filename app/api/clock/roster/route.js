import { requireKiosk } from "@/lib/security/kiosk";
import { secureJson } from "@/lib/security/http";
import {
  fetchClockRoster,
} from "@/lib/clock";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET() {
  const kioskError = await requireKiosk();
  if (kioskError) return kioskError;
  try {
    const supabase = getSupabaseServer();
    const employees = await fetchClockRoster(supabase);
    return secureJson({
      ok: true,
      synced_at: new Date().toISOString(),
      employees,
    });
  } catch (err) {
    return secureJson(
      { ok: false, error: err.message || "Could not load roster." },
      { status: 500 }
    );
  }
}
