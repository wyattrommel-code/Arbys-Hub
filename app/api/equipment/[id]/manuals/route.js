import { equipmentRoute, equipmentJson } from "@/lib/equipment-api";
import { beginManualUpload } from "@/lib/equipment-server";
import { resourceResponse } from "@/lib/resources-api";

export const POST = equipmentRoute("database.manage", async ({ supabase, employee, params, request }) => resourceResponse(await beginManualUpload(supabase, employee, params.id, await equipmentJson(request)), 201));
