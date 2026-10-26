/**
 * HR Centre F-d (AC-F4.2) — while a user holds a temporary password, the ONLY
 * things they can reach are the change-password page and what it needs. Pure,
 * so the middleware decision is unit-tested like i18n/route-decision.ts.
 */

const ALLOWED_API = ["/api/auth", "/api/logins/change-password", "/api/health"];

export type ForceChangeDecision =
  { kind: "pass" } | { kind: "redirect"; to: string } | { kind: "apiForbidden" };

export function forcedChangeDecision(
  pathname: string,
  mustChange: boolean,
  locale: string,
): ForceChangeDecision {
  if (!mustChange) return { kind: "pass" };
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") return { kind: "pass" };
  if (pathname.startsWith("/api")) {
    return ALLOWED_API.some((p) => pathname === p || pathname.startsWith(`${p}/`))
      ? { kind: "pass" }
      : { kind: "apiForbidden" };
  }
  const target = `/${locale}/change-password`;
  return pathname === target ? { kind: "pass" } : { kind: "redirect", to: target };
}
