import { NextResponse } from "next/server";
import { requireStoreSession } from "@/lib/store-auth";
import { resourceDownload } from "@/lib/resources-server";
import { resourceApiError, RESOURCE_RESPONSE_HEADERS } from "@/lib/resources-api";

export async function GET(_request, { params }) {
  const { employee, supabase, error } = await requireStoreSession();
  if (error) return error;
  try {
    const { id } = await params;
    const url = await resourceDownload(supabase, employee, id);
    const response = NextResponse.redirect(url);
    for (const [name, value] of Object.entries(RESOURCE_RESPONSE_HEADERS)) response.headers.set(name, value);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return resourceApiError(error); }
}
