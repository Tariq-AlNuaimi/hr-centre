// tests/contracts/sentry-scrub.test.ts
//
// Contract: lib/sentry.ts must scrub values for every key in SCRUB_FIELDS
// before handing the payload to Sentry. SCRUB_FIELDS is imported from
// lib/prisma/audit-extension (single source of truth -- same set protects
// audit_logs.before/after). See ADR-002 and SECURITY.md §6.
//
// We substitute an in-memory Sentry stub via lib/sentry.ts's `_setSentryForTesting`
// seam so the assertions run without any network / SDK init AND without needing
// the experimental --experimental-test-module-mocks flag.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { SCRUB_FIELDS } from "../../lib/prisma/audit-extension";
import { captureError, setUserContext, scrubContext, _setSentryForTesting } from "../../lib/sentry";

type ScopeCall = { context?: Record<string, unknown>; user?: { id: string } | null };
const captured: { exception?: unknown; scope?: ScopeCall } = {};

function resetCaptured(): void {
  captured.exception = undefined;
  captured.scope = undefined;
}

before(() => {
  _setSentryForTesting({
    captureException: (err: unknown) => {
      captured.exception = err;
    },
    withScope: (fn) => {
      const scope: ScopeCall = {};
      fn({
        setContext: (_key: string, value: Record<string, unknown>) => {
          scope.context = value;
        },
      });
      captured.scope = scope;
    },
    setUser: (u: { id: string } | null) => {
      captured.scope = { ...(captured.scope || {}), user: u };
    },
  });
});

after(() => {
  _setSentryForTesting();
});

test("scrubContext replaces every SCRUB_FIELDS key value with [redacted]", () => {
  for (const key of SCRUB_FIELDS) {
    const out = scrubContext({ [key]: "leak", harmless: "keep" })!;
    assert.equal(out[key], "[redacted]", `${key} should be redacted`);
    assert.equal(out.harmless, "keep");
  }
});

test("scrubContext recurses into nested objects", () => {
  const out = scrubContext({
    user: { id: "u1", passwordHash: "leak", name: "Alice" },
    safe: "ok",
  })!;
  const user = out.user as Record<string, unknown>;
  assert.equal(user.passwordHash, "[redacted]");
  assert.equal(user.id, "u1");
  assert.equal(user.name, "Alice");
  assert.equal(out.safe, "ok");
});

test("scrubContext preserves null / undefined for scrubbed keys", () => {
  const out = scrubContext({ token: null, secret: undefined })!;
  assert.equal(out.token, null);
  assert.equal(out.secret, undefined);
});

test("scrubContext passes null / undefined input through", () => {
  assert.equal(scrubContext(undefined), undefined);
});

test("captureError forwards the exception and the scrubbed context to Sentry", () => {
  for (const key of SCRUB_FIELDS) {
    resetCaptured();
    const err = new Error("boom");
    captureError(err, { [key]: "supersecret", harmless: "keep" });
    assert.equal(captured.exception, err, "exception passed through");
    const ctx = captured.scope?.context;
    assert.ok(ctx, `scope context set for key=${key}`);
    assert.equal(ctx[key], "[redacted]");
    assert.equal(ctx.harmless, "keep");
  }
});

test("captureError without context calls captureException directly", () => {
  resetCaptured();
  const err = new Error("noctx");
  captureError(err);
  assert.equal(captured.exception, err);
  assert.equal(captured.scope, undefined);
});

test("setUserContext only forwards the id (no email / name / PII)", () => {
  resetCaptured();
  setUserContext("user-123");
  assert.deepEqual(captured.scope?.user, { id: "user-123" });
});

test("setUserContext(null) clears the user", () => {
  resetCaptured();
  setUserContext(null);
  assert.equal(captured.scope?.user, null);
});
