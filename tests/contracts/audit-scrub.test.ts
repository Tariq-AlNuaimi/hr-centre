import { test } from "node:test";
import assert from "node:assert/strict";
import { scrub, computeChanges, SCRUB_FIELDS } from "../../lib/prisma/audit-extension";
import { REDACT_FIELDS, redactRows } from "../../scripts/neon-sql.mjs";
import { Prisma } from "../../generated/prisma/client";

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

// --- PMS Restricted compensation data (spec §4.5 / §11.6) --------------------
//
// Basic salary is the most tightly held field in the performance system: HR and
// the COO/Ops Director see it, and line managers never do — not even for their
// own direct reports. `audit_logs` is retained for a year and served to platform
// admins by `GET /api/audit-log`, so an unscrubbed salary in `before`/`after`
// would route the figure straight around its own access control. These tests
// pin the entry so a future edit to SCRUB_FIELDS cannot quietly drop it.

test("HR Centre F-b: scrub redacts ID document numbers, plain and encrypted (AC-F2.2)", () => {
  const out = scrub({
    id: "e1",
    civilIdNumber: "12345678",
    civilIdNumberEnc: "v1.a.b.c",
    civil_id_number_enc: "v1.a.b.c",
    passportNumber: "P1234567",
    passportNumberEnc: "v1.d.e.f",
    passport_number_enc: "v1.d.e.f",
    civilIdExpiry: "2030-01-01",
  });
  for (const key of [
    "civilIdNumber",
    "civilIdNumberEnc",
    "civil_id_number_enc",
    "passportNumber",
    "passportNumberEnc",
    "passport_number_enc",
  ]) {
    assert.equal((out as Record<string, unknown>)[key], "[redacted]", key);
  }
  assert.equal(out.civilIdExpiry, "2030-01-01", "expiry dates are not Restricted");
});

test("scrub redacts the salary ciphertext column too", () => {
  const out = scrub({ id: "e1", basicSalaryEnc: "v1.a.b.c", basic_salary_enc: "v1.a.b.c" });
  assert.equal(out.basicSalaryEnc, "[redacted]");
  assert.equal(out.basic_salary_enc, "[redacted]");
});

test("scrub redacts basicSalary in both camelCase and snake_case", () => {
  const out = scrub({ id: "e1", name: "Sara", basicSalary: 4200, basic_salary: 4200 });
  assert.equal(out.basicSalary, "[redacted]");
  assert.equal(out.basic_salary, "[redacted]");
  assert.equal(out.name, "Sara", "non-Restricted fields must survive scrubbing");
});

test("computeChanges records THAT salary changed without recording the values", () => {
  const changes = computeChanges(
    { basicSalary: 4200, name: "Sara" },
    { basicSalary: 5000, name: "Sara" },
  );
  assert.ok(changes, "a salary change must still produce an audit diff");
  assert.deepEqual(
    changes!.basicSalary,
    { from: "[redacted]", to: "[redacted]" },
    "the fact of the change is auditable; the figures are not disclosed",
  );
});

test("scrub redacts a salary nested under an included relation", () => {
  // `prisma.user.update({ …, include: { employee: true } })` writes the included
  // relation into the audit payload; the recursive scrub must reach it.
  const out = scrub({ id: "u1", employee: { id: "e1", basicSalary: 4200 } });
  const employee = out.employee as Record<string, unknown>;
  assert.equal(employee.basicSalary, "[redacted]");
});

// --- a narrow `select` must not hide what changed ---------------------------
//
// `computeChanges` iterates the keys of `after`, so it can only report on
// columns the caller asked for. An admin resetting another user's password
// through `PUT /api/users/[id]` — which selects six columns, none of them
// `passwordHash` — produced `UPDATE | User | changes: null`, indistinguishable
// from an admin fixing a typo in someone's name.
//
// That is not an ordinary audit gap. ADR-065 accepts that a platform admin can
// reach HR Super Admin access, and names the audit trail as the compensating
// control — so the trail has to be able to show the action that grants it. The
// audit extension now re-reads the full row before diffing; these pin both
// halves of the reasoning.

