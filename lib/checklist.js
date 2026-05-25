import { STORE_ID } from "./constants";
import { getStoreDayOfWeek } from "./store-time";

/**
 * Fetch active checklist tasks for a store, optionally filtered by shift and day.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ shift?: string | null, date?: string }} opts
 */
export async function fetchTasksForDay(supabase, { shift = null, date = null } = {}) {
  const dayOfWeek = date ? getStoreDayOfWeek(new Date(`${date}T12:00:00Z`)) : getStoreDayOfWeek();

  let query = supabase
    .from("checklist_tasks")
    .select("*")
    .eq("store_id", STORE_ID)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).filter((task) => {
    const dayMatch =
      task.day_of_week == null || Number(task.day_of_week) === dayOfWeek;
    if (!dayMatch) return false;
    if (!shift) return true;
    return task.shift === shift || task.shift === "BOTH";
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ date: string, shift?: string | null }} opts
 */
export async function fetchCompletionsForDay(supabase, { date, shift = null }) {
  let query = supabase
    .from("checklist_completions")
    .select("*")
    .eq("store_id", STORE_ID)
    .eq("completion_date", date);

  if (shift) {
    query = query.eq("shift", shift);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Merge tasks with completions into rows for UI. */
export function mergeTasksWithCompletions(tasks, completions, currentShift = null) {
  const byTaskShift = new Map();
  for (const c of completions) {
    byTaskShift.set(`${c.task_id}:${c.shift}`, c);
  }

  return tasks.map((task) => {
    const completionShift = resolveCompletionShift(task, currentShift || "AM");
    const completion = byTaskShift.get(`${task.id}:${completionShift}`) || null;
    return { task, completion, completionShift };
  });
}

/** For full-day view: group tasks by shift section. */
export function groupTasksByShift(tasks, completions, date) {
  const amTasks = tasks.filter((t) => t.shift === "AM" || t.shift === "BOTH");
  const pmTasks = tasks.filter((t) => t.shift === "PM" || t.shift === "BOTH");

  const completionMap = new Map(completions.map((c) => [`${c.task_id}:${c.shift}`, c]));

  function rowsFor(taskList, shift) {
    return taskList.map((task) => {
      const completion = completionMap.get(`${task.id}:${shift}`) || null;
      return { task, completion, completionShift: shift };
    });
  }

  return {
    date,
    am: rowsFor(amTasks, "AM"),
    pm: rowsFor(pmTasks, "PM"),
  };
}

/** All active tasks (including inactive for manage view). */
export async function fetchAllTasks(supabase, { includeInactive = false } = {}) {
  let query = supabase
    .from("checklist_tasks")
    .select("*")
    .eq("store_id", STORE_ID)
    .order("display_order", { ascending: true });

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/** Resolve which shift a completion should use for a task. */
export function resolveCompletionShift(task, currentShift) {
  if (task.shift === "AM" || task.shift === "PM") return task.shift;
  return currentShift;
}

export function isPhotoMethod(method) {
  return method === "photo" || method === "photo_ai";
}

export function employeeDisplayName(employee) {
  return `${employee.first_name} ${employee.last_name}`.trim();
}
