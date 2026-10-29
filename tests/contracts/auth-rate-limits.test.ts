// Contract: the sign-in and password throttles (ADR-100). Each limit is tested
// at its boundary -- the last allowed request and the first refused one -- on the
// in-memory backend (no VALKEY_URL in the test env). Every case uses its own IP
// and account so the module-level buckets never bleed between tests.

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTH_LIMITS,
  loginEmailFrom,
  throttleLogin,
  throttlePasswordChange,
  throttleResetComplete,
  throttleResetRequest,
} from "../../lib/rate-limit";

let seq = 0;
const uniq = () => `${process.pid}-${Date.now()}-${++seq}`;
const ip = () =>
  `10.${seq % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

function loginReq(email: string | null, fromIp: string, path = "/api/auth/callback/credentials") {
  const body = new URLSearchParams({ csrfToken: "x", password: "nope" });
  if (email !== null) body.set("email", email);
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "x-forwarded-for": fromIp, "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

const plainReq = (fromIp: string) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "x-forwarded-for": fromIp } });

test("the policy numbers are the operator-approved ones", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(AUTH_LIMITS).map(([k, v]) => [k, [v.limit, v.windowMs]])),
    {
      loginIp: [120, 60_000],
      loginAccount: [10, 60_000],
      passwordChangeIp: [60, 60_000],
      passwordChangeUser: [5, 60_000],
      resetRequestIp: [30, 60_000],
      resetRequestAccount: [3, 900_000],
      resetCompleteIp: [30, 60_000],
      resetCompleteAccount: [3, 900_000],
    },
  );
});

// --- login --------------------------------------------------------------------

test("login: 10 per minute per account, across rotating IPs", async () => {
  const email = `victim-${uniq()}@example.com`;
  for (let i = 0; i < 10; i++) {
    const r = await throttleLogin(loginReq(email, ip()));
    assert.equal(r.ok, true, `attempt ${i + 1} should pass`);
  }
  const blocked = await throttleLogin(loginReq(email, ip()));
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0);
});

test("login: the account key is the normalised email", async () => {
  const email = `Mixed-${uniq()}@Example.com`;
  for (let i = 0; i < 10; i++) {
    await throttleLogin(loginReq(i % 2 ? `  ${email.toUpperCase()} ` : email.toLowerCase(), ip()));
  }
  assert.equal((await throttleLogin(loginReq(email, ip()))).ok, false);
});

test("login: one account's bucket does not block another account", async () => {
  const a = `a-${uniq()}@example.com`;
  for (let i = 0; i < 11; i++) await throttleLogin(loginReq(a, ip()));
  assert.equal((await throttleLogin(loginReq(`b-${uniq()}@example.com`, ip()))).ok, true);
});

test("login: 120 per minute per IP, across many accounts", async () => {
  const from = ip() + "-office";
  for (let i = 0; i < 120; i++) {
    const r = await throttleLogin(loginReq(`user${i}-${uniq()}@example.com`, from));
    assert.equal(r.ok, true, `request ${i + 1} should pass`);
  }
  assert.equal((await throttleLogin(loginReq(`late-${uniq()}@example.com`, from))).ok, false);
});

test("login: a non-credentials POST counts against the IP bucket only", async () => {
  const req = loginReq(`x-${uniq()}@example.com`, ip(), "/api/auth/signout");
  assert.equal(await loginEmailFrom(req), null);
  assert.equal((await throttleLogin(req)).ok, true);
});

test("login: the body survives the throttle for Auth.js to read", async () => {
  const req = loginReq(`body-${uniq()}@example.com`, ip());
  await throttleLogin(req);
  assert.match(await req.text(), /email=body-/);
});

test("login: a JSON body is read; oversized or emailless bodies fall back to IP only", async () => {
  const json = new Request("http://localhost/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: " J@Example.com " }),
  });
  assert.equal(await loginEmailFrom(json), "j@example.com");
  const huge = loginReq("a@example.com".padEnd(20_000, "a"), ip());
  assert.equal(await loginEmailFrom(huge), null);
  assert.equal(await loginEmailFrom(loginReq(null, ip())), null);
});

// --- password change ----------------------------------------------------------

test("password change: 5 per minute per signed-in user", async () => {
  const userId = `user-${uniq()}`;
  for (let i = 0; i < 5; i++) assert.equal((await throttlePasswordChange(userId)).ok, true);
  const blocked = await throttlePasswordChange(userId);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0);
  assert.equal((await throttlePasswordChange(`other-${uniq()}`)).ok, true);
});

// --- forgot / reset -----------------------------------------------------------

test("forgot password: 3 per 15 minutes per address, across rotating IPs", async () => {
  const email = `reset-${uniq()}@example.com`;
  for (let i = 0; i < 3; i++)
    assert.equal((await throttleResetRequest(plainReq(ip()), email)).ok, true);
  const blocked = await throttleResetRequest(plainReq(ip()), email);
  assert.equal(blocked.ok, false);
  // The account bucket's window is 15 minutes, so Retry-After reflects it.
  assert.ok(blocked.retryAfter > 60, `retryAfter ${blocked.retryAfter}`);
});

test("forgot password: 30 per minute per IP", async () => {
  const from = ip() + "-reset";
  for (let i = 0; i < 30; i++) {
    assert.equal(
      (await throttleResetRequest(plainReq(from), `r${i}-${uniq()}@example.com`)).ok,
      true,
    );
  }
  assert.equal((await throttleResetRequest(plainReq(from), null)).ok, false);
});

test("reset password: 3 per 15 minutes per account", async () => {
  const email = `complete-${uniq()}@example.com`;
  for (let i = 0; i < 3; i++) assert.equal((await throttleResetComplete(email)).ok, true);
  assert.equal((await throttleResetComplete(email)).ok, false);
  // Distinct from the request bucket: completing does not spend the request quota.
  assert.equal((await throttleResetRequest(plainReq(ip()), email)).ok, true);
});

// --- wiring -------------------------------------------------------------------

const source = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("each route applies its throttle", () => {
  const cases: Array<[string, RegExp[]]> = [
    ["app/api/auth/[...nextauth]/route.ts", [/throttleLogin\(req\)/]],
    ["app/api/auth/forgot-password/route.ts", [/throttleResetRequest\(/]],
    [
      "app/api/auth/reset-password/route.ts",
      [/AUTH_LIMITS\.resetCompleteIp/, /throttleResetComplete\(record\.identifier\)/],
    ],
    [
      "app/api/logins/change-password/route.ts",
      [/AUTH_LIMITS\.passwordChangeIp/, /throttlePasswordChange\(session\.user\.id\)/],
    ],
    [
      "app/api/users/[id]/password/route.ts",
      [/AUTH_LIMITS\.passwordChangeIp/, /throttlePasswordChange\(session\.user\.id\)/],
    ],
  ];
  for (const [file, patterns] of cases) {
    const src = source(file);
    for (const p of patterns) assert.match(src, p, `${file} must match ${p}`);
  }
});

// --- the sign-in route end to end (Auth.js stubbed) -----------------------------

const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
let route: { POST: (req: Request) => Promise<Response> } | null = null;
let reached = 0;

before(async () => {
  if (typeof mockApi.module !== "function") return;
  mockApi.module(import.meta.resolve("../../lib/auth.ts"), {
    namedExports: {
      handlers: {
        GET: async () => new Response("ok"),
        POST: async () => {
          reached += 1;
          return new Response("ok");
        },
      },
    },
  });
  route = (await import("../../app/api/auth/[...nextauth]/route")) as unknown as typeof route;
});

test("POST /api/auth/callback/credentials returns 429 + Retry-After on the 11th try", async (t) => {
  if (!route) return t.skip("needs --experimental-test-module-mocks");
  const { NextRequest } = await import("next/server");
  const email = `route-${uniq()}@example.com`;
  reached = 0;
  for (let i = 0; i < 10; i++) {
    const res = await route.POST(new NextRequest(loginReq(email, ip())));
    assert.equal(res.status, 200);
  }
  const res = await route.POST(new NextRequest(loginReq(email, ip())));
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) > 0);
  assert.equal(reached, 10, "the refused attempt never reaches Auth.js");
});
