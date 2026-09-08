import { requireSession } from "@/lib/api-auth";
import { authorizeDataRequest } from "@/lib/security/data-policy";
import { secureJson } from "@/lib/security/http";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
async function handle(request, context) {
  const { employee, error } = await requireSession();
  if (error) return error;
  try {
    const { table } = await context.params;
    const text = ["POST", "PATCH"].includes(request.method) ? await request.text() : "";
    if (text.length > 2_000_000) return secureJson({ message: "Request too large" }, { status: 413 });
    const plan = authorizeDataRequest({ actor: employee, table, method: request.method,
      search: new URL(request.url).search, body: text ? JSON.parse(text) : null, prefer: request.headers.get("prefer") || "" });
    if (table === "schedule_shifts" && plan.own) {
      const { data, error: weekError } = await getSupabaseServer().from("schedule_weeks")
        .select("week_start_date").eq("store_id", "payson").eq("status", "published");
      if (weekError) throw weekError;
      plan.params.append("week_start_date", `in.(${(data || []).map((r) => r.week_start_date).join(",")})`);
    }
    const upstream = new URL(`/rest/v1/${table}`, process.env.NEXT_PUBLIC_SUPABASE_URL);
    upstream.search = plan.params.toString();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error("Missing server configuration");
    const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: plan.prefer };
    const accept = request.headers.get("accept");
    if (accept === "application/vnd.pgrst.object+json") headers.Accept = accept;
    const range = request.headers.get("range");
    if (range && /^\d+-\d*$/.test(range)) headers.Range = range;
    const result = await fetch(upstream, { method: request.method, headers,
      body: plan.body == null ? undefined : JSON.stringify(plan.body), cache: "no-store", redirect: "error" });
    const responseHeaders = { "Cache-Control": "private, no-store" };
    if (result.headers.has("content-range")) responseHeaders["Content-Range"] = result.headers.get("content-range");
    if (request.method === "HEAD" || result.status === 204) return new Response(null, { status: result.status, headers: responseHeaders });
    const data = await result.json();
    return secureJson(result.ok ? data : { message: "Database request failed", code: data.code }, { status: result.status, headers: responseHeaders });
  } catch (err) {
    return secureJson({ message: err.status === 403 ? err.message : "Data request failed" }, { status: err.status || 500 });
  }
}
export { handle as GET, handle as HEAD, handle as POST, handle as PATCH, handle as DELETE };
