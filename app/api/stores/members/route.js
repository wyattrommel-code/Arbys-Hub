import { equipmentRoute, equipmentJson } from "@/lib/equipment-api";
import { resourceResponse } from "@/lib/resources-api";
import { resourceError } from "@/lib/resources";

export const GET = equipmentRoute(null, async ({ supabase, employee, store }) => {
  if (employee.role !== "gm" && !store.can_create_store) throw resourceError("Only a store GM or organization administrator can manage store access.", 403);
  const { data, error } = await supabase.rpc("get_hub_store_people", { p_store: employee.store_id, p_actor: employee.employee_id });
  if (error) throw error;
  return resourceResponse({ people: data });
});
export const POST = equipmentRoute(null, async ({ supabase, employee, store, request }) => {
  if (employee.role !== "gm" && !store.can_create_store) throw resourceError("Only a store GM or organization administrator can manage store access.", 403);
  const input = await equipmentJson(request);
  if (typeof input.employee_id !== "string" || !["crew", "shift_lead", "assistant_manager", "gm"].includes(input.role) || typeof input.is_active !== "boolean") throw resourceError("Choose a team member, role, and access setting.");
  const { data, error } = await supabase.rpc("save_hub_store_member", { p_store: employee.store_id, p_actor: employee.employee_id, p_employee: input.employee_id, p_role: input.role, p_active: input.is_active });
  if (error) throw error;
  return resourceResponse({ people: data });
});
