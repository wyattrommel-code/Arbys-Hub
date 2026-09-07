import { NextResponse } from "next/server";
import { requireFeature, requireSession } from "@/lib/api-auth";
import { createOffer, httpError, loadApprovalQueue, loadMarketplace } from "@/lib/shift-offers";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  if (view === "queue") {
    const { employee, error } = await requireFeature("schedule.full");
    if (error) return error;
    try {
      const payload = await loadApprovalQueue(getSupabaseServer(), employee);
      return NextResponse.json({ ok: true, ...payload });
    } catch (err) {
      const { status, message } = httpError(err);
      return NextResponse.json({ ok: false, error: message }, { status });
    }
  }

  const { employee, error } = await requireSession();
  if (error) return error;
  try {
    const payload = await loadMarketplace(getSupabaseServer(), employee);
    return NextResponse.json({ ok: true, ...payload });
  } catch (err) {
    const { status, message } = httpError(err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(request) {
  const { employee, error } = await requireSession();
  if (error) return error;
  try {
    const body = await request.json();
    const offer = await createOffer(getSupabaseServer(), employee, body);
    return NextResponse.json({ ok: true, offer });
  } catch (err) {
    const { status, message } = httpError(err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
