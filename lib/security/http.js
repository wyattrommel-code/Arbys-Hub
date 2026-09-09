import { NextResponse } from "next/server";
import { protectPhotoUrls } from "./photo-urls.js";
export function secureJson(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return NextResponse.json(protectPhotoUrls(data), { ...init, headers });
}
