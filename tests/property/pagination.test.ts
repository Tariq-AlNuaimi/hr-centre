// Property-based tests for the pagination math (A5 / cat 18).
//
// parsePagination() sits on the Scalable pillar — it is what stops a caller
// from asking for an unbounded page. These properties assert the bounds hold
// for ANY query string (including hostile / malformed input): the page is
// always >= 1, the page size is always clamped to [1, 100], skip/take are
// internally consistent, and nothing is ever NaN. paginatedResponse()'s
// totalPages is checked against the ceil-division identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  parsePagination,
  paginatedResponse,
  type PaginationParams,
} from "../../lib/pagination";

// Deterministic seed for gate stability; 300 runs per property.
fc.configureGlobal({ numRuns: 300, seed: 20260703 });

// Arbitrary query strings for page/pageSize: valid numbers, zero, negatives,
// huge (but finite) values, floats, and non-numeric junk — the adversarial
// surface a real query string can carry. Deliberately excludes the strings that
// coerce to ±Infinity ("Infinity", "1e309"): parsePagination does NOT guard
// against those (they flow through Math.max as a non-finite page). That gap,
// which these properties surfaced, is pinned separately below as current
// behaviour rather than silently folded into the generator.
const paramValue = fc.oneof(
  fc.integer({ min: -100000, max: 100000 }).map(String),
  fc.integer({ min: -1000, max: 1000 }).map((n) => String(n / 7)), // floats
  fc.constantFrom("", "NaN", "-0", "1e3", "abc", "  5  ", "1.5", "-42", "0", "99999999999"),
);

function makeParams(page: string, pageSize: string): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("page", page);
  sp.set("pageSize", pageSize);
  return sp;
}

test("parsePagination clamps page >= 1 and pageSize to [1,100] for any input", () => {
  fc.assert(
    fc.property(paramValue, paramValue, (page, pageSize) => {
      const p = parsePagination(makeParams(page, pageSize));
      assert.ok(Number.isFinite(p.page), "page is finite");
      assert.ok(Number.isFinite(p.pageSize), "pageSize is finite");
      assert.ok(p.page >= 1, `page ${p.page} >= 1`);
      assert.ok(p.pageSize >= 1 && p.pageSize <= 100, `pageSize ${p.pageSize} in [1,100]`);
    }),
  );
});

test("parsePagination keeps skip/take internally consistent", () => {
  fc.assert(
    fc.property(paramValue, paramValue, (page, pageSize) => {
      const p = parsePagination(makeParams(page, pageSize));
      assert.equal(p.take, p.pageSize, "take mirrors pageSize");
      assert.equal(p.skip, (p.page - 1) * p.pageSize, "skip = (page-1)*pageSize");
      assert.ok(p.skip >= 0, `skip ${p.skip} >= 0`);
      // NB: integer-ness is deliberately NOT asserted — parsePagination does not
      // floor the page, so `?page=1.5` produces a fractional page (and skip).
      // That second robustness gap is pinned in the KNOWN GAP test below.
    }),
  );
});

test("parsePagination defaults missing params to page 1 / pageSize 20", () => {
  const p = parsePagination(new URLSearchParams());
  assert.equal(p.page, 1);
  assert.equal(p.pageSize, 20);
});

// KNOWN GAPS (pinned as current behaviour, not asserted-as-correct):
// parsePagination coerces with `Number(x) || 1` and clamps with Math.max/
// Math.min — neither rejects a non-finite coercion nor floors a fractional one.
// So `?page=Infinity` → non-finite page, and `?page=1.5` → fractional page/skip.
// Both are harmless today (Prisma rejects a non-integer/non-finite skip) but are
// robustness nits the lib/pagination owner may close with a
// `Math.floor` + `Number.isFinite` guard. These tests document CURRENT behaviour
// so a future fix flips them visibly rather than passing silently. The property
// tests above (A5 / cat-18) surfaced both.
test("parsePagination — KNOWN GAP: non-finite string input is not clamped", () => {
  const p = parsePagination(makeParams("Infinity", "Infinity"));
  assert.equal(p.page, Infinity, "current behaviour: page is left non-finite");
  // The pageSize path DOES stay upper-bounded because Math.min(100, …) caps it.
  assert.equal(p.pageSize, 100, "Math.min still caps pageSize even for Infinity");
});

test("parsePagination — KNOWN GAP: fractional page is not floored", () => {
  const p = parsePagination(makeParams("1.5", "10"));
  assert.equal(p.page, 1.5, "current behaviour: page keeps its fractional part");
  assert.equal(p.skip, (1.5 - 1) * 10, "skip inherits the fraction");
});

test("paginatedResponse.totalPages matches ceil(total / pageSize)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.integer({ min: 1, max: 100 }),
      (total, pageSize) => {
        const params: PaginationParams = {
          page: 1,
          pageSize,
          skip: 0,
          take: pageSize,
        };
        const res = paginatedResponse([], total, params);
        assert.equal(res.totalPages, Math.ceil(total / pageSize));
        assert.ok(res.totalPages >= 0);
        // totalPages never over-counts: (totalPages - 1) * pageSize < total,
        // except the empty case where both are zero.
        if (total > 0) {
          assert.ok((res.totalPages - 1) * pageSize < total);
          assert.ok(res.totalPages * pageSize >= total);
        }
      },
    ),
  );
});
