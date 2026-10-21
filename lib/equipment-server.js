import { randomUUID } from "node:crypto";
import { authorizedStoreId } from "./store-scope.js";
import { requireScopedFeature } from "./store-access-server.js";
import { resourceError } from "./resources.js";
import { EQUIPMENT_BUCKET, MAX_MANUAL_BYTES, nextScheduleDate, storeToday, validateEquipment, validateEquipmentSchedule, validateManual, validISODate } from "./equipment.js";

export function equipmentId(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || "")) throw resourceError("Equipment or document not found.", 404);
  return value;
}

function publicEquipment(row) {
  const { store_id: _store, created_by: _creator, updated_by: _editor, ...details } = row;
  return details;
}

function publicManual(row) {
  const { id, title, file_name, file_size, created_at, status } = row;
  return { id, title, file_name, file_size, created_at, status };
}

async function allRows(factory) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await factory().range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data || []);
    if ((data || []).length < 500) return rows;
  }
}

export async function equipmentRecord(supabase, employee, id) {
  const storeId = authorizedStoreId(employee);
  const { data, error } = await supabase.from("hub_equipment").select("*").eq("store_id", storeId).eq("id", equipmentId(id)).maybeSingle();
  if (error) throw error;
  if (!data) throw resourceError("Equipment not found in this store.", 404);
  return data;
}

export async function ensureEquipmentTasks(supabase, employee, store) {
  const today = storeToday(store.timezone);
  const { error } = await supabase.rpc("ensure_hub_equipment_tasks", { p_store: authorizedStoreId(employee), p_today: today });
  if (error) throw error;
  return today;
}

export async function listEquipment(supabase, employee, store) {
  const storeId = authorizedStoreId(employee);
  const today = await ensureEquipmentTasks(supabase, employee, store);
  const [equipment, due] = await Promise.all([
    allRows(() => supabase.from("hub_equipment").select("*").eq("store_id", storeId).order("name").order("id")),
    allRows(() => supabase.from("hub_equipment_tasks").select("id,equipment_id,due_date").eq("store_id", storeId).eq("status", "pending").lte("due_date", today).order("id")),
  ]);
  return equipment.map((row) => ({ ...publicEquipment(row), due_count: due.filter((task) => task.equipment_id === row.id).length }));
}

export async function equipmentHistory(supabase, employee, id, offset = 0) {
  await equipmentRecord(supabase, employee, id);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw resourceError("Invalid history page.");
  const { data, error } = await supabase.from("hub_equipment_tasks").select("id,schedule_id,schedule_version,due_date,shift,title,instructions,kind,responsible_role,status,completed_at,completed_by_name,notes,created_at,cancelled_at")
    .eq("store_id", authorizedStoreId(employee)).eq("equipment_id", id).order("due_date", { ascending: false }).order("created_at", { ascending: false }).order("id").range(offset, offset + 50);
  if (error) throw error;
  return { history: (data || []).slice(0, 50), has_more: (data || []).length > 50 };
}

export async function equipmentDetails(supabase, employee, store, id) {
  const equipment = await equipmentRecord(supabase, employee, id);
  const today = await ensureEquipmentTasks(supabase, employee, store);
  const storeId = authorizedStoreId(employee);
  const [manuals, schedules, history, completedToday] = await Promise.all([
    allRows(() => supabase.from("hub_equipment_manuals").select("id,title,file_name,file_size,created_at,status").eq("store_id", storeId).eq("equipment_id", id).eq("status", "ready").order("created_at").order("id")),
    allRows(() => supabase.from("hub_equipment_schedules").select("id,kind,title,instructions,frequency_unit,frequency_interval,start_date,shift,responsible_role,is_active,version").eq("store_id", storeId).eq("equipment_id", id).order("created_at").order("id")),
    equipmentHistory(supabase, employee, id),
    allRows(() => supabase.from("hub_equipment_tasks").select("id,schedule_id,shift").eq("store_id", storeId).eq("equipment_id", id).eq("status", "completed").eq("due_date", today).order("id")),
  ]);
  const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return { equipment: publicEquipment(equipment), manuals, schedules: schedules.map((schedule) => ({ ...schedule, next_due_date: schedule.is_active && equipment.status === "active" ? nextScheduleDate(schedule, completedToday.some((task) => task.schedule_id === schedule.id && task.shift === schedule.shift) ? tomorrow.toISOString().slice(0, 10) : today) : null })), ...history };
}

