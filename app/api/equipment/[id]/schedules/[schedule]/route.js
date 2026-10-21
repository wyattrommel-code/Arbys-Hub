import { equipmentRoute, equipmentJson } from "@/lib/equipment-api";
import { saveEquipmentSchedule } from "@/lib/equipment-server";
import { resourceResponse } from "@/lib/resources-api";

export const PUT = equipmentRoute("database.manage", async ({ supabase, employee, store, params, request }) => resourceResponse({ schedule: await saveEquipmentSchedule(supabase, employee, store, params.id, await equipmentJson(request), params.schedule) }));
