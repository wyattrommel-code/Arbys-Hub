import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

function buildHtml() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return null;
  }
  const file = path.join(process.cwd(), "lib", "roast-beef-sheet-template.html");
  let html = fs.readFileSync(file, "utf8");
  html = html.replace(
    "__NEXT_PUBLIC_SUPABASE_URL_JSON__",
    JSON.stringify(url)
  );
  html = html.replace(
    "__NEXT_PUBLIC_SUPABASE_ANON_KEY_JSON__",
    JSON.stringify(key)
  );
  return html;
}

export async function GET() {
  const html = buildHtml();
  if (!html) {
    return new Response(
      "<!DOCTYPE html><html><head><meta charset=utf-8><title>Setup</title></head><body style=font-family:system-ui;padding:2rem><p>Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in <code>.env.local</code>, then restart the dev server.</p></body></html>",
      {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      }
    );
  }
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
