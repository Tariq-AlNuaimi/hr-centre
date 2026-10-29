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

/**
 * HR tickets (HIVE ADR-070): pages an employee opens WITHOUT an account — only
 * the reply link `/reply/<token>`. Being here only means middleware does not
 * demand a session; the page resolves the token server-side and shows "this
 * link is no longer valid" for anything it cannot. Separate from PUBLIC_PATHS
 * because PUBLIC_PATHS is the AUTHENTICATION surface, whose signed-in visitors
 * are bounced home — and an HR user opening a reply link must not be.
 */
export const EMPLOYEE_PATHS = ["/reply"] as const;

/**
 * Hiring (ADR-080, operator-approved public surfaces): pages a CANDIDATE or an
 * AGENCY opens without an account — the careers board `/careers` and an
 * agency's invite link `/agency/<token>`. Like EMPLOYEE_PATHS, a signed-in HR
 * user may open them too (to check the board), so they are not bounced home.
 * The agency page resolves its token server-side and shows the same "not
 * valid" for every failure.
 */
export const CANDIDATE_PATHS = ["/careers", "/agency"] as const;

/**
 * JML preboarding (P2-4, ADR-093, operator-approved): the page a JOINER opens
 * before day one, without an account — `/preboarding/<token>`. The page
 * resolves the token server-side (one open joiner case, ADR-090 magic link) and
 * shows the same "not valid" for every failure. Not bounced when signed in.
 */
export const JOINER_PATHS = ["/preboarding"] as const;

function matchesPrefix(stripped: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => stripped === p || stripped.startsWith(p + "/"));
}

function stripLocale(pathname: string): string {
  return pathname.replace(localePrefixRegex, "") || "/";
}

/** Is this path one an employee opens without an account? */
export function isEmployeePath(pathname: string): boolean {
  return matchesPrefix(stripLocale(pathname), EMPLOYEE_PATHS);
}

/** Is this path reachable without a session? (locale prefix ignored). */
export function isPublicPath(pathname: string): boolean {
  const stripped = stripLocale(pathname);
  return (
    matchesPrefix(stripped, PUBLIC_PATHS) ||
    matchesPrefix(stripped, EMPLOYEE_PATHS) ||
    matchesPrefix(stripped, CANDIDATE_PATHS) ||
    matchesPrefix(stripped, JOINER_PATHS)
  );
}

/**
 * API routes middleware lets through without a session because the route
 * authorises the caller itself. EXACT equality, so the next route under a
 * listed path has to be added on purpose.
 *
 * - `/api/mcp` — HR tickets' MCP server for Siraaj (HIVE ADR-074/075).
 *   Machine-only: `withApiAuth` checks a bearer token in constant time and
 *   answers 503 while `HIVE_MCP_TOKEN` is unset.
 * - `/api/careers`, `/api/careers/apply` — the hiring careers board's open
 *   roles (cached, no pay) and its apply endpoint (5/min/IP, consent required).
 */
export const PUBLIC_API_PATHS = ["/api/mcp", "/api/careers", "/api/careers/apply"] as const;

/**
 * Public API routes with a DYNAMIC segment. Pinned shapes, never prefixes:
 * `[^/]+` cannot cross a slash.
 *
 * - HR tickets' reply link write (HIVE ADR-070): the token in the path IS the
 *   authorisation, for exactly one ticket thread.
 */
export const PUBLIC_API_PATTERNS: readonly RegExp[] = [
  /^\/api\/hive\/reply\/[^/]+$/,
  // Hiring: an agency's invite submission. The token in the path is the authorisation.
  /^\/api\/agency\/[^/]+\/submit$/,
  // JML preboarding (P2-4, ADR-093): the joiner's form and picture. Token-authorised.
  /^\/api\/preboarding\/[^/]+$/,
  /^\/api\/preboarding\/[^/]+\/photo$/,
];

/** Is this an API route that authorises its own caller (no session needed)? */
export function isPublicApiPath(pathname: string): boolean {
  return (
    (PUBLIC_API_PATHS as readonly string[]).includes(pathname) ||
    PUBLIC_API_PATTERNS.some((re) => re.test(pathname))
  );
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
    isPublicApiPath(pathname) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return { kind: "pass" };
  }
  if (!pathname.startsWith("/api")) {
    if (!isAuthed && !isPublicPath(pathname)) {
      return { kind: "redirectLogin", locale: localeOf(pathname) };
    }
    // Only the AUTH surface bounces a signed-in visitor; the reply page (an
    // employee path) is one HR may look at.
    if (isAuthed && matchesPrefix(stripLocale(pathname), PUBLIC_PATHS)) {
      return { kind: "redirectHome", locale: localeOf(pathname) };
    }
    return { kind: "intl" };
  }
  return isAuthed ? { kind: "pass" } : { kind: "apiUnauthorized" };
}
