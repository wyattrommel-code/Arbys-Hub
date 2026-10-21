import { getSupabaseServer } from "@/lib/supabase-server";
import { resourceResponse, resourceApiError } from "@/lib/resources-api";
import { STORE_ID } from "@/lib/constants";

export async function GET() {
  try {
    const { data, error } = await getSupabaseServer().from("hub_stores").select("id,name,number").eq("is_active", true).order("name");
    if (["42P01", "PGRST205"].includes(error?.code)) return resourceResponse({ stores: [{ id: STORE_ID, name: "Payson", number: STORE_ID }] });
    if (error) throw error;
    return resourceResponse({ stores: data });
  } catch (error) { return resourceApiError(error); }
}
