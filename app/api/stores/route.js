import { equipmentRoute, equipmentJson } from "@/lib/equipment-api";
import { createStore, publicStore } from "@/lib/store-access-server";
import { resourceResponse } from "@/lib/resources-api";

export const GET = equipmentRoute(null, async ({ store, stores }) => resourceResponse({ store: publicStore(store), stores: stores.map(publicStore) }));
export const POST = equipmentRoute(null, async (context) => resourceResponse({ store: await createStore(context.supabase, context, await equipmentJson(context.request)) }, 201));
