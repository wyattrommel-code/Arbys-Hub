import { SHIFT_LEAD_PLUS_ROLES, STORE_ID } from "./constants";

export function employeeFullName(row) {
  return `${row.first_name || ""} ${row.last_name || ""}`.trim();
}

/**
 * Active employees at the store (any hub role).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export async function fetchActiveEmployees(supabase, storeId = STORE_ID) {
  const { data, error } = await supabase
    .from("employees")
    .select("id, first_name, last_name, role")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => ({
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
  const { data, error } = await supabase
    .from("employees")
    .select("id, first_name, last_name, role")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .in("role", SHIFT_LEAD_PLUS_ROLES)
    .order("first_name", { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    name: employeeFullName(row),
    role: row.role,
  }));
}
