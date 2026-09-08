import { isGm, isShiftLeadOrAbove } from "../permissions.js";
export function canChangeCompletion(actor, completion) {
  return Boolean(actor && completion && (isGm(actor.role) || completion.completed_by_employee_id === actor.employee_id));
}
export function completionInputError(actor, task, date, shift, today, hasImage) {
  if (!task?.is_active) return "Task is inactive";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["AM", "PM"].includes(shift)) return "Invalid completion date or shift";
  if (!isGm(actor.role) && date !== today) return "Only a GM can change another day's checklist";
  if (task.shift !== "BOTH" && task.shift !== shift) return "Incorrect shift for this task";
  if (task.day_of_week != null && new Date(`${date}T12:00:00Z`).getUTCDay() !== Number(task.day_of_week)) return "Task is not scheduled for this day";
  if (/manager|shift_lead|lead/.test(task.role || "") && !isShiftLeadOrAbove(actor.role)) return "A shift lead must complete this task";
  if (["photo", "photo_ai", "signature"].includes(task.verification_method) && !hasImage) return "Use the photo or signature upload to complete this task";
  return null;
}
