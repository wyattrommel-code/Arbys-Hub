import { equipmentRoute, equipmentFileRedirect } from "@/lib/equipment-api";
import { downloadManual } from "@/lib/equipment-server";

export const GET = equipmentRoute(null, async ({ supabase, employee, params }) => equipmentFileRedirect(await downloadManual(supabase, employee, params.id, params.manual)));
