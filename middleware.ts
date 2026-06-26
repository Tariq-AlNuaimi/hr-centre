export const runtime = "nodejs";

import createMiddleware from "next-intl/middleware";
import { auth } from "./lib/auth";
import { routing } from "./i18n/routing";
import { NextResponse, NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

const intlMiddleware = createMiddleware(routing);

const publicPaths = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth",
  "/api/health",
  "/api/internal",
];

function isPublicPath(pathname: string): boolean {
  // Strip locale prefix for matching
  const stripped = pathname.replace(/^\/(en|ar)/, "") || "/";
  return publicPaths.some(
    (p) => stripped === p || stripped.startsWith(p + "/")
  );
}

const isDev = process.env.NODE_ENV !== "production";

// When Sentry is configured, the browser SDK POSTs envelopes to its ingest host
// (derived from the public DSN). Without it in connect-src, every error/session
// report is silently blocked by CSP. No-op when Sentry isn't configured.
function sentryConnectSrc(): string {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return "";
  try {
    return " " + new URL(dsn).origin;
  } catch {
    return "";
  }
}

// Per-request CSP (T-05 / recipe shared-security/3). script-src is nonce-based:
// the inline bootstrap/theme scripts carry the nonce, scripts they load inherit
// trust via 'strict-dynamic', and 'unsafe-inline' is IGNORED by browsers when a
// nonce is present (so we omit it). style-src KEEPS 'unsafe-inline': Ant Design 6
// + emotion emit inline style="..." attributes a nonce can't cover (revisit at
// AntD 7, ADR-001). We do NOT nonce styles at all — the stock AntdRegistry's
// <style> tags rely on that style-src 'unsafe-inline'; only scripts are nonced.
function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${sentryConnectSrc()}`,
    "object-src 'none'",
    // Sentry Replay (instrumentation-client.ts) spins up a compression Web Worker
    // from a blob: URL; without this it's blocked under 'strict-dynamic' and error
    // replays silently degrade.
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  // Optional violation reporting: set CSP_REPORT_URI (e.g. a Sentry CSP endpoint)
  // for production visibility into blocked resources / XSS attempts. Dormant until
  // set, like the rest of the opt-in surface.
  const reportUri = process.env.CSP_REPORT_URI;
  if (reportUri) directives.push(`report-uri ${reportUri}`);
  return directives.join("; ");
}

// Attach the CSP (with this request's nonce) + the nonce header to a response.
function withNonce(nonce: string, res: NextResponse): NextResponse {
  res.headers.set("Content-Security-Policy", buildCsp(nonce));
  res.headers.set("x-nonce", nonce);
  return res;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const nonce = randomBytes(16).toString("base64");

  // Forward to the app on REQUEST headers: x-nonce (the layout reads it for the
  // inline theme script) AND the full CSP. Next.js reads the nonce from the
  // request's Content-Security-Policy header and auto-applies it to the scripts it
  // emits — required, because 'strict-dynamic' makes the browser ignore 'self' and
  // trust only nonce'd scripts (and what they load). Without CSP on the request,
  // Next's bootstrap would be unnonced and blocked.
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const pass = () =>
    withNonce(nonce, NextResponse.next({ request: { headers: requestHeaders } }));

  // Let API routes and static files pass through (still nonced for consistency).
  // /api/internal is gated by withInternalAuth (shared-secret header), not session.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/internal") ||
    // /api/v1/* is the public, versioned API surface (rewrites to /api/* via
    // next.config). Let it through here so the rewrite + the route's own wrapper
    // (withApiAuth for external consumers, or withAuth) decide -- middleware must
    // not blanket-401 it before the rewrite resolves. See ADR-013.
    pathname.startsWith("/api/v1") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return pass();
  }

  // Apply i18n routing for non-API routes
  if (!pathname.startsWith("/api")) {
    const isPublic = isPublicPath(pathname);
    const isAuth = !!req.auth;

    // Redirects carry no CSP/nonce — they render no HTML; the destination page
    // gets its own per-request CSP when the browser follows.
    if (!isAuth && !isPublic) {
      const locale = pathname.match(/^\/(en|ar)/)?.[1] ?? routing.defaultLocale;
      return NextResponse.redirect(new URL(`/${locale}/login`, req.url));
    }

    // Redirect authenticated users away from login
    if (isAuth && isPublicPath(pathname)) {
      const locale = pathname.match(/^\/(en|ar)/)?.[1] ?? routing.defaultLocale;
      return NextResponse.redirect(new URL(`/${locale}`, req.url));
    }

    // next-intl needs the nonce-bearing request headers too. Hand it a real
    // NextRequest (cloned from req with the nonce header added) — not a bare
    // Request — so next-intl keeps nextUrl/cookies and forwards x-nonce to the
    // rendered (possibly rewritten) request, where the layout reads it.
    const intlReq = new NextRequest(req, { headers: requestHeaders });
    const intlRes = intlMiddleware(intlReq) as NextResponse;
    return withNonce(nonce, intlRes);
  }

  // API routes - check auth. JSON 401 carries no CSP/nonce (not an HTML doc).
  if (!req.auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return pass();
});

export const config = {
  matcher: [
    // Match all paths except static files and _next
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
