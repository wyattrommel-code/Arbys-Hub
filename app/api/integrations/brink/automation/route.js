import { requireFeature } from "@/lib/api-auth";
import { secureJson } from "@/lib/security/http";
import { configureBrinkAutomation } from "@/lib/brink-server";
import { BrinkError } from "@/lib/brink";
export async function POST(request) {
  const { error } = await requireFeature("import");
  if (error) return error;
  try {
    const body = await request.json();
    if (typeof body.enabled !== "boolean") return secureJson({ error: "Choose enabled or paused." }, { status: 400 });
    return secureJson(await configureBrinkAutomation(body.enabled));
  } catch (err) { return secureJson({ error: err instanceof BrinkError ? err.message : "Could not update automatic sync." }, { status: err instanceof BrinkError ? err.status : 500 }); }
}
