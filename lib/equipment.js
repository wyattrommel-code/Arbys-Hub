import { resourceError } from "./resources.js";

export const EQUIPMENT_BUCKET = "equipment-documents";
export const MAX_MANUAL_BYTES = 50 * 1024 * 1024;
export const EQUIPMENT_STATES = ["active", "out_of_service", "retired"];
export const DUTY_ROLES = [{ value: "crew", label: "Any team member" }, { value: "shift_lead", label: "Shift lead or above" }, { value: "assistant_manager", label: "Assistant manager or GM" }, { value: "gm", label: "GM" }];

function textField(input, key, max, required = false) {
  if (input[key] != null && typeof input[key] !== "string") throw resourceError(`Invalid ${key.replaceAll("_", " ")}.`);
  const value = (input[key] || "").trim();
  if ((required && !value) || value.length > max) throw resourceError(`${key.replaceAll("_", " ")} must be ${required ? "1–" : "at most "}${max} characters.`);
  return value;
}

export function validateEquipment(input) {
  if (!input || typeof input !== "object") throw resourceError("Invalid equipment details.");
  const status = input.status || "active";
  if (!EQUIPMENT_STATES.includes(status)) throw resourceError("Choose a valid equipment status.");
  return { name: textField(input, "name", 120, true), manufacturer: textField(input, "manufacturer", 120), model: textField(input, "model", 120), serial_number: textField(input, "serial_number", 120), location: textField(input, "location", 120), notes: textField(input, "notes", 10000), service_contact: textField(input, "service_contact", 500), status };
}

export function validISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function storeToday(timezone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validateEquipmentSchedule(input, today, editing = false) {
  if (!input || typeof input !== "object") throw resourceError("Invalid schedule.");
  if (!["cleaning", "maintenance"].includes(input.kind)) throw resourceError("Choose cleaning or maintenance.");
  if (!["days", "weeks", "months"].includes(input.frequency_unit)) throw resourceError("Choose days, weeks, or months.");
  if (!Number.isInteger(input.frequency_interval) || input.frequency_interval < 1 || input.frequency_interval > 365) throw resourceError("Choose an interval between 1 and 365.");
  if (!["AM", "PM"].includes(input.shift)) throw resourceError("Choose an AM or PM shift.");
  if (!DUTY_ROLES.some((role) => role.value === input.responsible_role)) throw resourceError("Choose who is responsible.");
  if (!validISODate(input.start_date)) throw resourceError("Choose a valid first due date.");
  const age = (new Date(`${today}T12:00:00Z`) - new Date(`${input.start_date}T12:00:00Z`)) / 86400000;
  if ((!editing && age > 366) || age < -3660) throw resourceError(editing ? "Choose a first due date no more than ten years ahead." : "Choose a first due date within the last year or next ten years.");
  if (typeof input.is_active !== "boolean") throw resourceError("Choose whether this schedule is active.");
  return { title: textField(input, "title", 160, true), instructions: textField(input, "instructions", 30000), kind: input.kind, frequency_unit: input.frequency_unit, frequency_interval: input.frequency_interval, start_date: input.start_date, shift: input.shift, responsible_role: input.responsible_role, is_active: input.is_active };
}

export function validateManual(input) {
  const file_name = textField(input, "file_name", 180, true).replace(/[\\/\x00-\x1f\x7f]/g, "_");
  if (!/\.pdf$/i.test(file_name)) throw resourceError("Choose a PDF manual.");
  if (!Number.isInteger(input.file_size) || input.file_size < 5 || input.file_size > MAX_MANUAL_BYTES) throw resourceError("PDF manuals must be 50 MB or smaller.");
  return { title: textField(input, "title", 160, true), file_name, file_size: input.file_size };
}

export function scheduleLabel(schedule) {
  const unit = schedule.frequency_unit.slice(0, -1);
  const frequency = `Every ${schedule.frequency_interval === 1 ? unit : `${schedule.frequency_interval} ${schedule.frequency_unit}`} · ${schedule.shift}`;
  const next = schedule.next_due_date ? new Date(`${schedule.next_due_date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;
  return `${frequency}${next ? ` · Next due ${next}` : ""}`;
}

export function nextScheduleDate(schedule, from) {
  if (!validISODate(schedule.start_date) || !validISODate(from)) throw resourceError("Invalid schedule date.");
  const anchor = new Date(`${schedule.start_date}T12:00:00Z`);
  const target = new Date(`${from}T12:00:00Z`);
  if (schedule.frequency_unit !== "months") {
    const days = schedule.frequency_interval * (schedule.frequency_unit === "weeks" ? 7 : 1);
    const elapsed = Math.max(0, Math.ceil((target - anchor) / 86400000 / days));
    anchor.setUTCDate(anchor.getUTCDate() + elapsed * days);
    return anchor.toISOString().slice(0, 10);
  }
  const monthGap = Math.max(0, (target.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + target.getUTCMonth() - anchor.getUTCMonth());
  let step = Math.ceil(monthGap / schedule.frequency_interval);
  function dateForStep() {
    const month = anchor.getUTCMonth() + step * schedule.frequency_interval;
    const last = new Date(Date.UTC(anchor.getUTCFullYear(), month + 1, 0, 12)).getUTCDate();
    return new Date(Date.UTC(anchor.getUTCFullYear(), month, Math.min(anchor.getUTCDate(), last), 12));
  }
  let next = dateForStep();
  if (next < target) { step++; next = dateForStep(); }
  return next.toISOString().slice(0, 10);
}
