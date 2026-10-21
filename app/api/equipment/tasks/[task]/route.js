import { equipmentRoute, equipmentJson } from "@/lib/equipment-api";
import { completeEquipmentTask } from "@/lib/equipment-server";
import { resourceResponse } from "@/lib/resources-api";

export const POST = equipmentRoute(null, async ({ supabase, employee, params, request }) => resourceResponse({ task: await completeEquipmentTask(supabase, employee, params.task, await equipmentJson(request)) }));
