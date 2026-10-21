import { canAccess } from "./permissions.js";
import { resourceError } from "./resources.js";
import { authorizedStoreId } from "./store-scope.js";
import { getEffectiveAccess } from "./roles.js";

export async function resolveStoreAccess(supabase, identity) {
  if (!identity?.employee_id) throw resourceError("Please sign in.", 401);
  const { data, error } = await supabase.rpc("get_hub_store_access", { p_employee_id: String(identity.employee_id) });
  if (error) throw error;
  if (!data?.employee || !data.stores?.length) throw resourceError("This account has no active store access. Contact your manager.", 403);
  const access = await getEffectiveAccess(supabase, identity.employee_id);
  if (access === "none") throw resourceError("This account has no active Hub role. Contact your manager.", 403);
  const stores = data.stores.map((store) => store.follows_home_role ? { ...store, role: access } : store);
  const selectedId = identity.store_id || data.employee.home_store_id;
  const selected = stores.find((store) => store.id === selectedId);
  if (!selected) throw resourceError("You no longer have access to this store. Please sign in again.", 403);
  return {
    employee: { employee_id: data.employee.employee_id, first_name: data.employee.first_name, last_name: data.employee.last_name, role: selected.role, store_id: selected.id, store_verified: true },
    store: selected,
    stores,
  };
}

export function publicStore(store) {
  return { id: store.id, name: store.name, number: store.number || "", timezone: store.timezone, role: store.role, can_create_store: Boolean(store.can_create_store) };
}

export async function createStore(supabase, context, input) {
  authorizedStoreId(context.employee);
  if (!context.store.can_create_store) throw resourceError("Only an organization administrator can add a store.", 403);
  const name = String(input?.name || "").trim();
  const number = String(input?.number || "").trim();
  const timezone = String(input?.timezone || "");
  if (!name || name.length > 100 || number.length > 30) throw resourceError("Enter a store name of up to 100 characters and an optional store number.");
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); } catch { throw resourceError("Choose a valid store time zone."); }
  const { data, error } = await supabase.rpc("create_hub_store", { p_actor: context.employee.employee_id, p_source_store: context.store.id, p_name: name, p_number: number, p_timezone: timezone });
  if (error?.code === "23505") throw resourceError("A store with that name already exists in your organization.");
  if (error) throw error;
  return data;
}

export function requireScopedFeature(employee, feature) {
  authorizedStoreId(employee);
  if (feature && !canAccess(employee.role, feature)) throw resourceError("You don't have access to make this change.", 403);
}
