import { STORE_ID } from "./constants";
import {
  highestAccessTier,
  hubRoleFromAccessTier,
  isPrivilegedAccessTier,
  mirrorFieldsFromAccess,
  normalizeAccessTier,
} from "./access-tier";
import { isGm } from "./permissions";
import { SCHEDULE_STORE_ID } from "./schedule";

function isMissingColumnError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`;
  return /column|schema cache|could not find/i.test(msg);
}

function isMissingRelationError(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""} ${error?.code || ""}`;
  return /does not exist|schema cache|relation|could not find.*relationship/i.test(msg);
}

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function rolesHttpError(err) {
  const status = Number(err?.status) || 500;
  return { status, message: err?.message || "Request failed." };
}

function publicRole(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    access_tier: normalizeAccessTier(row.access_tier),
    color: row.color || "#6b7280",
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order) || 0,
  };
}

function preferStoreRoles(rows) {
  if (!rows?.length) return [];
  const payson = rows.filter((r) => String(r.store_id || "") === SCHEDULE_STORE_ID);
  const hub = rows.filter((r) => String(r.store_id || "") === STORE_ID);
  if (payson.length && hub.length) return payson.length >= hub.length ? payson : hub;
  if (payson.length) return payson;
  if (hub.length) return hub;
  return rows;
}

