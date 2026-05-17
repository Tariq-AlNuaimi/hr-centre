export const runtime = "nodejs";

import createMiddleware from "next-intl/middleware";
import { auth } from "./lib/auth";
import { routing } from "./i18n/routing";
import { NextResponse } from "next/server";

const intlMiddleware = createMiddleware(routing);

const publicPaths = ["/login", "/api/auth", "/api/health"];

function isPublicPath(pathname: string): boolean {
  // Strip locale prefix for matching
  const stripped = pathname.replace(/^\/(en|ar)/, "") || "/";
  return publicPaths.some(
    (p) => stripped === p || stripped.startsWith(p + "/")
  );
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Let API routes and static files pass through
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Apply i18n routing for non-API routes
  if (!pathname.startsWith("/api")) {
    const isPublic = isPublicPath(pathname);
    const isAuth = !!req.auth;

    // Redirect unauthenticated users to login
    if (!isAuth && !isPublic) {
      const locale = pathname.match(/^\/(en|ar)/)?.[1] ?? routing.defaultLocale;
      return NextResponse.redirect(
        new URL(`/${locale}/login`, req.url)
      );
    }

    // Redirect authenticated users away from login
    if (isAuth && isPublicPath(pathname)) {
      const locale = pathname.match(/^\/(en|ar)/)?.[1] ?? routing.defaultLocale;
      return NextResponse.redirect(new URL(`/${locale}`, req.url));
    }

    return intlMiddleware(req);
  }

  // API routes - check auth
  if (!req.auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Match all paths except static files and _next
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
