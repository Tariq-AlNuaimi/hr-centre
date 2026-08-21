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

// --- Nested-payload redaction (2026-07-25 security review) --------------------
// `scrub` was one level deep while its twin `scrubContext` in lib/sentry.ts
// already recursed. An audited write carrying a relation --
// `prisma.user.update({ where, data, include: { accounts: true } })` -- wrote
// OAuth tokens VERBATIM into audit_logs, a 365-day-retained table that
// GET /api/audit-log serves to admins. These assertions are the regression guard
// the original test file lacked, which is why the gap stayed silent.

test("scrub redacts Restricted fields nested inside an object", () => {
  const out = scrub({
    id: "u1",
    account: { provider: "oidc-provider", access_token: "at_secret", refresh_token: "rt_secret" },
  });
  const account = (out as unknown as Record<string, Record<string, unknown>>).account;
  assert.equal(account.access_token, "[redacted]");
  assert.equal(account.refresh_token, "[redacted]");
  assert.equal(account.provider, "oidc-provider", "non-listed nested fields survive");
});

test("scrub redacts Restricted fields nested inside an array of objects", () => {
  const out = scrub({
    id: "u1",
    accounts: [
      { provider: "oidc-provider", access_token: "at_1", id_token: "id_1" },
      { provider: "entra", access_token: "at_2" },
    ],
  });
  const accounts = (out as unknown as Record<string, Record<string, unknown>[]>).accounts;
  assert.equal(accounts[0].access_token, "[redacted]");
  assert.equal(accounts[0].id_token, "[redacted]");
  assert.equal(accounts[1].access_token, "[redacted]");
  assert.equal(accounts[0].provider, "oidc-provider");
});

test("scrub preserves Date instances rather than flattening them to objects", () => {
  const when = new Date("2026-07-25T00:00:00.000Z");
  const out = scrub({ createdAt: when, nested: { updatedAt: when } });
  assert.ok((out as unknown as Record<string, unknown>).createdAt instanceof Date);
  assert.ok(
    ((out as unknown as Record<string, Record<string, unknown>>).nested
      .updatedAt as Date) instanceof Date,
  );
});

test("computeChanges redacts Restricted values nested under a non-Restricted key", () => {
  const changes = computeChanges(
    { accounts: [{ provider: "oidc-provider", access_token: "old_secret" }] },
    { accounts: [{ provider: "oidc-provider", access_token: "new_secret" }] },
  );
  const serialized = JSON.stringify(changes);
  assert.ok(!serialized.includes("old_secret"), "before-value token must not appear in changes");
  assert.ok(!serialized.includes("new_secret"), "after-value token must not appear in changes");
  assert.ok(serialized.includes("[redacted]"));
});

// --- Non-plain objects, cycles, and __proto__ (2026-07-25 adversarial pass) ---
// The first recursive cut rebuilt EVERY non-Date object key-by-key, which broke
// fidelity for types that must serialize via their own toJSON, and had no cycle
// guard at all. In the `update` path the row is already committed when scrub
// runs, so a throw here meant: data changed, no audit row, 500 to the caller.

test("scrub passes a toJSON-bearing value (e.g. Prisma Decimal) through intact", () => {
  const decimal = {
    s: 1,
    e: 1,
    d: [12, 3400000],
    toJSON() {
      return "12.34";
    },
  };
  const out = scrub({ price: decimal } as unknown as Record<string, unknown>);
  const price = (out as unknown as Record<string, unknown>).price;
  assert.equal(price, decimal, "must be the same reference, not a rebuilt plain object");
  assert.equal(
    JSON.stringify(price),
    '"12.34"',
    "money must serialize via toJSON, not as internal {s,e,d}",
  );
});

test("scrub passes a typed array (a Bytes column) through as a typed array", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const out = scrub({ blob: bytes } as unknown as Record<string, unknown>);
  const blob = (out as unknown as Record<string, unknown>).blob;
  assert.equal(blob, bytes, "must not be rebuilt key-by-key into an indexed object");
  assert.ok(blob instanceof Uint8Array);
});

test("scrub survives a circular reference instead of throwing", () => {
  const node: Record<string, unknown> = { name: "a" };
  node.self = node;
  const out = scrub(node) as Record<string, unknown>;
  assert.equal(out.name, "a");
  assert.equal(out.self, "[circular]");
});

test("scrub caps runaway depth instead of blowing the stack", () => {
  let deep: Record<string, unknown> = { end: true };
  for (let i = 0; i < 5000; i++) deep = { next: deep };
  assert.doesNotThrow(() => scrub(deep));
});

test("scrub keeps a __proto__ key as own data instead of silently dropping it", () => {
  // A user-controlled Json column can carry any key; scaffolded `json` fields
  // validate with z.any(). A plain `out[k] = v` hits the prototype setter, so the
  // key vanishes from the audit row while surviving in the DB — unauditable by
  // choice of key name.
  const payload = JSON.parse('{"id":"1","meta":{"__proto__":{"x":1},"keep":2}}');
  const meta = (scrub(payload) as Record<string, Record<string, unknown>>).meta;
  assert.deepEqual(Object.keys(meta).sort(), ["__proto__", "keep"]);
  assert.equal(({} as Record<string, unknown>).x, undefined, "and no prototype pollution");
});

// --- Actor label is NOT scrubbed (2026-07-25) --------------------------------
// `actorEmail` exists precisely so attribution survives the actor row being
// deleted. Adding "email" to SCRUB_FIELDS would silently defeat that, so pin the
// asymmetry: the label is Confidential and kept, while a genuine credential in
// the same payload is still redacted.
test("scrub keeps actor/email fields while still redacting credentials", () => {
  const out = scrub({
    actorEmail: "admin@example.com",
    email: "user@example.com",
    passwordHash: "$argon2id$v=19$secret",
  });
  const r = out as unknown as Record<string, unknown>;
  assert.equal(r.actorEmail, "admin@example.com", "audit attribution must survive scrubbing");
  assert.equal(r.email, "user@example.com");
  assert.equal(r.passwordHash, "[redacted]");
  assert.ok(!SCRUB_FIELDS.has("actorEmail"), "actorEmail must never be added to SCRUB_FIELDS");
});