test("a scrubbed field that changed is REPORTED, with its value redacted", () => {
  const changes = computeChanges(
    { id: "u1", name: "Admin", passwordHash: "argon2id$OLD" },
    { id: "u1", name: "Admin", passwordHash: "argon2id$NEW" },
  );
  assert.ok(changes, "a password change is a change");
  assert.deepEqual(changes?.passwordHash, { from: "[redacted]", to: "[redacted]" });
  assert.equal(
    JSON.stringify(changes).includes("argon2id"),
    false,
    "the fact is recorded; the hash never is",
  );
});

test("a scrubbed field that did NOT change stays out of the diff", () => {
  const changes = computeChanges(
    { id: "u1", name: "Admin", passwordHash: "argon2id$SAME" },
    { id: "u1", name: "Renamed", passwordHash: "argon2id$SAME" },
  );
  assert.deepEqual(Object.keys(changes ?? {}), ["name"], "a rename is only a rename");
});

test("the hazard the extension exists to avoid: a narrow `after` reports nothing", () => {
  // This is what the caller's projection looks like — six columns, no
  // passwordHash. Passing THIS to computeChanges is why the gap existed, and is
  // why the extension re-reads the full row before diffing rather than trusting
  // the value the query returned.
  const changes = computeChanges(
    { id: "u1", name: "Admin", role: "ADMIN", passwordHash: "argon2id$OLD" },
    { id: "u1", name: "Admin", role: "ADMIN" },
  );
  assert.equal(changes, null, "documents the hazard: the projection cannot see it");
});

// --- The post-update projection (audit `changes` inside a $transaction) ---------

