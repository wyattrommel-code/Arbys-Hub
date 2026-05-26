import { NextResponse } from "next/server";
import { getCurrentEmployee } from "@/lib/auth";
import { STORE_ID } from "@/lib/constants";
import { fetchCompletionsForDay, fetchTasksForDay } from "@/lib/checklist";
import { normalizeTaskRole, roleDisplayName } from "@/lib/checklist-roles";
import { CHECKLIST_ROLE_ORDER } from "@/lib/constants";
import { addDaysISO, getStoreDayOfWeek, getStoreToday } from "@/lib/store-time";
import { getSupabaseServer } from "@/lib/supabase-server";

function parseDateRange(searchParams) {
  const today = getStoreToday();
  const end = searchParams.get("end") || today;
  const start = searchParams.get("start") || addDaysISO(end, -6);
  return { start, end };
}

function datesInRange(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out;
}

export async function GET(request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const { start, end } = parseDateRange(searchParams);
  const employeeFilter = searchParams.get("employee_id") || "";
  const taskFilter = searchParams.get("task_id") || "";
  const shiftFilter = searchParams.get("shift") || "";
  const roleFilter = searchParams.get("role") || "";

  try {
    const supabase = getSupabaseServer();

    let query = supabase
      .from("checklist_completions")
      .select("*, checklist_tasks(title, verification_method, role)")
      .eq("store_id", STORE_ID)
      .gte("completion_date", start)
      .lte("completion_date", end)
      .order("completion_date", { ascending: false })
      .order("completed_at", { ascending: false });

    if (employeeFilter) query = query.eq("completed_by_employee_id", employeeFilter);
    if (taskFilter) query = query.eq("task_id", taskFilter);
    if (shiftFilter) query = query.eq("shift", shiftFilter);

    const { data: rawCompletions, error } = await query;
    if (error) throw error;

    let completions = rawCompletions || [];
    if (roleFilter) {
      completions = completions.filter(
        (c) => normalizeTaskRole(c.checklist_tasks?.role) === roleFilter
      );
    }

    const { data: allTasks, error: tasksErr } = await supabase
      .from("checklist_tasks")
      .select("*")
      .eq("store_id", STORE_ID)
      .eq("is_active", true);
    if (tasksErr) throw tasksErr;

    const { data: employees, error: empErr } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("store_id", STORE_ID)
      .eq("is_active", true)
      .order("first_name");
    if (empErr) throw empErr;

    const completionKeys = new Set(
      (completions || []).map((c) => `${c.completion_date}:${c.shift}:${c.task_id}`)
    );

    const uncompleted = [];
    for (const date of datesInRange(start, end)) {
      const dow = getStoreDayOfWeek(new Date(`${date}T12:00:00Z`));
      for (const task of allTasks || []) {
        if (task.day_of_week != null && Number(task.day_of_week) !== dow) continue;
        const shifts =
          task.shift === "BOTH" ? ["AM", "PM"] : [task.shift];
        for (const shift of shifts) {
          const key = `${date}:${shift}:${task.id}`;
          if (!completionKeys.has(key)) {
            uncompleted.push({
              completion_date: date,
              shift,
              task_id: task.id,
              task_title: task.title,
            });
          }
        }
      }
    }

    const perEmployee = {};
    for (const c of completions || []) {
      const id = c.completed_by_employee_id || "unknown";
      perEmployee[id] = (perEmployee[id] || 0) + 1;
    }

    return NextResponse.json({
      start,
      end,
      completions: completions || [],
      employees: employees || [],
      tasks: (allTasks || []).map((t) => ({ id: t.id, title: t.title, role: t.role })),
      roles: CHECKLIST_ROLE_ORDER.map((role) => ({
        value: role,
        label: roleDisplayName(role),
      })),
      summary: {
        totalCompletions: (completions || []).length,
        perEmployee,
        uncompleted,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to load report" }, { status: 500 });
  }
}
