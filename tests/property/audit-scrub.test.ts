// Property-based tests for the audit-scrub invariant (A5 / cat 18).
//
// `scrub()` in lib/prisma/audit-extension.ts is the last line of defence that
// keeps Restricted values out of the audit log. The contract suite asserts the
// SCRUB_FIELDS membership; this file asserts the *behavioural* invariant across
// thousands of generated objects: for ANY record, no live secret value survives
// into the scrubbed output, non-secret fields pass through untouched, and the
// operation is shape-preserving and idempotent. fast-check shrinks any
// counter-example to its minimal form, so a regression names the exact field.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { scrub, SCRUB_FIELDS } from "../../lib/prisma/audit-extension";

// Pin the seed so this runs deterministically in the /ship gate (a random seed
// could otherwise flip the gate red on a future run); 300 runs per property.
fc.configureGlobal({ numRuns: 300, seed: 20260703 });

const SCRUB_KEYS = [...SCRUB_FIELDS];
const REDACTED = "[redacted]";

// A key generator biased toward the interesting cases: real scrub keys mixed
// with arbitrary non-scrub keys, so most generated objects exercise both paths.
// `__proto__` is excluded deliberately: it is not a reachable Prisma field name,
// and `obj["__proto__"] = v` mutates the prototype instead of creating an own
// key — a JS-language quirk, not a scrub defect, that would otherwise make the
// shape-preserving property spuriously fail on a random seed.
const anyKey = fc.oneof(
  fc.constantFrom(...SCRUB_KEYS),
  fc
    .string({ minLength: 1, maxLength: 12 })
    .filter((k) => !SCRUB_FIELDS.has(k) && k !== "__proto__"),
);

// Values that could appear on a record: primitives, null, undefined, nested.
const anyValue = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.object({ maxDepth: 1 }),
);

const anyRecord = fc.dictionary(anyKey, anyValue, { maxKeys: 10 });

test("scrub never leaks a live secret value under a Restricted key", () => {
  fc.assert(
    fc.property(anyRecord, (obj) => {
      const out = scrub({ ...obj }) as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (!SCRUB_FIELDS.has(key)) continue;
        const original = obj[key];
        // null/undefined stay as-is (nothing to redact); anything else must be
        // replaced by the sentinel — the original value must never survive.
        if (original == null) {
          assert.equal(out[key], original);
        } else {
          assert.equal(out[key], REDACTED);
          assert.notEqual(out[key], original);
        }
      }
    }),
  );
});

test("scrub passes non-Restricted fields through byte-for-byte", () => {
  fc.assert(
    fc.property(anyRecord, (obj) => {
      const out = scrub({ ...obj }) as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (SCRUB_FIELDS.has(key)) continue;
        // deepEqual, not equal: since 2026-07-25 `scrub` recurses, so a nested
        // object/array comes back as a structurally identical COPY rather than
        // the same reference (it has to — redacting a nested Restricted field
        // means building a new object). Value-identity is the invariant this
        // test is actually about; reference-identity was incidental to the old
        // one-level implementation and is not something callers may rely on.
        assert.deepEqual(out[key], obj[key]);
      }
    }),
  );
});

test("scrub is shape-preserving (same key set as the input)", () => {
  fc.assert(
    fc.property(anyRecord, (obj) => {
      const out = scrub({ ...obj }) as Record<string, unknown>;
      assert.deepEqual(Object.keys(out).sort(), Object.keys(obj).sort());
    }),
  );
});

test("scrub is idempotent — a second pass is a fixed point", () => {
  fc.assert(
    fc.property(anyRecord, (obj) => {
      const once = scrub({ ...obj });
      const twice = scrub({ ...once });
      assert.deepEqual(twice, once);
    }),
  );
});

test("scrub returns null/undefined inputs unchanged", () => {
  assert.equal(scrub(null), null);
  assert.equal(scrub(undefined), undefined);
});
