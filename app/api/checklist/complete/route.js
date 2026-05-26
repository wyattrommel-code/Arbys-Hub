import { NextResponse } from "next/server";
import { getCurrentEmployee } from "@/lib/auth";
import { STORE_ID } from "@/lib/constants";
import { employeeDisplayName, resolveCompletionShift } from "@/lib/checklist";
import { getCurrentShift, getStoreToday } from "@/lib/store-time";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function POST(request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { task_id, shift: shiftParam, completion_date } = body;

    if (!task_id) {
      return NextResponse.json({ error: "task_id required" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { data: task, error: taskErr } = await supabase
      .from("checklist_tasks")
      .select("*")
      .eq("id", task_id)
      .eq("store_id", STORE_ID)
      .maybeSingle();

    if (taskErr) throw taskErr;
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const date = completion_date || getStoreToday();
    const shift = shiftParam || resolveCompletionShift(task, getCurrentShift());
    const name = employeeDisplayName(employee);
    const now = new Date().toISOString();

    const noteText =
      typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

    const { data, error } = await supabase
      .from("checklist_completions")
      .insert({
        store_id: STORE_ID,
        task_id,
        completion_date: date,
        shift,
        completed_by_employee_id: employee.employee_id,
        completed_by_name: name,
        completed_at: now,
        verification_method: task.verification_method,
        photo_url: body.photo_url || null,
        notes: noteText,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await supabase
          .from("checklist_completions")
          .select("*")
          .eq("task_id", task_id)
          .eq("completion_date", date)
          .eq("shift", shift)
          .eq("store_id", STORE_ID)
          .maybeSingle();
        if (existing?.id && noteText) {
          await supabase
            .from("checklist_completions")
            .update({ notes: noteText })
            .eq("id", existing.id)
            .eq("store_id", STORE_ID);
          const { data: merged } = await supabase
            .from("checklist_completions")
            .select("*")
            .eq("id", existing.id)
            .single();
          return NextResponse.json({ completion: merged || existing, noop: true });
        }
        return NextResponse.json({ completion: existing, noop: true });
      }
      throw error;
    }

    return NextResponse.json({ completion: data });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to complete task" }, { status: 500 });
  }
}

export async function PATCH(request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { completion_id } = body;
    if (!completion_id) {
      return NextResponse.json({ error: "completion_id required" }, { status: 400 });
    }

    const noteText =
      typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("checklist_completions")
      .update({ notes: noteText })
      .eq("id", completion_id)
      .eq("store_id", STORE_ID)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ completion: data });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to update note" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { completion_id, task_id, shift, completion_date } = body;

    const supabase = getSupabaseServer();

    if (completion_id) {
      const { error } = await supabase
        .from("checklist_completions")
        .delete()
        .eq("id", completion_id)
        .eq("store_id", STORE_ID);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (!task_id || !shift || !completion_date) {
      return NextResponse.json({ error: "completion_id or task_id+shift+date required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("checklist_completions")
      .delete()
      .eq("task_id", task_id)
      .eq("shift", shift)
      .eq("completion_date", completion_date)
      .eq("store_id", STORE_ID);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to remove completion" }, { status: 500 });
  }
}
