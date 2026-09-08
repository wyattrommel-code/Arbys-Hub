import { createHmac } from "node:crypto";
import { getSupabaseServer } from "../supabase-server";
import { secureJson } from "./http";

/** Database-backed shared limits survive restarts and serverless instance changes.
 * Vercel supplies x-vercel-forwarded-for. Other deployments use one conservative
 * shared bucket until a trusted proxy integration is explicitly configured.
 */
export async function guardPinAttempt(request) {
  try {
    const origin = request.headers.get("origin");
    if (origin !== new URL(request.url).origin) return secureJson({ ok: false, error: "Invalid origin" }, { status: 403 });
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("Missing session secret");
    const address = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for") || "unknown" : "local";
    const key = createHmac("sha256", secret).update(address).digest("hex");
    const { data, error } = await getSupabaseServer().rpc("hub_consume_pin_attempt", { p_client_key: key });
    if (error) throw error;
    if (data !== true) return secureJson({ ok: false, error: "Too many PIN attempts. Try again in five minutes." }, { status: 429, headers: { "Retry-After": "300" } });
    return null;
  } catch {
    return secureJson({ ok: false, error: "Sign-in temporarily unavailable" }, { status: 503 });
  }
}
