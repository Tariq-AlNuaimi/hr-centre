import { test } from "node:test";
import assert from "node:assert/strict";
import { BCRYPT_COST, hashPassword } from "../../lib/password";

// The bcrypt work factor is a security parameter, not a tuning preference: too
// low and stolen hashes are cheap to crack. Pin the floor so a future edit that
// lowers it fails the gate (SR-N4). 12 is the 2026 minimum (SECURITY.md §2/§4).
test("BCRYPT_COST meets the minimum work factor", () => {
  assert.ok(
    BCRYPT_COST >= 12,
    `BCRYPT_COST must be >= 12, got ${BCRYPT_COST}`
  );
});

test("hashPassword emits a bcrypt hash at the configured cost", async () => {
  const hash = await hashPassword("correct horse battery staple");
  // bcrypt format: $2<a|b|y>$<two-digit cost>$<22 salt><31 hash>
  const m = hash.match(/^\$2[aby]\$(\d{2})\$/);
  assert.ok(m, `not a bcrypt hash: ${hash}`);
  assert.equal(Number(m![1]), BCRYPT_COST);
});
