import { equipmentRoute } from "@/lib/equipment-api";
import { equipmentHistory } from "@/lib/equipment-server";
import { resourceResponse } from "@/lib/resources-api";

export const GET = equipmentRoute(null, async ({ supabase, employee, params, request }) => resourceResponse(await equipmentHistory(supabase, employee, params.id, Number(new URL(request.url).searchParams.get("offset") || 0))));