function sortRoles(rows) {
  return [...rows].sort((a, b) => {
    const order = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    if (order !== 0) return order;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

/**
 * Active (or all) roles from the managed list. Do not hardcode names.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchRoles(supabase, { includeInactive = false } = {}) {
  let query = supabase
    .from("roles")
    .select("id, name, access_tier, color, is_active, sort_order, store_id")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return sortRoles(preferStoreRoles(data || [])).map(publicRole);
}

function flattenJoinedAssignment(row) {
  const role = row.roles || {};
  return {
    employee_id: row.employee_id,
    role_id: row.role_id || role.id,
    is_primary: Boolean(row.is_primary),
    name: role.name || "",
    color: role.color || "#6b7280",
    access_tier: normalizeAccessTier(role.access_tier),
    is_active: role.is_active !== false,
    sort_order: Number(role.sort_order) || 0,
  };
}

async function fetchAssignmentsJoined(supabase, employeeId = null) {
  let query = supabase
    .from("employee_roles")
    .select("id, employee_id, role_id, is_primary, roles(id, name, access_tier, color, is_active, sort_order)");
  if (employeeId) query = query.eq("employee_id", employeeId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(flattenJoinedAssignment).filter((row) => row.role_id && row.name);
}

async function fetchAssignmentsUnjoined(supabase, employeeId = null) {
  let query = supabase.from("employee_roles").select("id, employee_id, role_id, is_primary");
  if (employeeId) query = query.eq("employee_id", employeeId);
  const { data: joins, error } = await query;
  if (error) throw error;
  const roleIds = [...new Set((joins || []).map((row) => row.role_id).filter(Boolean))];
  if (!roleIds.length) return [];
  const { data: roles, error: roleErr } = await supabase
    .from("roles")
    .select("id, name, access_tier, color, is_active, sort_order")
    .in("id", roleIds);
  if (roleErr) throw roleErr;
  const byId = new Map((roles || []).map((role) => [role.id, role]));
  return (joins || [])
    .map((row) => {
      const role = byId.get(row.role_id);
      if (!role) return null;
      return flattenJoinedAssignment({ ...row, roles: role });
    })
    .filter(Boolean);
}

async function fetchAssignments(supabase, employeeId = null) {
  try {
    return await fetchAssignmentsJoined(supabase, employeeId);
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    return fetchAssignmentsUnjoined(supabase, employeeId);
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} employeeId
 */
export async function fetchEmployeeRoleAssignments(supabase, employeeId) {
  const rows = await fetchAssignments(supabase, employeeId);
  return rows.sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    const order = (a.sort_order || 0) - (b.sort_order || 0);
    if (order !== 0) return order;
    return String(a.name).localeCompare(String(b.name));
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchAllRoleAssignments(supabase) {
  const rows = await fetchAssignments(supabase, null);
  /** @type {Record<string, ReturnType<typeof flattenJoinedAssignment>[]>} */
  const byEmployee = {};
  for (const row of rows) {
    if (!byEmployee[row.employee_id]) byEmployee[row.employee_id] = [];
    byEmployee[row.employee_id].push(row);
  }
  for (const list of Object.values(byEmployee)) {
    list.sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      const order = (a.sort_order || 0) - (b.sort_order || 0);
      if (order !== 0) return order;
      return String(a.name).localeCompare(String(b.name));
    });
  }
  return byEmployee;
}

/**
 * Highest access_tier across assigned roles.
 * Rank: gm > assistant_manager > shift_lead > crew > none.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} employeeId
 * @returns {Promise<import("./access-tier").AccessTier>}
 */
export async function getEffectiveAccess(supabase, employeeId) {
  if (!employeeId) return "none";
  const assignments = await fetchEmployeeRoleAssignments(supabase, employeeId);
  if (assignments.length) {
    return highestAccessTier(assignments.map((row) => row.access_tier));
  }
  const { data, error } = await supabase.from("employees").select("role").eq("id", employeeId).maybeSingle();
  if (error && !isMissingColumnError(error)) throw error;
  const fallback = String(data?.role || "").toLowerCase();
  if (fallback === "gm" || fallback === "assistant_manager" || fallback === "shift_lead" || fallback === "crew") {
    return fallback;
  }
  return "none";
}

export async function attachEffectiveAccess(supabase, employee) {
  if (!employee?.id) return employee;
  try {
    const access = await getEffectiveAccess(supabase, employee.id);
    return {
      ...employee,
      access_tier: access,
      role: hubRoleFromAccessTier(access),
    };
  } catch {
    return employee;
  }
}

async function updateEmployeeMirror(supabase, employeeId, payload) {
  const attempts = [
    payload,
    { role: payload.role, primary_role: payload.primary_role, is_shift_lead: payload.is_shift_lead, is_assistant_manager: payload.is_assistant_manager },
    { role: payload.role, primary_role: payload.primary_role, is_shift_lead: payload.is_shift_lead },
    { role: payload.role, primary_role: payload.primary_role },
    { role: payload.role },
  ];
  let lastError = null;
  for (const body of attempts) {
    const { error } = await supabase.from("employees").update(body).eq("id", employeeId);
    if (!error) return;
    lastError = error;
    if (!isMissingColumnError(error)) throw error;
  }
  if (lastError) throw lastError;
}

export async function mirrorEmployeeAccess(supabase, employeeId) {
  const assignments = await fetchEmployeeRoleAssignments(supabase, employeeId);
  const tier = highestAccessTier(assignments.map((row) => row.access_tier));
  const primary = assignments.find((row) => row.is_primary) || assignments[0];
  await updateEmployeeMirror(supabase, employeeId, mirrorFieldsFromAccess(tier, primary?.name));
  return { access_tier: tier, hub_role: hubRoleFromAccessTier(tier), primary_role: primary?.name || null };
}

function inferRolesStoreId(roles) {
  const withStore = roles.filter((r) => r.store_id);
  if (!withStore.length) return SCHEDULE_STORE_ID;
  const counts = new Map();
  for (const row of withStore) {
    counts.set(row.store_id, (counts.get(row.store_id) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

async function rawRoles(supabase) {
  const { data, error } = await supabase
    .from("roles")
    .select("id, name, access_tier, color, is_active, sort_order, store_id")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return preferStoreRoles(data || []);
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} employeeId
 * @param {string[]} roleIds
 * @param {string} primaryRoleId
 * @param {{ employee_id?: string, role?: string }} actor
 */
export async function setEmployeeRoles(supabase, employeeId, roleIds, primaryRoleId, actor) {
  const uniqueIds = [...new Set((roleIds || []).filter(Boolean))];
  if (!uniqueIds.length) throw fail("Everyone needs at least one role.");
  const primary = primaryRoleId || uniqueIds[0];
  if (!uniqueIds.includes(primary)) throw fail("Primary role must be one of the assigned roles.");

  const catalog = await rawRoles(supabase);
  const byId = new Map(catalog.map((row) => [row.id, row]));
  const selected = uniqueIds.map((id) => {
    const role = byId.get(id);
    if (!role) throw fail("Unknown role.");
    return role;
  });

  const { data: current, error: currentErr } = await supabase
    .from("employee_roles")
    .select("role_id")
    .eq("employee_id", employeeId);
  if (currentErr) throw currentErr;
  const currentIds = new Set((current || []).map((row) => row.role_id));
  const nextIds = new Set(uniqueIds);

  const actorAccess = actor?.employee_id
    ? await getEffectiveAccess(supabase, actor.employee_id)
    : normalizeAccessTier(actor?.role);
  const actorIsGm = isGm(hubRoleFromAccessTier(actorAccess));

  for (const role of selected) {
    if (isPrivilegedAccessTier(role.access_tier) && !currentIds.has(role.id) && !actorIsGm) {
      throw fail("Only a GM can assign manager roles.", 403);
    }
  }
  for (const id of currentIds) {
    if (nextIds.has(id)) continue;
    const role = byId.get(id);
    if (role && isPrivilegedAccessTier(role.access_tier) && !actorIsGm) {
      throw fail("Only a GM can remove manager roles.", 403);
    }
  }

  const toAdd = uniqueIds.filter((id) => !currentIds.has(id));
  if (toAdd.length) {
    const { error: insertErr } = await supabase.from("employee_roles").insert(
      toAdd.map((id) => ({
        employee_id: employeeId,
        role_id: id,
        is_primary: id === primary,
      }))
    );
    if (insertErr) throw insertErr;
  }

  const toRemove = [...currentIds].filter((id) => !nextIds.has(id));
  if (toRemove.length) {
    const { error: deleteErr } = await supabase
      .from("employee_roles")
      .delete()
      .eq("employee_id", employeeId)
      .in("role_id", toRemove);
    if (deleteErr) throw deleteErr;
  }

  const { error: clearPrimaryErr } = await supabase
    .from("employee_roles")
    .update({ is_primary: false })
    .eq("employee_id", employeeId);
  if (clearPrimaryErr) throw clearPrimaryErr;
  const { error: setPrimaryErr } = await supabase
    .from("employee_roles")
    .update({ is_primary: true })
    .eq("employee_id", employeeId)
    .eq("role_id", primary);
  if (setPrimaryErr) throw setPrimaryErr;

  return mirrorEmployeeAccess(supabase, employeeId);
}

function nextSortOrder(roles) {
  const max = roles.reduce((n, row) => Math.max(n, Number(row.sort_order) || 0), 0);
  return max + 10;
}

export async function createManagedRole(supabase, input, actor) {
  const name = String(input?.name || "").trim();
  if (!name) throw fail("Role name is required.");
  const accessTier = normalizeAccessTier(input?.access_tier || "none");
  const actorAccess = actor?.employee_id
    ? await getEffectiveAccess(supabase, actor.employee_id)
    : normalizeAccessTier(actor?.role);
  if (accessTier !== "none" && !isGm(hubRoleFromAccessTier(actorAccess))) {
    throw fail("Only a GM can create a role that grants access.", 403);
  }

  const existing = await rawRoles(supabase);
  const duplicate = existing.find((row) => String(row.name).toLowerCase() === name.toLowerCase());
  if (duplicate) throw fail("A role with that name already exists.");

  const payload = {
    name,
    color: String(input?.color || "#6b7280").trim() || "#6b7280",
    is_active: input?.is_active !== false,
    sort_order: input?.sort_order == null || input.sort_order === "" ? nextSortOrder(existing) : Number(input.sort_order),
    access_tier: accessTier,
    store_id: inferRolesStoreId(existing),
  };

  let insert = await supabase.from("roles").insert(payload).select("id, name, access_tier, color, is_active, sort_order").single();
  if (insert.error && isMissingColumnError(insert.error)) {
    const { store_id: _store, ...rest } = payload;
    insert = await supabase.from("roles").insert(rest).select("id, name, access_tier, color, is_active, sort_order").single();
  }
  if (insert.error) throw insert.error;
  return publicRole(insert.data);
}

export async function updateManagedRole(supabase, roleId, input, actor) {
  const existing = await rawRoles(supabase);
  const current = existing.find((row) => row.id === roleId);
  if (!current) throw fail("Role not found.", 404);

  const actorAccess = actor?.employee_id
    ? await getEffectiveAccess(supabase, actor.employee_id)
    : normalizeAccessTier(actor?.role);
  const actorIsGm = isGm(hubRoleFromAccessTier(actorAccess));

  const patch = {};
  if (input?.name != null) {
    const name = String(input.name).trim();
    if (!name) throw fail("Role name is required.");
    const duplicate = existing.find(
      (row) => row.id !== roleId && String(row.name).toLowerCase() === name.toLowerCase()
    );
    if (duplicate) throw fail("A role with that name already exists.");
    patch.name = name;
  }
  if (input?.color != null) patch.color = String(input.color).trim() || current.color || "#6b7280";
  if (input?.sort_order != null && input.sort_order !== "") patch.sort_order = Number(input.sort_order);
  if (input?.is_active != null) patch.is_active = Boolean(input.is_active);
  if (input?.access_tier != null) {
    const nextTier = normalizeAccessTier(input.access_tier);
    const currentTier = normalizeAccessTier(current.access_tier);
    if (nextTier !== currentTier && (nextTier !== "none" || currentTier !== "none") && !actorIsGm) {
      throw fail("Only a GM can change a role’s access level.", 403);
    }
    if (nextTier !== "none" && currentTier === "none" && !actorIsGm) {
      throw fail("Only a GM can create a role that grants access.", 403);
    }
    patch.access_tier = nextTier;
  }

  if (!Object.keys(patch).length) return publicRole(current);

  const { data, error } = await supabase
    .from("roles")
    .update(patch)
    .eq("id", roleId)
    .select("id, name, access_tier, color, is_active, sort_order")
    .single();
  if (error) throw error;

  if (patch.access_tier != null || patch.name != null) {
    const { data: holders, error: holdErr } = await supabase
      .from("employee_roles")
      .select("employee_id")
      .eq("role_id", roleId);
    if (holdErr) throw holdErr;
    const ids = [...new Set((holders || []).map((row) => row.employee_id).filter(Boolean))];
    for (const employeeId of ids) {
      await mirrorEmployeeAccess(supabase, employeeId);
    }
  }

  return publicRole(data);
}
