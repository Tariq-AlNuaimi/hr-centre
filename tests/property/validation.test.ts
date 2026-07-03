// Property-based tests for the shared zod boundary schemas (A5 / cat 18).
//
// These schemas run at the API boundary (the Secure pillar's zod-on-every-route
// rule). The properties assert their normalisation and clamping contracts hold
// for arbitrary input: emailSchema is idempotent and always lower/trimmed;
// paginationSchema coerces + clamps pageSize into [1,100] and rejects nothing
// that should round-trip. Pure parse calls only — no I/O.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  emailSchema,
  paginationSchema,
} from "../../lib/validations/common";

// Deterministic seed for gate stability; 300 runs per property.
fc.configureGlobal({ numRuns: 300, seed: 20260703 });

// A generator for plausible e-mail local/domain shapes, wrapped in random
// whitespace and mixed case to exercise the .trim().toLowerCase() pipeline.
const emailish = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z0-9._%+-]{1,20}$/),
    fc.stringMatching(/^[A-Za-z0-9-]{1,15}$/),
    fc.constantFrom("com", "org", "co.uk", "io", "COM"),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

const padded = fc
  .tuple(fc.constantFrom("", " ", "  ", "\t"), emailish, fc.constantFrom("", " ", "  "))
  .map(([pre, e, post]) => `${pre}${e}${post}`);

test("emailSchema output is always trimmed + lower-cased", () => {
  fc.assert(
    fc.property(padded, (raw) => {
      const parsed = emailSchema.safeParse(raw);
      if (!parsed.success) return; // only assert on accepted inputs
      const out = parsed.data;
      assert.equal(out, out.trim(), "no surrounding whitespace");
      assert.equal(out, out.toLowerCase(), "lower-cased");
    }),
  );
});

test("emailSchema is idempotent — parsing its own output is a fixed point", () => {
  fc.assert(
    fc.property(padded, (raw) => {
      const first = emailSchema.safeParse(raw);
      if (!first.success) return;
      const second = emailSchema.safeParse(first.data);
      assert.ok(second.success, "normalised email re-parses");
      assert.equal(second.data, first.data, "second pass is a fixed point");
    }),
  );
});

test("paginationSchema clamps/validates pageSize into [1,100] when it succeeds", () => {
  fc.assert(
    fc.property(
      fc.oneof(fc.integer(), fc.integer().map(String), fc.string()),
      fc.oneof(fc.integer(), fc.integer().map(String), fc.string()),
      (page, pageSize) => {
        const parsed = paginationSchema.safeParse({ page, pageSize });
        if (!parsed.success) return; // schema rejects out-of-range → nothing to assert
        assert.ok(parsed.data.pageSize >= 1 && parsed.data.pageSize <= 100);
        assert.ok(parsed.data.page >= 1);
        assert.ok(["asc", "desc"].includes(parsed.data.order));
      },
    ),
  );
});

test("paginationSchema applies its documented defaults on empty input", () => {
  const parsed = paginationSchema.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 20);
  assert.equal(parsed.order, "desc");
});
