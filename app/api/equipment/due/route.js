import { equipmentRoute } from "@/lib/equipment-api";
import { dueEquipmentTasks } from "@/lib/equipment-server";
import { resourceResponse } from "@/lib/resources-api";

export const GET = equipmentRoute(null, async ({ supabase, employee, store, request }) => resourceResponse({ ...await dueEquipmentTasks(supabase, employee, store, new URL(request.url).searchParams.get("date")), store }));
