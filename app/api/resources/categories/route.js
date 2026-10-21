import { requireStoreSession } from "@/lib/store-auth";
import { checkResourceOrigin, saveResourceCategories } from "@/lib/resources-server";
import { resourceApiError, resourceResponse } from "@/lib/resources-api";
import { resourceError } from "@/lib/resources";

export async function PUT(request) {
  const { employee, supabase, error } = await requireStoreSession("database.manage");
  if (error) return error;
  try {
    checkResourceOrigin(request);
    let input;
    try { input = await request.json(); } catch { throw resourceError("Could not read the tabs. Please try again."); }
    const library = await saveResourceCategories(supabase, employee, input);
    return resourceResponse(library);
  } catch (error) { return resourceApiError(error); }
}
