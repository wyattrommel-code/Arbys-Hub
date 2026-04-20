import { createClient } from "@supabase/supabase-js";

let client;

/** Lazy client so importing this module does not run during prerender without env. */
export function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return client;
}