export async function saveEquipment(supabase, employee, input, id = null) {
  requireScopedFeature(employee, "database.manage");
  const values = validateEquipment(input);
  if (id) {
    equipmentId(id);
    if (!Number.isInteger(input.version) || input.version < 1) throw resourceError("Reload this equipment before saving.", 409);
  }
  const { data, error } = await supabase.rpc("save_hub_equipment", { p_store: authorizedStoreId(employee), p_actor: employee.employee_id, p_id: id, p_version: id ? input.version : null, p_values: values });
  if (error) throw error;
  return publicEquipment(data);
}

export async function saveEquipmentSchedule(supabase, employee, store, equipment, input, id = null) {
  requireScopedFeature(employee, "database.manage");
  equipmentId(equipment);
  if (id) {
    equipmentId(id);
    if (!Number.isInteger(input.version) || input.version < 1) throw resourceError("Reload this schedule before saving.", 409);
  }
  const values = validateEquipmentSchedule(input, storeToday(store.timezone), Boolean(id));
  const { data, error } = await supabase.rpc("save_hub_equipment_schedule", { p_store: authorizedStoreId(employee), p_actor: employee.employee_id, p_equipment: equipment, p_id: id, p_version: id ? input.version : null, p_values: values });
  if (error) throw error;
  return data;
}

