import { requireStoreSession } from "@/lib/store-auth";
import { archiveResource, checkResourceOrigin, saveResource } from "@/lib/resources-server";
import { readResourceForm, resourceApiError, resourceResponse } from "@/lib/resources-api";
import { resourceError } from "@/lib/resources";

export async function PUT(request, { params }) {
  const { employee, supabase, error } = await requireStoreSession("database.manage");
  if (error) return error;
  try {
    checkResourceOrigin(request);
    const { id } = await params;
    const resource = await saveResource(supabase, employee, { ...await readResourceForm(request), id });
    return resourceResponse({ resource });
  } catch (error) { return resourceApiError(error); }
}

export async function PATCH(request, { params }) {
  const { employee, supabase, error } = await requireStoreSession("database.manage");
  if (error) return error;
  try {
    checkResourceOrigin(request);
    const { id } = await params;
    let input;
    try { input = await request.json(); } catch { throw resourceError("Invalid resource update."); }
    if (!input || typeof input !== "object") throw resourceError("Invalid resource update.");
    return resourceResponse({ resource: await archiveResource(supabase, employee, id, input) });
  } catch (error) { return resourceApiError(error); }
}
