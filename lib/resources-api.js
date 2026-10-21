import { NextResponse } from "next/server";
import { resourceError } from "./resources";

export const RESOURCE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

export function resourceResponse(value, status = 200) {
  return NextResponse.json(value, { status, headers: RESOURCE_RESPONSE_HEADERS });
}

export function resourceApiError(error) {
  if (["42P01", "PGRST202", "PGRST205"].includes(error?.code)) {
    return resourceResponse({ error: "The resource library is waiting for setup. Please contact your manager.", setup_required: true }, 503);
  }
  const status = error?.status || 500;
  if (error?.code === "42501") return resourceResponse({ error: "You don't have access to this store or action." }, 403);
  if (error?.code === "P0002") return resourceResponse({ error: "This equipment, schedule, or task was not found." }, 404);
  if (error?.code === "P0001") return resourceResponse({ error: "This item changed. Reload the page before trying again." }, 409);
  if (["22023", "23514", "23503"].includes(error?.code)) return resourceResponse({ error: "Some details are invalid. Check this store, equipment, and schedule before saving." }, 400);
  if (status === 500) console.error("Resource library request failed.", error?.code || "request_error");
  return resourceResponse({ error: status === 500 ? "Could not save or load this resource. Please try again." : error.message }, status);
}

export async function readResourceForm(request) {
  if (Number(request.headers.get("content-length")) > 4 * 1024 * 1024 + 100000) throw resourceError("Files must be 4 MB or smaller.", 413);
  let form;
  try { form = await request.formData(); } catch { throw resourceError("Could not read this form. Please try again."); }
  let input;
  try { input = JSON.parse(String(form.get("resource") || "")); } catch { throw resourceError("Could not read this resource. Please try again."); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw resourceError("Invalid resource.");
  return { input, file: form.get("file"), removeAttachment: form.get("remove_attachment") === "true" };
}
