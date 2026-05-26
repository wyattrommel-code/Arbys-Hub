import {
  CHECKLIST_ROLE_LABELS,
  CHECKLIST_ROLE_ORDER,
  CHECKLIST_ROLES_AM,
  CHECKLIST_ROLES_PM,
} from "./constants";
import { resolveCompletionShift } from "./checklist";

export function normalizeTaskRole(role) {
  const r = String(role || "any").trim();
  return CHECKLIST_ROLE_LABELS[r] ? r : "any";
}

export function roleDisplayName(role) {
  return CHECKLIST_ROLE_LABELS[normalizeTaskRole(role)] || "General";
}

export function rolesForShift(shift) {
  return shift === "AM" ? CHECKLIST_ROLES_AM : CHECKLIST_ROLES_PM;
}

export function defaultShiftForRole(role) {
  if (role === "opener") return "AM";
  if (role === "any") return null;
  return "PM";
}

/** Completion shift for a task row (handles BOTH + role on full-day view). */
export function completionShiftForTask(task, { currentShift = "AM", fullDay = false } = {}) {
  if (task.shift === "AM" || task.shift === "PM") return task.shift;
  const role = normalizeTaskRole(task.role);
  if (fullDay) {
    const roleDefault = defaultShiftForRole(role);
    if (roleDefault) return roleDefault;
    return "PM";
  }
  return resolveCompletionShift(task, currentShift);
}

export function verificationMethodLabel(method) {
  if (method === "photo_ai") return "Photo";
  if (method === "photo") return "Photo";
  if (method === "signature") return "Signature";
  return "Checkbox";
}

/**
 * Group today's tasks into role sections with completion rows.
 * @param {object[]} tasks
 * @param {object[]} completions
 * @param {{ currentShift?: string, fullDay?: boolean, date?: string }} opts
 */
export function groupTasksByRole(tasks, completions, { currentShift = "AM", fullDay = false } = {}) {
  const completionMap = new Map(completions.map((c) => [`${c.task_id}:${c.shift}`, c]));
  const visibleRoles = fullDay ? new Set(CHECKLIST_ROLE_ORDER) : rolesForShift(currentShift);

  const sections = [];

  for (const role of CHECKLIST_ROLE_ORDER) {
    if (!visibleRoles.has(role)) continue;

    const roleTasks = tasks.filter((t) => normalizeTaskRole(t.role) === role);
    if (roleTasks.length === 0) continue;

    const rows = roleTasks.map((task) => {
      const completionShift = completionShiftForTask(task, { currentShift, fullDay });
      const completion = completionMap.get(`${task.id}:${completionShift}`) || null;
      return { task, completion, completionShift };
    });

    sections.push({
      role,
      label: roleDisplayName(role),
      rows,
      completeCount: rows.filter((r) => r.completion).length,
      totalCount: rows.length,
    });
  }

  return { sections };
}
