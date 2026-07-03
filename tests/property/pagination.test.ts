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
// huge (but finite) values, floats, non-numeric junk, AND the non-finite
// coercions ("Infinity", "1e309") — the full adversarial surface a real query
// string can carry. parsePagination now guards all of these (floor + finite +
// >= 1 fallback), so they are folded into the generator rather than pinned as a
// gap: the properties below must hold for every one of them.
const paramValue = fc.oneof(
  fc.integer({ min: -100000, max: 100000 }).map(String),
  fc.integer({ min: -1000, max: 1000 }).map((n) => String(n / 7)), // floats
  fc.constantFrom("", "NaN", "-0", "1e3", "abc", "  5  ", "1.5", "-42", "0", "99999999999", "Infinity", "1e309", "-Infinity"),
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
      // page/pageSize/skip are always INTEGERS now — parsePagination floors and
      // finite-guards, so `?page=1.5`/`?page=Infinity` can no longer leak a
      // fractional or non-finite skip into Prisma.
      assert.ok(Number.isInteger(p.page), `page ${p.page} is an integer`);
      assert.ok(Number.isInteger(p.pageSize), `pageSize ${p.pageSize} is an integer`);
      assert.ok(Number.isInteger(p.skip), `skip ${p.skip} is an integer`);
    }),
  );
});

test("parsePagination defaults missing params to page 1 / pageSize 20", () => {
  const p = parsePagination(new URLSearchParams());
  assert.equal(p.page, 1);
  assert.equal(p.pageSize, 20);
});

// CLOSED GAPS (session 12): the two robustness nits the property tests above
// (A5 / cat-18) surfaced are now fixed by the `Math.floor` + `Number.isFinite`
// guard in parsePagination (`toPositiveInt`). These tests assert the FIXED
// behaviour so a regression flips them visibly.
test("parsePagination — non-finite string input falls back to defaults", () => {
  const p = parsePagination(makeParams("Infinity", "Infinity"));
  assert.equal(p.page, 1, "non-finite page falls back to 1");
  assert.equal(p.pageSize, 20, "non-finite pageSize falls back to the default 20");
  assert.equal(p.skip, 0, "skip is 0 for the fallback page");
});

test("parsePagination — fractional page is floored to an integer", () => {
  const p = parsePagination(makeParams("1.5", "10"));
  assert.equal(p.page, 1, "1.5 is floored to 1");
  assert.equal(p.skip, 0, "skip = (1-1)*10 = 0");
  assert.ok(
    Number.isInteger(p.page) && Number.isInteger(p.skip),
    "page and skip are integers",
  );
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
