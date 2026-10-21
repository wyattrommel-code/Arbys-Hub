import { equipmentRoute, equipmentJson } from "@/lib/equipment-api";
import { listEquipment, saveEquipment } from "@/lib/equipment-server";
import { resourceResponse } from "@/lib/resources-api";
import { canAccess } from "@/lib/permissions";

export const GET = equipmentRoute(null, async ({ supabase, employee, store }) => resourceResponse({ equipment: await listEquipment(supabase, employee, store), store, can_manage: canAccess(employee.role, "database.manage") }));
export const POST = equipmentRoute("database.manage", async ({ supabase, employee, request }) => resourceResponse({ equipment: await saveEquipment(supabase, employee, await equipmentJson(request)) }, 201));
