import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { cancelOffer, claimDropOffer, httpError, reviewOffer } from "@/lib/shift-offers";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request, context) {
  const { employee, error } = await requireSession();
  if (error) return error;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const action = String(body.action || "").trim();
    const supabase = getSupabaseServer();
    let offer;
    if (action === "claim") {
      offer = await claimDropOffer(supabase, employee, id);
    } else if (action === "cancel") {
      offer = await cancelOffer(supabase, employee, id);
    } else if (action === "approve" || action === "approve_open" || action === "deny") {
      offer = await reviewOffer(supabase, employee, id, action, body.note);
    } else {
      return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, offer });
  } catch (err) {
    const { status, message } = httpError(err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
