import { randomUUID } from "node:crypto";
import { authorizedStoreId } from "./store-scope.js";
import { canAccess } from "./permissions.js";
import { RESOURCE_BUCKET, resourceError, validateResource, validateResourceFile, validateResourceCategories } from "./resources.js";

export function requireResourceAccess(employee, manage = false) {
  if (!employee) throw resourceError("Please sign in to view the database.", 401);
  if (!canAccess(employee.role, manage ? "database.manage" : "database.view")) throw resourceError("You don't have access to manage these resources.", 403);
  authorizedStoreId(employee);
}

export function checkResourceOrigin(request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw resourceError("Please reload the page and try again.", 403);
}

function checkId(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "")) throw resourceError("Resource not found.", 404);
}

export function publicResource(row) {
  const { id, title, category, summary, notes, url, visibility, pinned, archived, file_name, file_size, mime_type, version, created_at, updated_at } = row;
  return { id, title, category, summary, notes, url, visibility, pinned, archived, file_name, file_size, mime_type, version, created_at, updated_at, tags: row.tags || [] };
}

export async function loadResourceCategories(supabase, employee) {
  requireResourceAccess(employee);
  const { data, error } = await supabase.rpc("get_hub_resource_library", { p_store_id: authorizedStoreId(employee) });
  if (error) throw error;
  return { categories: data.categories, version: data.version };
}

export async function saveResourceCategories(supabase, employee, input) {
  requireResourceAccess(employee, true);
  const categories = validateResourceCategories(input?.categories);
  const existing = await loadResourceCategories(supabase, employee);
  if (!Number.isInteger(input.version) || input.version !== existing.version) throw resourceError("Someone changed the tabs. Close this window and reload before saving.", 409);
  const keys = new Set(categories.map((category) => category.value));
  if (existing.categories.some((category) => !keys.has(category.value))) throw resourceError("Existing tabs cannot be removed. Rename or reorder them instead.");
  const oldKeys = new Set(existing.categories.map((category) => category.value));
  if (categories.some((category) => !oldKeys.has(category.value) && !/^custom_[0-9a-f]{32}$/.test(category.value))) throw resourceError("Invalid new tab. Reload the database and try again.");
  const { data, error } = await supabase.rpc("save_hub_resource_tabs", { p_store_id: authorizedStoreId(employee), p_version: input.version, p_tabs: categories });
  if (error?.message?.includes("resource_tabs_conflict")) throw resourceError("Someone changed the tabs. Close this window and reload before saving.", 409);
  if (error) throw error;
  return { categories: data.categories, version: data.version };
}

export async function listResources(supabase, employee, { archived = false } = {}) {
  requireResourceAccess(employee, archived);
  let query = supabase.from("hub_resources").select("*").eq("store_id", authorizedStoreId(employee)).eq("archived", archived);
  if (!canAccess(employee.role, "database.manage")) query = query.eq("visibility", "team");
  const { data, error } = await query.order("pinned", { ascending: false }).order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(publicResource);
}

async function findResource(supabase, employee, id, manage = false) {
  requireResourceAccess(employee, manage);
  checkId(id);
  let query = supabase.from("hub_resources").select("*").eq("store_id", authorizedStoreId(employee)).eq("id", id);
  if (!manage) {
    query = query.eq("archived", false);
    if (!canAccess(employee.role, "database.manage")) query = query.eq("visibility", "team");
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw resourceError("Resource not found or no longer available.", 404);
  return data;
}

async function removeFile(supabase, path) {
  if (!path) return;
  try {
    const { error } = await supabase.storage.from(RESOURCE_BUCKET).remove([path]);
    if (error) console.error("Resource attachment cleanup failed.", error.code || "storage_error");
  } catch { console.error("Resource attachment cleanup failed."); }
}

function checkVersion(input, row) {
  if (!Number.isInteger(input.version) || input.version < 1) throw resourceError("Reload this resource before saving.", 409);
  if (input.version !== row.version) throw resourceError("Someone updated this resource. Close it and reload the database before saving.", 409);
}

export async function saveResource(supabase, employee, { id = null, input, file = null, removeAttachment = false }) {
  requireResourceAccess(employee, true);
  const { categories } = await loadResourceCategories(supabase, employee);
  const values = validateResource(input, categories);
  const existing = id ? await findResource(supabase, employee, id, true) : null;
  if (existing) {
    checkVersion(input, existing);
    if (existing.archived) throw resourceError("Restore this resource before editing it.", 409);
  }
  const resourceId = existing?.id || randomUUID();
  let attachment = existing && !removeAttachment ? {
    object_path: existing.object_path, file_name: existing.file_name, file_size: existing.file_size, mime_type: existing.mime_type,
  } : { object_path: null, file_name: null, file_size: null, mime_type: null };
  const fileInfo = file ? validateResourceFile(file) : null;
  if (!values.summary && !values.notes && !values.url && !fileInfo && !attachment.object_path) throw resourceError("Add a description, notes, a link, or a file.");
  let uploadedPath = null;
  if (fileInfo) {
    uploadedPath = `${authorizedStoreId(employee)}/${resourceId}/${randomUUID()}.${fileInfo.extension}`;
    const { error } = await supabase.storage.from(RESOURCE_BUCKET).upload(uploadedPath, await file.arrayBuffer(), { contentType: fileInfo.type, upsert: false });
    if (error) throw error;
    attachment = { object_path: uploadedPath, file_name: fileInfo.name, file_size: fileInfo.size, mime_type: fileInfo.type };
  }
  try {
    const payload = { ...values, ...attachment, updated_by: String(employee.employee_id), updated_at: new Date().toISOString() };
    const query = existing
      ? supabase.from("hub_resources").update({ ...payload, version: existing.version + 1 }).eq("id", resourceId).eq("store_id", authorizedStoreId(employee)).eq("version", existing.version)
      : supabase.from("hub_resources").insert({ ...payload, id: resourceId, store_id: authorizedStoreId(employee), created_by: String(employee.employee_id) });
    const { data, error } = await query.select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw resourceError("Someone updated this resource. Reload the database before saving.", 409);
    if (existing?.object_path && existing.object_path !== attachment.object_path) await removeFile(supabase, existing.object_path);
    return publicResource(data);
  } catch (error) {
    if (uploadedPath) await removeFile(supabase, uploadedPath);
    throw error;
  }
}

export async function archiveResource(supabase, employee, id, input) {
  const existing = await findResource(supabase, employee, id, true);
  checkVersion(input, existing);
  if (typeof input.archived !== "boolean") throw resourceError("Choose archive or restore.");
  const { data, error } = await supabase.from("hub_resources").update({ archived: input.archived, version: existing.version + 1, updated_at: new Date().toISOString(), updated_by: String(employee.employee_id) })
    .eq("id", id).eq("store_id", authorizedStoreId(employee)).eq("version", existing.version).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw resourceError("Someone updated this resource. Reload the database and try again.", 409);
  return publicResource(data);
}

export async function resourceDownload(supabase, employee, id) {
  const row = await findResource(supabase, employee, id);
  if (!row.object_path) throw resourceError("This resource has no attachment.", 404);
  const { data, error } = await supabase.storage.from(RESOURCE_BUCKET).createSignedUrl(row.object_path, 60, { download: row.file_name });
  if (error) throw error;
  if (!data?.signedUrl) throw resourceError("Could not open this file. Please try again.", 500);
  return data.signedUrl;
}
