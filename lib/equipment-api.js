import { NextResponse } from "next/server";
import { requireStoreSession } from "./store-auth";
import { checkResourceOrigin } from "./resources-server";
import { resourceApiError, RESOURCE_RESPONSE_HEADERS } from "./resources-api";
import { resourceError } from "./resources";

export function equipmentRoute(feature, handler) {
  return async (request, context = {}) => {
    const session = await requireStoreSession(feature);
    if (session.error) return session.error;
    try {
      if (!["GET", "HEAD"].includes(request.method)) checkResourceOrigin(request);
      return await handler({ ...session, request, params: await context.params || {} });
    } catch (error) { return resourceApiError(error); }
  };
}

export async function equipmentJson(request) {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw resourceError("Could not read this form. Reload the page and try again."); }
}

export function equipmentFileRedirect(url) {
  const response = NextResponse.redirect(url);
  for (const [key, value] of Object.entries(RESOURCE_RESPONSE_HEADERS)) response.headers.set(key, value);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
