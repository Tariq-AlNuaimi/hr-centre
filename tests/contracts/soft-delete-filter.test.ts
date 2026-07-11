import { test } from "node:test";
import assert from "node:assert/strict";
import { applySoftDeleteFilter, isSoftDeleteModel } from "../../lib/prisma/soft-delete-extension";

// The soft-delete extension's correctness hinges on ONE thing: every read
// operation routes through applySoftDeleteFilter so none of them can silently
// leak deleted rows. These tests pin that helper directly (DB-free), which is
// how findUniqueOrThrow/findFirstOrThrow/aggregate/groupBy stay covered.

test("isSoftDeleteModel: only registered, non-excluded models filter", () => {
  assert.equal(isSoftDeleteModel("User"), true);
  // EXCLUDE set — Auth.js needs raw access, must never be filtered.
  assert.equal(isSoftDeleteModel("Session"), false);
  assert.equal(isSoftDeleteModel("VerificationToken"), false);
  assert.equal(isSoftDeleteModel("Account"), false);
  assert.equal(isSoftDeleteModel("AuditLog"), false);
  // Unregistered model — no deletedAt column, must pass through untouched.
  assert.equal(isSoftDeleteModel("Widget"), false);
});

test("applySoftDeleteFilter injects deletedAt: null for soft-delete models", () => {
  const out = applySoftDeleteFilter("User", { where: { role: "ADMIN" } });
  assert.deepEqual(out.where, { role: "ADMIN", deletedAt: null });
});

test("applySoftDeleteFilter injects deletedAt: null when where is absent", () => {
  const out = applySoftDeleteFilter<{ where?: unknown }>("User", {});
  assert.deepEqual(out.where, { deletedAt: null });
});

test("applySoftDeleteFilter does NOT override an explicit deletedAt (recycling bin)", () => {
  const explicit = { where: { deletedAt: { not: null } } };
  const out = applySoftDeleteFilter("User", explicit);
  // Untouched: the caller is deliberately asking for deleted rows.
  assert.deepEqual(out.where, { deletedAt: { not: null } });
});

test("applySoftDeleteFilter is a no-op for excluded / unregistered models", () => {
  const session = applySoftDeleteFilter("Session", { where: { userId: "u1" } });
  assert.deepEqual(session.where, { userId: "u1" });
  const widget = applySoftDeleteFilter("Widget", { where: { id: "w1" } });
  assert.deepEqual(widget.where, { id: "w1" });
});

// DOCUMENTED LIMITATION (see applySoftDeleteFilter JSDoc): the helper only
// touches the top-level `where`. Nested `include` relation args are NOT
// rewritten — callers must add `where: { deletedAt: null }` to the include
// themselves. This test asserts the current behaviour so a future change that
// adds nested-include filtering is made deliberately, not by accident.
test("applySoftDeleteFilter leaves nested include relation args untouched", () => {
  const out = applySoftDeleteFilter("User", {
    where: { id: "u1" },
    include: { posts: true },
  } as { where?: unknown; include?: unknown });
  assert.deepEqual(
    (out as { include?: unknown }).include,
    { posts: true },
    "nested include must not be auto-filtered (documented limitation)",
  );
});
