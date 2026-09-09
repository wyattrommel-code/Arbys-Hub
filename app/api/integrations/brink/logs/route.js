import { requireFeature } from "@/lib/api-auth";
import { secureJson } from "@/lib/security/http";
import { brinkCalls } from "@/lib/brink-server";
import { BrinkError } from "@/lib/brink";
export async function GET(request) {
  const { error } = await requireFeature("import");
  if (error) return error;
  try {
    const params = new URL(request.url).searchParams;
    const data = await brinkCalls(params.get("date"), { id: params.get("id"), before: params.get("before"), exporting: params.get("export") === "1" });
    return secureJson(data, params.get("export") === "1" ? { headers: { "Content-Disposition": `attachment; filename="par-api-calls-${data.business_date}.json"` } } : {});
  } catch (err) { return secureJson({ error: err instanceof BrinkError ? err.message : "Could not read API calls." }, { status: err instanceof BrinkError ? err.status : 500 }); }
}
