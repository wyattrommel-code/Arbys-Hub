import { NextResponse } from "next/server";
import { getCurrentEmployee } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { STORE_ID } from "@/lib/constants";
import { fetchCompletionsForDay, fetchTasksForDay } from "@/lib/checklist";
import { groupTasksByRole } from "@/lib/checklist-roles";
import { getCurrentShift, getStoreToday } from "@/lib/store-time";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") || "current";
  /** Full-day AM+PM view (preferred); `mode=full` kept for backward compatibility. */
  const view = searchParams.get("view");
  const fullDay = view === "roles-full" || view === "shifts" || mode === "full";
  const date = searchParams.get("date") || getStoreToday();
  const shift = searchParams.get("shift") || getCurrentShift();

  try {
    const supabase = getSupabaseServer();

    if (mode === "manage") {
      if (!canAccess(employee.role, "checklists.manage")) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      const { data, error } = await supabase
        .from("checklist_tasks")
        .select("*")
        .eq("store_id", STORE_ID)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return NextResponse.json({ tasks: data || [] });
    }

    {
      const tasks = await fetchTasksForDay(supabase, {
        date,
        shift: fullDay ? null : shift,
      });
      const completions = await fetchCompletionsForDay(supabase, {
        date,
        shift: fullDay ? null : shift,
      });
      const { sections } = groupTasksByRole(tasks, completions, {
        currentShift: shift,
        fullDay,
      });
      const allRows = sections.flatMap((s) => s.rows);
      return NextResponse.json({
        date,
        shift,
        sections,
        completeCount: allRows.filter((r) => r.completion).length,
        totalCount: allRows.length,
      });
    }

  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to load checklist" }, { status: 500 });
  }
}

export async function POST(request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccess(employee.role, "checklists.manage")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const supabase = getSupabaseServer();
    const dayOfWeek =
      body.day_of_week === "" || body.day_of_week == null
        ? null
        : Number(body.day_of_week);

    const { data, error } = await supabase
      .from("checklist_tasks")
      .insert({
        store_id: STORE_ID,
        title: body.title,
        description: body.description || null,
        day_of_week: dayOfWeek,
        shift: body.shift || "BOTH",
        verification_method: body.verification_method || "checkbox",
        role: body.role || "any",
        display_order: Number(body.display_order) || 0,
        is_active: body.is_active !== false,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ task: data });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to create task" }, { status: 500 });
  }
}

export async function PATCH(request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccess(employee.role, "checklists.manage")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) {
      return NextResponse.json({ error: "Task id required" }, { status: 400 });
    }

    const payload = {};
    if ("title" in updates) payload.title = updates.title;
    if ("description" in updates) payload.description = updates.description || null;
    if ("day_of_week" in updates) {
      payload.day_of_week =
        updates.day_of_week === "" || updates.day_of_week == null
          ? null
          : Number(updates.day_of_week);
    }
    if ("shift" in updates) payload.shift = updates.shift;
    if ("verification_method" in updates) payload.verification_method = updates.verification_method;
    if ("role" in updates) payload.role = updates.role || "any";
    if ("display_order" in updates) payload.display_order = Number(updates.display_order) || 0;
    if ("is_active" in updates) payload.is_active = Boolean(updates.is_active);

    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("checklist_tasks")
      .update(payload)
      .eq("id", id)
      .eq("store_id", STORE_ID)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ task: data });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to update task" }, { status: 500 });
  }
}
