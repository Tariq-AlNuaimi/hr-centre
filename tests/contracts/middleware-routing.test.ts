// Contract tests for the middleware routing decision (V2-406; SECURITY.md §15).
//
// middleware.ts's redirect/pass/401 logic used to be an untested §15 hole ("would need
// disproportionate Prisma/framework mocking"). V2-406 factored the pure decision into
// i18n/route-decision.ts (no next-intl / auth / NextResponse), so it is directly testable:
// these assertions pin the exact branch behavior the middleware relied on, so a future
// edit that (say) stops redirecting an anon visitor, or leaks a private API route, reds
// the build instead of shipping. Runs in the contract suite (`npm test` / warm `/ship`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicPath, localeOf, routeDecision } from "../../i18n/route-decision";
import { defaultLocale } from "../../i18n/config";

test("isPublicPath: public paths match with or without a locale prefix", () => {
  for (const p of ["/login", "/forgot-password", "/reset-password"]) {
    assert.equal(isPublicPath(p), true, `${p} is public`);
    assert.equal(isPublicPath(`/${defaultLocale}${p}`), true, `locale-prefixed ${p} is public`);
  }
  // API public paths (session-independent).
  assert.equal(isPublicPath("/api/auth/callback/credentials"), true);
  assert.equal(isPublicPath("/api/health"), true);
  assert.equal(isPublicPath("/api/internal/sync"), true);
});

test("isPublicPath: private paths do NOT match", () => {
  for (const p of ["/", "/users", "/settings", "/audit-log", `/${defaultLocale}/users`]) {
    assert.equal(isPublicPath(p), false, `${p} is private`);
  }
  // A path that merely starts with a public prefix but isn't a sub-path (e.g. "/loginx")
  // must NOT be treated as public.
  assert.equal(isPublicPath("/loginx"), false);
});

test("localeOf: extracts a configured locale prefix, else the default", () => {
  assert.equal(localeOf(`/${defaultLocale}/users`), defaultLocale);
  assert.equal(localeOf("/users"), defaultLocale); // no prefix → default
  assert.equal(localeOf("/"), defaultLocale);
});

test("routeDecision: the /api-reference docs page (ADR-052) — HTML login redirect for anon", () => {
  assert.deepEqual(routeDecision("/api-reference", false), {
    kind: "redirectLogin",
    locale: defaultLocale,
  });
  assert.deepEqual(routeDecision("/api-reference/openapi.json", false), {
    kind: "redirectLogin",
    locale: defaultLocale,
  });
  assert.deepEqual(routeDecision("/api-reference", true), { kind: "pass" });
});

test("routeDecision: API/static paths pass through (their own wrapper decides)", () => {
  for (const p of [
    "/api/auth/session",
    "/api/health",
    "/api/internal/purge",
    "/api/v1/users",
    "/_next/static/chunk.js",
    "/favicon.ico",
  ]) {
    assert.deepEqual(routeDecision(p, false), { kind: "pass" }, `${p} passes even for anon`);
    assert.deepEqual(routeDecision(p, true), { kind: "pass" }, `${p} passes for authed`);
  }
});

test("routeDecision: a private page redirects anon to login, hands authed to next-intl", () => {
  assert.deepEqual(routeDecision(`/${defaultLocale}/users`, false), {
    kind: "redirectLogin",
    locale: defaultLocale,
  });
  assert.deepEqual(routeDecision("/users", false), {
    kind: "redirectLogin",
    locale: defaultLocale,
  });
  assert.deepEqual(routeDecision(`/${defaultLocale}/users`, true), { kind: "intl" });
});

test("routeDecision: a public page — authed goes home, anon renders it (intl)", () => {
  assert.deepEqual(routeDecision(`/${defaultLocale}/login`, true), {
    kind: "redirectHome",
    locale: defaultLocale,
  });
  // Anon on the login page is NOT redirected (it IS the login page) — hand to next-intl.
  assert.deepEqual(routeDecision(`/${defaultLocale}/login`, false), { kind: "intl" });
});

test("routeDecision: a private API route 401s anon, passes authed", () => {
  assert.deepEqual(routeDecision("/api/users", false), { kind: "apiUnauthorized" });
  assert.deepEqual(routeDecision("/api/users", true), { kind: "pass" });
});
