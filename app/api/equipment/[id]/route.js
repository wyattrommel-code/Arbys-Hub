import { equipmentRoute, equipmentJson } from "@/lib/equipment-api";
import { equipmentDetails, saveEquipment } from "@/lib/equipment-server";
import { resourceResponse } from "@/lib/resources-api";
import { canAccess } from "@/lib/permissions";

export const GET = equipmentRoute(null, async ({ supabase, employee, store, params }) => resourceResponse({ ...await equipmentDetails(supabase, employee, store, params.id), store, can_manage: canAccess(employee.role, "database.manage") }));
export const PUT = equipmentRoute("database.manage", async ({ supabase, employee, params, request }) => resourceResponse({ equipment: await saveEquipment(supabase, employee, await equipmentJson(request), params.id) }));
