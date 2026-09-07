import { NextResponse } from "next/server";
import {
  ensureBrookelynnAssistantManager,
  ensureProfilePhotosBucket,
  ensurePunchPhotosBucket,
  fetchClockRoster,
} from "@/lib/clock";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET() {
  try {
    const supabase = getSupabaseServer();
    await ensureBrookelynnAssistantManager(supabase);
    try {
      await Promise.all([ensurePunchPhotosBucket(supabase), ensureProfilePhotosBucket(supabase)]);
    } catch (bucketErr) {
      console.error("clock photo buckets", bucketErr);
    }
    const employees = await fetchClockRoster(supabase);
    return NextResponse.json({
      ok: true,
      synced_at: new Date().toISOString(),
      employees,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || "Could not load roster." },
      { status: 500 }
    );
  }
}
