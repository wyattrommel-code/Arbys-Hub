import { requireStoreSession } from "@/lib/store-auth";
import { checkResourceOrigin, listResources, loadResourceCategories, saveResource } from "@/lib/resources-server";
import { readResourceForm, resourceApiError, resourceResponse } from "@/lib/resources-api";
import { canAccess } from "@/lib/permissions";

export async function GET(request) {
  const { employee, store, supabase, error } = await requireStoreSession();
  if (error) return error;
  try {
    const [resources, library] = await Promise.all([
      listResources(supabase, employee, { archived: new URL(request.url).searchParams.get("archived") === "true" }),
      loadResourceCategories(supabase, employee),
    ]);
    return resourceResponse({ resources, store, categories: library.categories, categories_version: library.version, can_manage: canAccess(employee.role, "database.manage") });
  } catch (error) { return resourceApiError(error); }
}

export async function POST(request) {
  const { employee, supabase, error } = await requireStoreSession("database.manage");
  if (error) return error;
  try {
    checkResourceOrigin(request);
    const resource = await saveResource(supabase, employee, await readResourceForm(request));
    return resourceResponse({ resource }, 201);
  } catch (error) { return resourceApiError(error); }
}
