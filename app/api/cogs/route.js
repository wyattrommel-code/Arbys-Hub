import { requireFeature } from "@/lib/api-auth";
import { loadCogsDashboard } from "@/lib/cogs-server";
import { secureJson } from "@/lib/security/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await requireFeature("cogs.view");
  if (error) return error;
  try {
    return secureJson(await loadCogsDashboard());
  } catch {
    return secureJson({ error: "COGS data is temporarily unavailable." }, { status: 503 });
  }
}