test("projectUpdate records the write the in-transaction re-read cannot see", async () => {
  const { projectUpdate, computeChanges } = await import("../../lib/prisma/audit-extension");

  // The stale snapshot an interactive $transaction hands back: the extension's
  // captured client is a different connection and cannot see the uncommitted
  // write, so the re-read returns the row exactly as it was.
  const stale = {
    id: "ts1",
    status: "DRAFT",
    opensAt: new Date("2026-11-01T00:00:00.000Z"),
    deadline: new Date("2026-12-15T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };

  const after = projectUpdate(stale, {
    opensAt: new Date("2026-08-01T00:00:00.000Z"),
    deadline: new Date("2026-12-15T23:59:59.000Z"),
  });
  const changes = computeChanges(stale, after);
  assert.ok(changes, "the window move must be recorded, not diffed away as null");
  assert.ok("opensAt" in changes, "opensAt must appear in changes");
  assert.equal(after.status, "DRAFT", "untouched columns keep their value");
});

test("projectUpdate treats values as values and envelopes as envelopes", async () => {
  const { projectUpdate } = await import("../../lib/prisma/audit-extension");
  const before = {
    id: "e1",
    unpaidLeaveDays: 4,
    name: "Aisha",
    pmsRoles: ["HRBP"],
    // A Decimal is an object with no operator keys — a value, not an envelope.
    weightage: new Prisma.Decimal("40"),
    meta: { note: "prior" },
  };

  assert.equal(projectUpdate(before, { unpaidLeaveDays: { increment: 2 } }).unpaidLeaveDays, 6);
  assert.equal(projectUpdate(before, { unpaidLeaveDays: { decrement: 1 } }).unpaidLeaveDays, 3);
  assert.equal(projectUpdate(before, { name: { set: "Aisha A." } }).name, "Aisha A.");

  // ADR-065's compensating control: granting a role must be visible in `changes`.
  assert.deepEqual(projectUpdate(before, { pmsRoles: ["HRBP", "HR_SUPER_ADMIN"] }).pmsRoles, [
    "HRBP",
    "HR_SUPER_ADMIN",
  ]);

  // §5.3's weightage decisions arrive as Decimals.
  assert.equal(
    String(projectUpdate(before, { weightage: new Prisma.Decimal("35") }).weightage),
    "35",
  );

  // A Json column's object value.
  assert.deepEqual(projectUpdate(before, { meta: { note: "revised" } }).meta, { note: "revised" });

  // `undefined` is this repo's partial-update idiom — never a change.
  assert.equal(projectUpdate(before, { name: undefined }).name, "Aisha");

  // A nested relation write is not a column of this row, so it is left alone.
  assert.equal("manager" in projectUpdate(before, { manager: { connect: { id: "m1" } } }), false);

  // Non-object data (or none) leaves the row as it was.
  assert.deepEqual(projectUpdate(before, undefined), before);
});

test("the write is overlaid only where the re-read saw nothing", async () => {
  const { projectUpdate, computeChanges } = await import("../../lib/prisma/audit-extension");

  // Mirrors `overlayUnobserved`: outside a transaction the re-read already
  // reflects the write AND holds the column's real type, so overlaying the
  // caller's raw value there would invent a JavaScript-type difference.
  // PUT /api/kpis/[id] sends `weightage` as a number into a Decimal column.
  const before: Record<string, unknown> = {
    id: "k1",
    weightage: new Prisma.Decimal("40"),
    description: "old",
  };
  const observed: Record<string, unknown> = {
    id: "k1",
    weightage: new Prisma.Decimal("40"),
    description: "new",
  };
  const data = { weightage: 40, description: "new" };

  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const projected = projectUpdate(before, data);
  const merged: Record<string, unknown> = { ...observed };
  for (const key of Object.keys(projected)) {
    if (!(key in observed)) continue;
    if (!same(observed[key], before[key])) continue;
    if (same(projected[key], before[key]) || String(projected[key]) === String(before[key])) {
      continue;
    }
    merged[key] = projected[key];
  }

  const changes = computeChanges(before, merged);
  assert.ok(changes);
  assert.ok("description" in changes, "the real edit is recorded");
  assert.equal("weightage" in changes, false, "an unchanged Decimal is not a change");
});

test("projectUpdate only unwraps a real operator envelope", async () => {
  const { projectUpdate } = await import("../../lib/prisma/audit-extension");
  const before: Record<string, unknown> = { id: "x", meta: { note: "prior" }, count: 1 };

  // A Json column whose VALUE happens to contain a key called `set`. Matching
  // on "does this key appear" would unwrap it and record a fragment of the
  // user's own data as the whole column.
  const jsonValue = { set: "a name someone typed", other: 1 };
  assert.deepEqual(projectUpdate(before, { meta: jsonValue }).meta, jsonValue);

  // A genuine envelope: every key is an operator.
  assert.deepEqual(projectUpdate(before, { meta: { set: { note: "new" } } }).meta, {
    note: "new",
  });

  // An operator we cannot evaluate leaves the column alone rather than writing
  // the envelope in as if it were the value.
  assert.equal(projectUpdate(before, { count: { push: 2 } }).count, 1);
});

test("a Restricted field still records THAT it changed", async () => {
  const { computeChanges, scrub } = await import("../../lib/prisma/audit-extension");

  // `recordAudit` diffs the RAW pair and lets `computeChanges` redact per field.
  // Scrubbing first would compare "[redacted]" with "[redacted]" and make a
  // salary edit — or a password reset — vanish from `changes` entirely, which is
  // the one thing ADR-065 leans on this trail for.
  const before = { id: "e1", basicSalary: 4000, name: "Aisha" };
  const after = { id: "e1", basicSalary: 9000, name: "Aisha" };

  const raw = computeChanges(before, after);
  assert.ok(raw && "basicSalary" in raw, "the change must be recorded");
  assert.equal((raw.basicSalary as { from: unknown }).from, "[redacted]");
  assert.equal((raw.basicSalary as { to: unknown }).to, "[redacted]");

  const scrubbedFirst = computeChanges(
    scrub(before) as Record<string, unknown>,
    scrub(after) as Record<string, unknown>,
  );
  assert.equal(scrubbedFirst, null, "which is exactly what scrubbing first would lose");
});
