import { SHIFT_LEAD_PLUS_ROLES, STORE_ID } from "./constants";

/** @typedef {'active' | 'inactive' | 'terminated'} EmployeeRosterCategory */

export function employeeFullName(row) {
  return `${row.first_name || ""} ${row.last_name || ""}`.trim();
}

export function normalizeEmployeeStatus(value) {
  const v = String(value || "").toLowerCase();
  if (v === "terminated") return "terminated";
  if (v === "inactive") return "inactive";
  return "active";
}

/** Roster grouping used on People admin and for display badges. */
export function getRosterCategory(emp) {
  const status = normalizeEmployeeStatus(emp?.status);
  if (status === "terminated") return "terminated";
  if (status === "inactive" || emp?.is_active === false) return "inactive";
  return "active";
}

export function isActiveEmployee(emp) {
  return getRosterCategory(emp) === "active";
}

/**
 * Apply default active-only filter to a Supabase employees query.
 * @param {import("@supabase/supabase-js").PostgrestFilterBuilder} query
 * @param {boolean} includeInactive
 */
export function applyEmployeeActiveFilter(query, includeInactive = false) {
  if (!includeInactive) {
    return query.eq("is_active", true);
  }
  return query;
}

/**
 * Fetch employees for the store. Active-only by default.
 *
 * Schema: `employees.is_active` (boolean) is the primary filter column.
 * `employees.status` (active | inactive | terminated) is kept in sync on lifecycle changes.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} [options]
 * @param {string} [options.storeId]
 * @param {boolean} [options.includeInactive] Pass true only for People admin.
 * @param {string} [options.select]
 * @param {{ column: string, ascending?: boolean } | { column: string, ascending?: boolean }[]} [options.orderBy]
 */
export async function fetchEmployees(supabase, options = {}) {
  const {
    storeId = STORE_ID,
    includeInactive = false,
    select = "*",
    orderBy = [
      { column: "last_name", ascending: true },
      { column: "first_name", ascending: true },
    ],
  } = options;

  let query = supabase.from("employees").select(select).eq("store_id", storeId);
  query = applyEmployeeActiveFilter(query, includeInactive);

  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  for (const o of orders) {
    query = query.order(o.column, { ascending: o.ascending !== false });
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * PIN login lookup — always active employees only.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchEmployeeByPin(supabase, pin, storeId = STORE_ID) {
  let query = supabase
    .from("employees")
    .select("id, first_name, last_name, role")
    .eq("store_id", storeId)
    .eq("employee_code", String(pin || "").trim());

  query = applyEmployeeActiveFilter(query, false);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

/** Case-insensitive match between a schedule/labor name and an employee row. */
export function matchesEmployeeByName(name, employee) {
  const target = employeeFullName(employee).toLowerCase();
  const row = String(name || "").trim().toLowerCase();
  if (!target || !row) return false;
  if (row === target) return true;
  const last = String(employee.last_name || "").trim().toLowerCase();
  const rowLast = row.split(/\s+/).pop() || "";
  return Boolean(last && (rowLast === last || rowLast.includes(last) || last.includes(rowLast)));
}

export function isNameAmongActiveEmployees(name, employees) {
  return (employees || []).some((emp) => isActiveEmployee(emp) && matchesEmployeeByName(name, emp));
}

/**
 * Active employees at the store (any hub role).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchActiveEmployees(supabase, storeId = STORE_ID) {
  const data = await fetchEmployees(supabase, {
    storeId,
    select: "id, first_name, last_name, role",
  });

  return data.map((row) => ({
    id: row.id,
    name: employeeFullName(row),
    role: row.role,
  }));
}

/**
 * Active shift leads and GMs — qualified to submit deployments.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchActiveShiftLeadsOrAbove(supabase, storeId = STORE_ID) {
  let query = supabase
    .from("employees")
    .select("id, first_name, last_name, role")
    .eq("store_id", storeId)
    .in("role", SHIFT_LEAD_PLUS_ROLES)
    .order("first_name", { ascending: true });

  query = applyEmployeeActiveFilter(query, false);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    name: employeeFullName(row),
    role: row.role,
  }));
}
