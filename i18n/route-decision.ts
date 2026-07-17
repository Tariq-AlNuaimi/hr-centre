// The pure routing decision that middleware.ts makes — factored out so it is
// UNIT-TESTABLE without Next's request/auth machinery (V2-406, SECURITY.md §15).
//
// middleware.ts imports `routeDecision`, maps each action to the actual NextResponse
// (CSP/nonce/redirect), and keeps all the framework side effects; this module holds ONLY
// the branch logic (public vs private path, locale-prefix stripping, the login/home
// redirect decision, the API 401). No next-intl / auth / NextResponse imports here, so a
// `node:test` contract test can import it directly. Behavior is identical to the inline
// logic it replaced (asserted by tests/contracts/middleware-routing.test.ts).

import { defaultLocale, localePrefixRegex } from "./config";

// Paths reachable WITHOUT a session (the locale prefix is stripped before matching, so
// `/login` and `/en/login` both match). `/api/internal` is gated by withInternalAuth (a
// shared-secret header), not a session, so it passes middleware; `/api/auth` is Auth.js's
// own endpoints; `/api/health` is the unauthenticated probe.
export const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth",
  "/api/health",
  "/api/internal",
] as const;

/** Is this path reachable without a session? (locale prefix ignored). */
export function isPublicPath(pathname: string): boolean {
  const stripped = pathname.replace(localePrefixRegex, "") || "/";
  return PUBLIC_PATHS.some((p) => stripped === p || stripped.startsWith(p + "/"));
}

/** The locale in the path (`/ar/...` → `ar`), or the configured default. */
export function localeOf(pathname: string): string {
  return pathname.match(localePrefixRegex)?.[1] ?? defaultLocale;
}

export type RouteAction =
  | { kind: "pass" } // pass through to the app (still nonced by middleware)
  | { kind: "redirectLogin"; locale: string } // anon → HTML login redirect
  | { kind: "redirectHome"; locale: string } // authed on a public page → home
  | { kind: "intl" } // hand to next-intl (localized page)
  | { kind: "apiUnauthorized" }; // anon on a private API route → JSON 401

/**
 * What should middleware do for `pathname` given whether the request is authenticated?
 * The branch ORDER mirrors middleware.ts exactly:
 *   1. the non-localized `/api-reference` docs page (ADR-052) — before the /api branches;
 *   2. API/static passthrough (`/api/auth|health|internal|v1`, `/_next`, favicon);
 *   3. non-API pages — session-gate then i18n;
 *   4. other API routes — session-gated JSON.
 */
export function routeDecision(pathname: string, isAuthed: boolean): RouteAction {
  if (pathname === "/api-reference" || pathname.startsWith("/api-reference/")) {
    return isAuthed ? { kind: "pass" } : { kind: "redirectLogin", locale: defaultLocale };
  }
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/internal") ||
    pathname.startsWith("/api/v1") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return { kind: "pass" };
  }
  if (!pathname.startsWith("/api")) {
    const pub = isPublicPath(pathname);
    if (!isAuthed && !pub) return { kind: "redirectLogin", locale: localeOf(pathname) };
    if (isAuthed && pub) return { kind: "redirectHome", locale: localeOf(pathname) };
    return { kind: "intl" };
  }
  return isAuthed ? { kind: "pass" } : { kind: "apiUnauthorized" };
}
