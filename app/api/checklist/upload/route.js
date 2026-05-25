import { NextResponse } from "next/server";
import { getCurrentEmployee } from "@/lib/auth";
import { CHECKLIST_PHOTOS_BUCKET, STORE_ID } from "@/lib/constants";
import { resolveCompletionShift } from "@/lib/checklist";
import { getCurrentShift, getStoreToday } from "@/lib/store-time";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const taskId = formData.get("task_id");
    const shiftParam = formData.get("shift");
    const completionDate = formData.get("completion_date") || getStoreToday();

    if (!file || typeof file === "string" || !taskId) {
      return NextResponse.json({ error: "file and task_id required" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { data: task, error: taskErr } = await supabase
      .from("checklist_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("store_id", STORE_ID)
      .maybeSingle();

    if (taskErr) throw taskErr;
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const shift = shiftParam || resolveCompletionShift(task, getCurrentShift());
    const timestamp = Date.now();
    const path = `${STORE_ID}/${completionDate}/${taskId}-${timestamp}.jpg`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadErr } = await supabase.storage
      .from(CHECKLIST_PHOTOS_BUCKET)
      .upload(path, buffer, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });

    if (uploadErr) throw uploadErr;

    const { data: publicData } = supabase.storage.from(CHECKLIST_PHOTOS_BUCKET).getPublicUrl(path);
    const photoUrl = publicData.publicUrl;

    const name = `${employee.first_name} ${employee.last_name}`.trim();
    const now = new Date().toISOString();

    const { data: completion, error: insertErr } = await supabase
      .from("checklist_completions")
      .insert({
        store_id: STORE_ID,
        task_id: taskId,
        completion_date: completionDate,
        shift,
        completed_by_employee_id: employee.employee_id,
        completed_by_name: name,
        completed_at: now,
        verification_method: task.verification_method,
        photo_url: photoUrl,
      })
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        const { data: existing } = await supabase
          .from("checklist_completions")
          .select("*")
          .eq("task_id", taskId)
          .eq("completion_date", completionDate)
          .eq("shift", shift)
          .eq("store_id", STORE_ID)
          .maybeSingle();
        return NextResponse.json({ completion: existing, photo_url: photoUrl, noop: true });
      }
      throw insertErr;
    }

    return NextResponse.json({ completion, photo_url: photoUrl });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Upload failed" }, { status: 500 });
  }
}
