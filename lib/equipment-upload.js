"use client";

import { createClient } from "@supabase/supabase-js";
import { EQUIPMENT_BUCKET } from "./equipment";

/** The Hub's general client uses a data gateway. Only this signed upload goes directly to Storage. */
export async function uploadEquipmentManual(ticket, file) {
  if (ticket.bucket !== EQUIPMENT_BUCKET || typeof ticket.path !== "string" || !ticket.token) throw new Error("Invalid PDF upload ticket.");
  const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage;
  const { error } = await storage.from(EQUIPMENT_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: "application/pdf" });
  if (error) throw error;
}