export async function beginManualUpload(supabase, employee, equipment, input) {
  requireScopedFeature(employee, "database.manage");
  await equipmentRecord(supabase, employee, equipment);
  const values = validateManual(input);
  const id = randomUUID();
  const path = `${authorizedStoreId(employee)}/${equipment}/${id}.pdf`;
  const { error } = await supabase.from("hub_equipment_manuals").insert({ ...values, id, store_id: authorizedStoreId(employee), equipment_id: equipment, object_path: path, uploaded_by: employee.employee_id });
  if (error) throw error;
  const ticket = await supabase.storage.from(EQUIPMENT_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (ticket.error) {
    await supabase.from("hub_equipment_manuals").update({ status: "archived" }).eq("store_id", authorizedStoreId(employee)).eq("id", id);
    throw ticket.error;
  }
  return { id, path, token: ticket.data.token, bucket: EQUIPMENT_BUCKET };
}

async function manualRecord(supabase, employee, equipment, id) {
  const { data, error } = await supabase.from("hub_equipment_manuals").select("*").eq("store_id", authorizedStoreId(employee)).eq("equipment_id", equipmentId(equipment)).eq("id", equipmentId(id)).maybeSingle();
  if (error) throw error;
  if (!data || data.status === "archived") throw resourceError("Manual not found in this store.", 404);
  return data;
}

export async function finishManualUpload(supabase, employee, equipment, id) {
  requireScopedFeature(employee, "database.manage");
  const row = await manualRecord(supabase, employee, equipment, id);
  if (row.status === "ready") return publicManual(row);
  const { data: info, error: infoError } = await supabase.storage.from(EQUIPMENT_BUCKET).info(row.object_path);
  if (infoError) throw resourceError("The PDF upload has not finished. Please retry the upload.", 409);
  const size = Number(info.size ?? info.metadata?.size);
  const type = info.contentType || info.metadata?.mimetype;
  if (size !== row.file_size || size > MAX_MANUAL_BYTES || type !== "application/pdf") throw resourceError("The uploaded file does not match this PDF. Please remove it and upload again.");
  const { data, error } = await supabase.from("hub_equipment_manuals").update({ status: "ready" }).eq("store_id", authorizedStoreId(employee)).eq("equipment_id", equipment).eq("id", id).eq("status", "uploading").select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw resourceError("This upload was cancelled. Please choose the PDF again.", 409);
  return publicManual(data);
}

export async function archiveManual(supabase, employee, equipment, id) {
  requireScopedFeature(employee, "database.manage");
  await manualRecord(supabase, employee, equipment, id);
  const { error } = await supabase.from("hub_equipment_manuals").update({ status: "archived" }).eq("store_id", authorizedStoreId(employee)).eq("equipment_id", equipment).eq("id", id);
  if (error) throw error;
}

export async function downloadManual(supabase, employee, equipment, id) {
  const row = await manualRecord(supabase, employee, equipment, id);
  if (row.status !== "ready") throw resourceError("This PDF is not ready yet.", 404);
  const { data, error } = await supabase.storage.from(EQUIPMENT_BUCKET).createSignedUrl(row.object_path, 60, { download: row.file_name });
  if (error) throw error;
  return data.signedUrl;
}

export async function dueEquipmentTasks(supabase, employee, store, date = null) {
  const today = await ensureEquipmentTasks(supabase, employee, store);
  const viewDate = date || today;
  if (!validISODate(viewDate) || viewDate > today) throw resourceError("Choose today or an earlier checklist date.");
  const storeId = authorizedStoreId(employee);
  const [pending, completed] = await Promise.all([
    allRows(() => supabase.from("hub_equipment_tasks").select("*").eq("store_id", storeId).eq("status", "pending").lte("due_date", viewDate).order("due_date").order("id")),
    allRows(() => supabase.from("hub_equipment_tasks").select("*").eq("store_id", storeId).eq("status", "completed").eq("completed_date", viewDate).order("due_date").order("id")),
  ]);
  const ranks = ["crew", "shift_lead", "assistant_manager", "gm"];
  return { date: viewDate, tasks: [...pending, ...completed].map((row) => ({ id: row.id, equipment_id: row.equipment_id, equipment_name: row.equipment_name, title: row.title, instructions: row.instructions, kind: row.kind, due_date: row.due_date, shift: row.shift, responsible_role: row.responsible_role, status: row.status, completed_at: row.completed_at, completed_by_name: row.completed_by_name, notes: row.notes, overdue: row.due_date < today, can_complete: viewDate === today && row.status === "pending" && ranks.indexOf(employee.role) >= ranks.indexOf(row.responsible_role) })) };
}

export async function completeEquipmentTask(supabase, employee, id, input) {
  const storeId = authorizedStoreId(employee);
  equipmentId(id);
  if (input.notes != null && typeof input.notes !== "string") throw resourceError("Invalid completion notes.");
  const notes = (input.notes || "").trim();
  if (notes.length > 10000) throw resourceError("Keep completion notes to 10,000 characters or fewer.");
  const { data: task, error: taskError } = await supabase.from("hub_equipment_tasks").select("status,responsible_role").eq("store_id", storeId).eq("id", id).maybeSingle();
  if (taskError) throw taskError;
  if (!task) throw resourceError("This equipment task was not found in your store.", 404);
  const ranks = ["crew", "shift_lead", "assistant_manager", "gm"];
  if (task.status === "pending" && (ranks.indexOf(employee.role) < 0 || ranks.indexOf(task.responsible_role) < 0 || ranks.indexOf(employee.role) < ranks.indexOf(task.responsible_role))) throw resourceError("This task requires a supervisor.", 403);
  const { data, error } = await supabase.rpc("complete_hub_equipment_task", { p_store: authorizedStoreId(employee), p_actor: employee.employee_id, p_task: id, p_notes: notes });
  if (error) throw error;
  return data;
}
