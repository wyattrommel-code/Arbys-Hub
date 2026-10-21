import { equipmentRoute, equipmentJson } from "@/lib/equipment-api";
import { resourceError } from "@/lib/resources";
import { resourceResponse } from "@/lib/resources-api";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/session";

export const POST = equipmentRoute(null, async ({ employee, stores, request }) => {
  const input = await equipmentJson(request);
  const store = stores.find((item) => item.id === input.store_id);
  if (!store) throw resourceError("You don't have access to this store.", 403);
  const token = await createSessionToken({ ...employee, store_id: store.id, role: store.role });
  const response = resourceResponse({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
});
