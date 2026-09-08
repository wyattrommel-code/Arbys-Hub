import { createClient } from "@supabase/supabase-js";

let client;

/** Lazy client so importing this module does not run during prerender without env. */
export function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: async (input, init = {}) => {
          const url = new URL(typeof input === "string" ? input : input.url || String(input));
          const match = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
          if (!match) throw new Error("Use an authorized Hub endpoint for this operation");
          const headers = new Headers(init.headers);
          headers.delete("authorization");
          headers.delete("apikey");
          return fetch(`/api/data/${match[1]}${url.search}`, { ...init, headers, credentials: "same-origin", cache: "no-store" });
        } },
      }
    );
  }
  return client;
}
