import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Explicit release check: creates temporary objects and always removes them.
// Run only against the approved project, using server credentials from the environment.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.equal(new URL(url).hostname, "vtsefahwsluutqazphzn.supabase.co");
assert.ok(key, "Server credentials are required");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const server = createClient(url, key, options);
const uploader = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const bucket = server.storage.from("equipment-documents");
const prefix = `__release_validation__/${randomUUID()}`;
const paths = [`${prefix}/boundary.pdf`, `${prefix}/oversized.pdf`];
const maximum = 50 * 1024 * 1024;
try {
  const bytes = Buffer.alloc(maximum + 1, 32);
  bytes.write("%PDF-1.7\n% Temporary upload boundary check\n");
  for (const [index, size] of [maximum, maximum + 1].entries()) {
    const ticket = await bucket.createSignedUploadUrl(paths[index], { upsert: false });
    if (ticket.error) throw ticket.error;
    const result = await uploader.storage.from("equipment-documents").uploadToSignedUrl(paths[index], ticket.data.token, bytes.subarray(0, size), { contentType: "application/pdf" });
    if (index === 0) {
      if (result.error) throw result.error;
      const info = await bucket.info(paths[index]);
      if (info.error) throw info.error;
      assert.equal(Number(info.data.size), maximum);
      assert.equal(info.data.contentType, "application/pdf");
      console.log("Verified signed PDF upload: exactly 50 MiB accepted.");
    } else {
      assert.ok(result.error, "The bucket must reject files over 50 MiB");
      assert.match(result.error.message, /exceed|large|size/i);
      console.log("Verified signed PDF upload: 50 MiB + 1 byte rejected.");
    }
  }
} finally {
  const cleanup = await bucket.remove(paths);
  if (cleanup.error) throw cleanup.error;
  const remaining = await bucket.list(prefix);
  if (remaining.error) throw remaining.error;
  assert.equal(remaining.data.length, 0, "Temporary storage objects must be removed");
  console.log("Temporary upload objects removed and cleanup verified.");
}
