import { test } from "node:test";
import assert from "node:assert/strict";
import { scrub, computeChanges, SCRUB_FIELDS } from "../../lib/prisma/audit-extension";
import { REDACT_FIELDS, redactRows } from "../../scripts/neon-sql.mjs";

test("scrub replaces every SCRUB_FIELDS key value with [redacted]", () => {
  for (const key of SCRUB_FIELDS) {
    const out = scrub({ [key]: "secretvalue", harmless: "keep" });
    assert.equal(out[key], "[redacted]", `${key} should be redacted`);
    assert.equal(out.harmless, "keep");
  }
});

test("scrub leaves non-listed fields untouched", () => {
  const out = scrub({
    id: "abc",
    email: "foo@example.com",
    name: "Foo",
    role: "ADMIN",
    createdAt: new Date("2026-01-01"),
  });
  assert.equal(out.id, "abc");
  assert.equal(out.email, "foo@example.com");
  assert.equal(out.name, "Foo");
  assert.equal(out.role, "ADMIN");
  assert.ok(out.createdAt instanceof Date);
});

test("scrub preserves null and undefined for listed fields", () => {
  const outNull = scrub({ passwordHash: null });
  assert.equal(outNull.passwordHash, null);
  const outUndef = scrub({ passwordHash: undefined });
  assert.equal(outUndef.passwordHash, undefined);
});

test("scrub passes through null / undefined input", () => {
  assert.equal(scrub(null), null);
  assert.equal(scrub(undefined), undefined);
});

test("computeChanges hides scrubbed field VALUES but reports the field changed", () => {
  const before = { passwordHash: "old-hash", name: "A" };
  const after = { passwordHash: "new-hash", name: "B" };
  const changes = computeChanges(before, after);
  assert.ok(changes, "changes should not be null");
  assert.deepEqual(changes!.passwordHash, { from: "[redacted]", to: "[redacted]" });
  assert.deepEqual(changes!.name, { from: "A", to: "B" });
});

test("computeChanges ignores updatedAt", () => {
  const before = { name: "A", updatedAt: new Date("2026-01-01") };
  const after = { name: "A", updatedAt: new Date("2026-01-02") };
  const changes = computeChanges(before, after);
  assert.equal(changes, null, "updatedAt-only change should produce null");
});

test("computeChanges returns null when nothing differs", () => {
  const obj = { name: "A", id: "x" };
  const changes = computeChanges(obj, { ...obj });
  assert.equal(changes, null);
});

test("computeChanges captures unscrubbed value changes verbatim", () => {
  const changes = computeChanges({ name: "Old", count: 1 }, { name: "New", count: 2 });
  assert.ok(changes);
  assert.deepEqual(changes!.name, { from: "Old", to: "New" });
  assert.deepEqual(changes!.count, { from: 1, to: 2 });
});

test("neon-sql REDACT_FIELDS stays a superset of SCRUB_FIELDS (no drift)", () => {
  for (const key of SCRUB_FIELDS) {
    assert.ok(
      REDACT_FIELDS.has(key),
      `scripts/neon-sql.mjs REDACT_FIELDS must include "${key}" so db-sql never prints its value`,
    );
  }
});

test("neon-sql redactRows redacts REDACT_FIELDS values but keeps the rest", () => {
  const [row] = redactRows([
    { id: "u1", email: "a@example.com", passwordHash: "$argon2id$…", token: "tok_123" },
  ]) as Array<Record<string, unknown>>;
  assert.equal(row.id, "u1");
  assert.equal(row.email, "a@example.com");
  assert.equal(row.passwordHash, "[redacted]");
  assert.equal(row.token, "[redacted]");
});

test("neon-sql redactRows leaves null values and non-array input untouched", () => {
  const [row] = redactRows([{ passwordHash: null, name: "Foo" }]) as Array<Record<string, unknown>>;
  assert.equal(row.passwordHash, null);
  assert.equal(row.name, "Foo");
  assert.equal(redactRows("not-an-array"), "not-an-array");
});

test("SCRUB_FIELDS includes all critical Restricted-class field names", () => {
  for (const expected of [
    "passwordHash",
    "password",
    "refresh_token",
    "access_token",
    "id_token",
    "session_state",
    "sessionToken",
    "token",
    "secret",
    "apiKey",
    "api_key",
  ]) {
    assert.ok(SCRUB_FIELDS.has(expected), `SCRUB_FIELDS must include "${expected}"`);
  }
});
