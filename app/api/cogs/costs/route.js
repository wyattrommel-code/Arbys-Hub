import { requireSession } from "@/lib/api-auth";
import { loadCogsCosts } from "@/lib/cogs-server";
import { secureJson } from "@/lib/security/http";

export const dynamic = "force-dynamic";
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export async function GET(request) {
  const { error } = await requireSession();
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const requested = params.getAll("item");
  const kind = params.get("kind");
  if (!["inventory", "waste"].includes(kind) || requested.length > 200 || requested.some((value) => !ID.test(value))) {
    return secureJson({ error: "Invalid mapping request." }, { status: 400 });
  }
  try {
    return secureJson(await loadCogsCosts(kind, requested));
  } catch {
    return secureJson({ error: "Item costs are temporarily unavailable." }, { status: 503 });
  }
}
