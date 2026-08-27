// Contract tests for the auth wrappers in lib/api-helpers.ts.
//
// DB-free by construction. The wrappers are loaded *dynamically* in a before()
// hook so we never statically import the real lib/auth (NextAuth + Prisma) or
// lib/sentry (@sentry/nextjs) graphs.
//
// The real auth() reads Next's request scope (next/headers), which only exists
// inside the Next runtime -- calling it from a bare test throws rather than
// returning null. So every session-dependent case stubs auth() (and sentry, to
// keep the import graph pure) through node:test's mock.module, which requires
// the --experimental-test-module-mocks flag:
//
//   node --experimental-test-module-mocks --import tsx \
//     --test tests/contracts/api-auth.test.ts
//
// The `test` npm script now passes --experimental-test-module-mocks, so ALL
// cases below (incl. the withAuth/withAdminAuth/withEditorAuth session/role
// checks) run on every `npm test` / `/ship` / CI -- nothing self-skips. The
// `skip: !canMock` guards remain only so the file still works if run WITHOUT
// the flag (then the session cases skip and the token-gate cases still run).

import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

const ctx = { params: Promise.resolve<Record<string, string>>({}) };
const okHandler = async () => NextResponse.json({ data: "ok" });

// mock.module must be called as a method of `mock` (it is bound to internal
// state via `this`); extracting it to a const and calling it unbound throws.
const mockApi = mock as unknown as {
  module?: (specifier: string, options: { namedExports: Record<string, unknown> }) => unknown;
};
const canMock = typeof mockApi.module === "function";

type Session = { user: { id: string; role: string } } | null;
type Helpers = typeof import("../../lib/api-helpers");

// Mutable session the auth() stub returns (only meaningful when canMock).
let current: Session = null;
let helpers: Helpers;

before(async () => {
  const HELPERS_URL = import.meta.resolve("../../lib/api-helpers.ts");
  if (canMock) {
    // Stub lib/auth (no NextAuth/Prisma) and lib/sentry (no @sentry/nextjs) so
    // api-helpers pulls in only pure modules -- no background async activity
    // that would leak past the test boundary under the mock loader.
    mockApi.module!(import.meta.resolve("../../lib/auth.ts"), {
      namedExports: { auth: async () => current },
    });
    mockApi.module!(import.meta.resolve("../../lib/sentry.ts"), {
      namedExports: { setUserContext: () => {}, captureError: () => {} },
    });
  }
  helpers = (await import(HELPERS_URL)) as Helpers;
});

// --- withInternalAuth: pure env + header logic, no session dependency ---

const TOKEN_ENV = "TEST_INTERNAL_TOKEN_DO_NOT_SHIP";

