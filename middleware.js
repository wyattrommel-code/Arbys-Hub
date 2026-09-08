import { NextResponse } from "next/server";
import { canAccess, featureForPathname } from "./lib/permissions";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "./lib/session";

const PUBLIC_PREFIXES = ["/login", "/api/auth", "/api/clock", "/clock"];

function isPublicPath(pathname) {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (request.headers.get("origin") !== request.nextUrl.origin) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
  }
  // Every API endpoint authenticates using a live employee lookup. Image access
  // also accepts a separately scoped kiosk cookie for profile photos only.
  if (pathname.startsWith("/api/")) return NextResponse.next();

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
