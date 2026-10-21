import { getCurrentEmployee } from "./auth";
import { getSupabaseServer } from "./supabase-server";
import { resolveStoreAccess, requireScopedFeature } from "./store-access-server";
import { resourceApiError } from "./resources-api";

export async function requireStoreSession(feature = null) {
  try {
    const supabase = getSupabaseServer();
    const context = await resolveStoreAccess(supabase, await getCurrentEmployee());
    requireScopedFeature(context.employee, feature);
    return { ...context, supabase, error: null };
  } catch (error) { return { employee: null, error: resourceApiError(error) }; }
}
