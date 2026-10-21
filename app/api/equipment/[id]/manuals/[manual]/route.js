import { equipmentRoute } from "@/lib/equipment-api";
import { archiveManual, finishManualUpload } from "@/lib/equipment-server";
import { resourceResponse } from "@/lib/resources-api";

export const PATCH = equipmentRoute("database.manage", async ({ supabase, employee, params }) => resourceResponse({ manual: await finishManualUpload(supabase, employee, params.id, params.manual) }));
export const DELETE = equipmentRoute("database.manage", async ({ supabase, employee, params }) => { await archiveManual(supabase, employee, params.id, params.manual); return resourceResponse({ ok: true }); });
