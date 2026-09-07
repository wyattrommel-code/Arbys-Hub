import { NextResponse } from "next/server";
import { requireFeature } from "@/lib/api-auth";
import { STORE_ID } from "@/lib/constants";
import { removeProfilePhoto, uploadProfilePhoto } from "@/lib/clock";
import { getSupabaseServer } from "@/lib/supabase-server";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

async function employeeExists(supabase, employeeId) {
  const { data, error } = await supabase
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .eq("store_id", STORE_ID)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function POST(request) {
  const { error } = await requireFeature("people");
  if (error) return error;
  try {
    const formData = await request.formData();
    const employeeId = String(formData.get("employee_id") || "").trim();
    const file = formData.get("file");
    if (!employeeId) {
      return NextResponse.json({ ok: false, error: "Employee is required." }, { status: 400 });
    }
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ ok: false, error: "Photo file is required." }, { status: 400 });
    }
    if (file.type && !ALLOWED_TYPES.has(String(file.type).toLowerCase())) {
      return NextResponse.json({ ok: false, error: "Use a JPEG, PNG, or WebP photo." }, { status: 400 });
    }
    const supabase = getSupabaseServer();
    if (!(await employeeExists(supabase, employeeId))) {
      return NextResponse.json({ ok: false, error: "Employee not found." }, { status: 404 });
    }
    const url = await uploadProfilePhoto(supabase, employeeId, file);
    return NextResponse.json({ ok: true, profile_photo_url: url });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || "Could not save profile photo." },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  const { error } = await requireFeature("people");
  if (error) return error;
  try {
    const url = new URL(request.url);
    const employeeId = String(url.searchParams.get("employee_id") || "").trim();
    if (!employeeId) {
      return NextResponse.json({ ok: false, error: "Employee is required." }, { status: 400 });
    }
    const supabase = getSupabaseServer();
    if (!(await employeeExists(supabase, employeeId))) {
      return NextResponse.json({ ok: false, error: "Employee not found." }, { status: 404 });
    }
    await removeProfilePhoto(supabase, employeeId);
    return NextResponse.json({ ok: true, profile_photo_url: null });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message || "Could not remove profile photo." },
      { status: 500 }
    );
  }
}
