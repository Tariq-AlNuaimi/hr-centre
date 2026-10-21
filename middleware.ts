export const runtime = "nodejs";

import createMiddleware from "next-intl/middleware";
import { auth } from "./lib/auth";
import { routing } from "./i18n/routing";
import { routeDecision } from "./i18n/route-decision";
import { NextResponse, NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

const intlMiddleware = createMiddleware(routing);

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

// §7.1 evidence uploads go from the BROWSER straight to Vercel Blob (a function
// body caps at ~4.5 MB and the limit is 10 MB), so the blob host has to be in
// connect-src or the upload is blocked before a byte leaves — which is one of
// the reasons no evidence file could be attached. Gated on the token exactly
// like Sentry above: a fork with no Blob store gets no extra CSP surface.
//
// The hostnames are NOT verified against Vercel's docs: the container this was
// written in cannot resolve vercel.com, read npm, or read node_modules. Both
// the API host and the per-store subdomain form are allowed to cover either
// shape. If an upload still fails, the browser console will name the blocked
// origin outright ("Refused to connect to …") — put that origin here.
function blobConnectSrc(): string {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return "";
  return " https://blob.vercel-storage.com https://*.blob.vercel-storage.com";
}

// Per-request CSP (T-05 / recipe shared-security/3). script-src is nonce-based:
// the inline bootstrap/theme scripts carry the nonce, scripts they load inherit
// trust via 'strict-dynamic', and 'unsafe-inline' is IGNORED by browsers when a
// nonce is present (so we omit it). style-src KEEPS 'unsafe-inline': the UI stack
// (ADR-029 — Radix overlay positioning on Popover/Dropdown/Select/Dialog/Tooltip,
// recharts SVG + ResponsiveContainer, sonner toasts, dnd-kit drag transforms) all
// emit dynamic inline style="..." attributes a nonce can't cover. We do NOT nonce
// styles; only scripts are nonced. (A nonce-per-style migration would need every
// one of those libraries to route styles through a nonced <style> — none do.)
function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${sentryConnectSrc()}${blobConnectSrc()}`,
    "object-src 'none'",
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
  const pass = () => withNonce(nonce, NextResponse.next({ request: { headers: requestHeaders } }));

  // The pure branch logic (public/private path, /api-reference special-casing, the
  // login/home redirect, the API 401) lives in i18n/route-decision.ts so it can be unit
  // tested without Next's request/auth machinery (V2-406). This wrapper maps each action
  // to the actual NextResponse and keeps the framework side effects (CSP/nonce/next-intl).
  const action = routeDecision(pathname, !!req.auth);
  switch (action.kind) {
    // Redirects carry no CSP/nonce — they render no HTML; the destination page gets its
    // own per-request CSP when the browser follows. (Anon on a private page / the opt-in
    // Scalar /api-reference docs page — ADR-052 — get an HTML login redirect, not a JSON 401.)
    case "redirectLogin":
      return NextResponse.redirect(new URL(`/${action.locale}/login`, req.url));
    // Authenticated users on a public page (e.g. /login) are sent home.
    case "redirectHome":
      return NextResponse.redirect(new URL(`/${action.locale}`, req.url));
    // A private API route with no session — JSON 401 (not an HTML doc, so no CSP/nonce).
    case "apiUnauthorized":
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // A localized page: hand it to next-intl. It needs the nonce-bearing request headers
    // too, so clone a real NextRequest (not a bare Request) so next-intl keeps
    // nextUrl/cookies and forwards x-nonce to the rendered (possibly rewritten) request.
    case "intl": {
      const intlReq = new NextRequest(req, { headers: requestHeaders });
      const intlRes = intlMiddleware(intlReq) as NextResponse;
      return withNonce(nonce, intlRes);
    }
    // API/static passthrough (+ authed API routes + authed /api-reference): pass to the
    // app, still nonced. The route's own wrapper (withInternalAuth / withApiAuth / withAuth)
    // and the /api/v1 rewrite (ADR-013) decide from here — middleware must not pre-empt them.
    case "pass":
    default:
      return pass();
  }
});

export const config = {
  matcher: [
    // Match all paths except static files and _next
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
