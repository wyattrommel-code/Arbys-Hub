import { NextResponse } from "next/server";
import { canAccess, featureForPathname } from "./lib/permissions";
import { STORE_ID } from "./lib/constants";
import { supportsScopedStore } from "./lib/store-scope";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "./lib/session";

import { clockRouteAllowed } from "./lib/clock-gateway-policy";

const PUBLIC_PREFIXES = ["/login", "/api/auth", "/api/clock", "/clock"];

function isPublicPath(pathname) {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (request.headers.get("origin") !== request.nextUrl.origin) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
  }
  if (process.env.CLOCK_ONLY === "true") {
    if (["/clock", "/clock-sw.js", "/clock.webmanifest"].includes(pathname)) return NextResponse.next();
    if (pathname === "/") {
      const url = request.nextUrl.clone(); url.pathname = "/clock"; url.search = "";
      return NextResponse.rewrite(url);
    }
    if (clockRouteAllowed(pathname, request.method)) {
      const url = request.nextUrl.clone(); url.pathname = "/api/station" + pathname; url.search = "";
      return NextResponse.rewrite(url);
    }
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  // Every API endpoint authenticates using a live employee lookup. Image access
  // also accepts a separately scoped kiosk cookie for profile photos only.
  if (pathname.startsWith("/api/")) {
    if (!isPublicPath(pathname)) {
      const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
      if (session?.store_id && session.store_id !== STORE_ID && !supportsScopedStore(pathname)) {
        return NextResponse.json({ error: "This area is not available for the selected store." }, { status: 403 });
      }
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session.store_id && session.store_id !== STORE_ID && !supportsScopedStore(pathname)) {
    return NextResponse.redirect(new URL("/database", request.url));
  }

  const requiredFeature = featureForPathname(pathname);
  if (requiredFeature && !canAccess(session.role, requiredFeature)) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    homeUrl.searchParams.set("flash", "access-denied");
    return NextResponse.redirect(homeUrl);
  }

  const response = NextResponse.next();
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