function withTokenEnv(value: string | undefined, fn: () => Promise<void>) {
  const prev = process.env[TOKEN_ENV];
  if (value === undefined) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = value;
  return fn().finally(() => {
    if (prev === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = prev;
  });
}

test("withInternalAuth returns 503 when the token env var is unset", async () => {
  await withTokenEnv(undefined, async () => {
    const handler = helpers.withInternalAuth(TOKEN_ENV, okHandler);
    const res = await handler(new NextRequest("http://localhost/api/internal/x"), ctx);
    assert.equal(res.status, 503);
  });
});

test("withInternalAuth returns 401 when the header is missing", async () => {
  await withTokenEnv("s3cret-token-value", async () => {
    const handler = helpers.withInternalAuth(TOKEN_ENV, okHandler);
    const res = await handler(new NextRequest("http://localhost/api/internal/x"), ctx);
    assert.equal(res.status, 401);
  });
});

test("withInternalAuth returns 401 when the header does not match", async () => {
  await withTokenEnv("s3cret-token-value", async () => {
    const handler = helpers.withInternalAuth(TOKEN_ENV, okHandler);
    const req = new NextRequest("http://localhost/api/internal/x", {
      headers: { "x-internal-token": "wrong" },
    });
    const res = await handler(req, ctx);
    assert.equal(res.status, 401);
  });
});

test("withInternalAuth passes through when the token matches", async () => {
  await withTokenEnv("s3cret-token-value", async () => {
    let called = false;
    const handler = helpers.withInternalAuth(TOKEN_ENV, async () => {
      called = true;
      return NextResponse.json({ data: "ran" });
    });
    const req = new NextRequest("http://localhost/api/internal/x", {
      headers: { "x-internal-token": "s3cret-token-value" },
    });
    const res = await handler(req, ctx);
    assert.equal(res.status, 200);
    assert.equal(called, true);
  });
});

// -- ADR-018: opt-in Bearer + silent-skip dormancy on withInternalAuth --

test("withInternalAuth accepts Authorization: Bearer when the route opts in (Vercel Cron form, ADR-018)", async () => {
  await withTokenEnv("s3cret-token-value", async () => {
    let called = false;
    const handler = helpers.withInternalAuth(
      TOKEN_ENV,
      async () => {
        called = true;
        return NextResponse.json({ data: "ran" });
      },
      { bearer: true },
    );
    const req = new NextRequest("http://localhost/api/internal/x", {
      headers: { authorization: "Bearer s3cret-token-value" },
    });
    const res = await handler(req, ctx);
    assert.equal(res.status, 200);
    assert.equal(called, true);
  });
});

test("withInternalAuth REJECTS a valid Bearer token when the route has not opted in (no silent surface widening)", async () => {
  await withTokenEnv("s3cret-token-value", async () => {
    const handler = helpers.withInternalAuth(TOKEN_ENV, okHandler);
    const req = new NextRequest("http://localhost/api/internal/x", {
      headers: { authorization: "Bearer s3cret-token-value" },
    });
    const res = await handler(req, ctx);
    assert.equal(res.status, 401);
  });
});

test("withInternalAuth rejects a bare Authorization header (no Bearer scheme) even when opted in", async () => {
  await withTokenEnv("s3cret-token-value", async () => {
    const handler = helpers.withInternalAuth(TOKEN_ENV, okHandler, { bearer: true });
    const req = new NextRequest("http://localhost/api/internal/x", {
      headers: { authorization: "s3cret-token-value" },
    });
    const res = await handler(req, ctx);
    assert.equal(res.status, 401);
  });
});

test("withInternalAuth returns 401 for a wrong Bearer token when opted in", async () => {
  await withTokenEnv("s3cret-token-value", async () => {
    const handler = helpers.withInternalAuth(TOKEN_ENV, okHandler, { bearer: true });
    const req = new NextRequest("http://localhost/api/internal/x", {
      headers: { authorization: "Bearer wrong" },
    });
    const res = await handler(req, ctx);
    assert.equal(res.status, 401);
  });
});

test("withInternalAuth: x-internal-token is authoritative -- a wrong value is not rescued by a correct Bearer", async () => {
  await withTokenEnv("s3cret-token-value", async () => {
    const handler = helpers.withInternalAuth(TOKEN_ENV, okHandler, { bearer: true });
    const req = new NextRequest("http://localhost/api/internal/x", {
      headers: {
        "x-internal-token": "wrong",
        authorization: "Bearer s3cret-token-value",
      },
    });
    const res = await handler(req, ctx);
    assert.equal(res.status, 401);
  });
});

test("withInternalAuth with skipWhenUnconfigured returns 200 {skipped:true} when the env var is unset", async () => {
  await withTokenEnv(undefined, async () => {
    let called = false;
    const handler = helpers.withInternalAuth(
      TOKEN_ENV,
      async () => {
        called = true;
        return NextResponse.json({ data: "ran" });
      },
      { skipWhenUnconfigured: true },
    );
    const res = await handler(new NextRequest("http://localhost/api/internal/x"), ctx);
    assert.equal(res.status, 200);
    assert.equal(called, false);
    const body = (await res.json()) as { data: { skipped: boolean } };
    assert.equal(body.data.skipped, true);
  });
});

test("withInternalAuth with skipWhenUnconfigured still enforces the secret once it IS set", async () => {
  await withTokenEnv("s3cret-token-value", async () => {
    const handler = helpers.withInternalAuth(TOKEN_ENV, okHandler, {
      bearer: true,
      skipWhenUnconfigured: true,
    });
    const res = await handler(new NextRequest("http://localhost/api/internal/x"), ctx);
    assert.equal(res.status, 401);
  });
});

// --- withApiAuth: Bearer-token gate (pure env + header, no session) ---

const API_ENV = "TEST_API_KEY_DO_NOT_SHIP";

function withApiEnv(value: string | undefined, fn: () => Promise<void>) {
  const prev = process.env[API_ENV];
  if (value === undefined) delete process.env[API_ENV];
  else process.env[API_ENV] = value;
  return fn().finally(() => {
    if (prev === undefined) delete process.env[API_ENV];
    else process.env[API_ENV] = prev;
  });
}

test("withApiAuth returns 503 when the token env var is unset", async () => {
  await withApiEnv(undefined, async () => {
    const res = await helpers.withApiAuth(API_ENV, okHandler)(
      new NextRequest("http://localhost/api/v1/x"),
      ctx,
    );
    assert.equal(res.status, 503);
  });
});

test("withApiAuth returns 401 when the Bearer header is missing or malformed", async () => {
  await withApiEnv("api-key-value", async () => {
    const noHeader = await helpers.withApiAuth(API_ENV, okHandler)(
      new NextRequest("http://localhost/api/v1/x"),
      ctx,
    );
    assert.equal(noHeader.status, 401);
    const malformed = await helpers.withApiAuth(API_ENV, okHandler)(
      new NextRequest("http://localhost/api/v1/x", {
        headers: { authorization: "api-key-value" }, // missing "Bearer "
      }),
      ctx,
    );
    assert.equal(malformed.status, 401);
  });
});

test("withApiAuth returns 401 when the Bearer token does not match", async () => {
  await withApiEnv("api-key-value", async () => {
    const res = await helpers.withApiAuth(API_ENV, okHandler)(
      new NextRequest("http://localhost/api/v1/x", {
        headers: { authorization: "Bearer wrong" },
      }),
      ctx,
    );
    assert.equal(res.status, 401);
  });
});

test("withApiAuth passes through on a matching Bearer token", async () => {
  await withApiEnv("api-key-value", async () => {
    let called = false;
    const handler = helpers.withApiAuth(API_ENV, async () => {
      called = true;
      return NextResponse.json({ data: "ran" });
    });
    const res = await handler(
      new NextRequest("http://localhost/api/v1/x", {
        headers: { authorization: "Bearer api-key-value" },
      }),
      ctx,
    );
    assert.equal(res.status, 200);
    assert.equal(called, true);
  });
});

// --- withRateLimit: per-IP token bucket wrapper ---

test("withRateLimit allows within the limit then returns 429 with Retry-After", async () => {
  const handler = helpers.withRateLimit(okHandler, {
    id: "test-seam-rl",
    limit: 2,
    windowMs: 60_000,
  });
  // Fixed IP so all three hit the same bucket; unique id avoids cross-test bleed.
  const mk = () =>
    new NextRequest("http://localhost/api/x", {
      headers: { "x-forwarded-for": "203.0.113.77" },
    });
  assert.equal((await handler(mk(), ctx)).status, 200);
  assert.equal((await handler(mk(), ctx)).status, 200);
  const limited = await handler(mk(), ctx);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
});

// --- withAuth / withAdminAuth: session branches (need module mocking) ---

test("withAuth returns 401 when there is no session", { skip: !canMock }, async () => {
  current = null;
  const res = await helpers.withAuth(okHandler)(new NextRequest("http://localhost/api/x"), ctx);
  assert.equal(res.status, 401);
});

test("withAdminAuth returns 401 when there is no session", { skip: !canMock }, async () => {
  current = null;
  const res = await helpers.withAdminAuth(okHandler)(
    new NextRequest("http://localhost/api/x"),
    ctx,
  );
  assert.equal(res.status, 401);
});

test("withAuth passes the session through to the handler", { skip: !canMock }, async () => {
  current = { user: { id: "u1", role: "VIEWER" } };
  let seen: unknown;
  const handler = helpers.withAuth(async (_req, c) => {
    seen = c.session;
    return NextResponse.json({ data: "ok" });
  });
  const res = await handler(new NextRequest("http://localhost/api/x"), ctx);
  assert.equal(res.status, 200);
  assert.deepEqual(seen, current);
});

test("withAdminAuth returns 403 for a non-admin session", { skip: !canMock }, async () => {
  current = { user: { id: "u2", role: "VIEWER" } };
  const res = await helpers.withAdminAuth(okHandler)(
    new NextRequest("http://localhost/api/x"),
    ctx,
  );
  assert.equal(res.status, 403);
});

test("withAdminAuth passes through for an ADMIN session", { skip: !canMock }, async () => {
  current = { user: { id: "u3", role: "ADMIN" } };
  let called = false;
  const handler = helpers.withAdminAuth(async () => {
    called = true;
    return NextResponse.json({ data: "ok" });
  });
  const res = await handler(new NextRequest("http://localhost/api/x"), ctx);
  assert.equal(res.status, 200);
  assert.equal(called, true);
});

// ADR-070 — EDITOR confers nothing in THIS application, and that is now a test
// rather than an observation.
//
// `withEditorAuth` is still exported (see the note on it in lib/api-helpers.ts:
// it is TEMPLATE machinery — the scaffolder's `--writes editor`,
// scripts/rbac-matrix.mjs, and two ESLint rules all name it), but no route in
// this fork calls it. So the only wrapper an EDITOR session ever meets here is
// `withAdminAuth`, which must refuse it. Sessions carrying EDITOR still exist:
// ADR-070 kept the enum so stored rows stay valid, and only stopped the API
// ACCEPTING the value.
test("withAdminAuth returns 403 for an EDITOR session", { skip: !canMock }, async () => {
  current = { user: { id: "u3b", role: "EDITOR" } };
  const res = await helpers.withAdminAuth(okHandler)(
    new NextRequest("http://localhost/api/x"),
    ctx,
  );
  assert.equal(res.status, 403);
});

test("withEditorAuth returns 403 for a VIEWER session", { skip: !canMock }, async () => {
  current = { user: { id: "u4", role: "VIEWER" } };
  const res = await helpers.withEditorAuth(okHandler)(
    new NextRequest("http://localhost/api/x"),
    ctx,
  );
  assert.equal(res.status, 403);
});

test(
  "withEditorAuth passes through for EDITOR and ADMIN sessions",
  { skip: !canMock },
  async () => {
    for (const role of ["EDITOR", "ADMIN"]) {
      current = { user: { id: "u5", role } };
      const res = await helpers.withEditorAuth(okHandler)(
        new NextRequest("http://localhost/api/x"),
        ctx,
      );
      assert.equal(res.status, 200, `${role} should pass withEditorAuth`);
    }
  },
);
