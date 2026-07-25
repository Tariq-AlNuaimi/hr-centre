import { test } from "node:test";
import assert from "node:assert/strict";
import { hash as argon2Hash } from "@node-rs/argon2";
import { ARGON2_OPTIONS, hashPassword, verifyPassword, needsRehash } from "../../lib/password";

// The Argon2id parameters are a security floor, not a tuning preference: too low
// and stolen hashes are cheap to crack. Pin the OWASP 2026 minimums so a future
// edit that weakens them fails the gate (SR-N4; ADR-039; SECURITY.md §2/§4).
test("ARGON2_OPTIONS meet the OWASP minimum parameters", () => {
  assert.ok(
    ARGON2_OPTIONS.memoryCost >= 19456,
    `memoryCost must be >= 19456 KiB, got ${ARGON2_OPTIONS.memoryCost}`,
  );
  assert.ok(ARGON2_OPTIONS.timeCost >= 2, `timeCost must be >= 2, got ${ARGON2_OPTIONS.timeCost}`);
  assert.ok(ARGON2_OPTIONS.parallelism >= 1);
});

test("hashPassword emits an Argon2id hash", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.ok(hash.startsWith("$argon2id$"), `not an Argon2id hash: ${hash}`);
});

test("verifyPassword round-trips an Argon2id hash", async () => {
  const hash = await hashPassword("s3cret-passphrase");
  assert.equal(await verifyPassword("s3cret-passphrase", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
});

// A real bcrypt hash, shape-valid, kept as a literal so the test needs no bcrypt dep.
const LEGACY_BCRYPT = "$2b$12$K8y1p3Qh0oQ2u5r7t9v1cO9m4n6b8x0z2a4c6e8g0i2k4m6o8q0s2";

test("verifyPassword REJECTS a legacy bcrypt hash (bcryptjs sunset, item 12)", async () => {
  // Inverted 2026-07-25: bcryptjs was removed, so Argon2id is the only supported
  // algorithm. A `$2*` hash is now a failed login (never a throw) — the affected user
  // recovers through the password-reset flow. See lib/password.ts module header.
  assert.ok(LEGACY_BCRYPT.startsWith("$2"), "sanity: bcrypt hash prefix");
  assert.equal(await verifyPassword("old-password", LEGACY_BCRYPT), false);
  assert.equal(await verifyPassword("nope", LEGACY_BCRYPT), false);
});

test("needsRehash flags legacy hashes and clears for Argon2id", async () => {
  assert.equal(needsRehash(LEGACY_BCRYPT), true, "bcrypt hash must be upgraded");
  const modern = await hashPassword("x");
  assert.equal(needsRehash(modern), false, "argon2 hash is current");
});

test("needsRehash flags an Argon2id hash weaker than the current params", async () => {
  // A hash made at weaker params than ARGON2_OPTIONS must be re-hashed on login,
  // so raising the params over time actually upgrades already-migrated users.
  const weak = await argon2Hash("x", { memoryCost: 4096, timeCost: 1, parallelism: 1 });
  assert.ok(weak.startsWith("$argon2id$"), "sanity: argon2id prefix");
  assert.equal(needsRehash(weak), true, "weaker embedded params must trigger a rehash");
  assert.equal(needsRehash(await hashPassword("x")), false, "current-params hash is fine");
});

test("verifyPassword returns false (never throws) on a malformed hash", async () => {
  assert.equal(await verifyPassword("anything", "not-a-real-hash"), false);
  assert.equal(await verifyPassword("anything", ""), false);
});

// The malformed-hash cases above route to bcrypt.compare, which RETURNS false rather
// than throwing — so they never exercise verifyPassword's catch block. A hash that LOOKS
// like Argon2 but has a corrupt body makes argon2Verify THROW, which is the only path that
// reaches the catch. Without this, a mutation of the catch to `return true` (a corrupt hash
// silently authenticating!) survives — the exact failure mutation testing (V2-405) surfaced.
test("verifyPassword swallows an Argon2 verify THROW and returns false (catch path)", async () => {
  assert.equal(await verifyPassword("anything", "$argon2id$v=19$corrupt-body"), false);
});

// needsRehash's defensive `if (!m) return true` on an Argon2-prefixed hash whose params
// don't parse. Pins that a malformed argon2 header re-hashes (never trusts it as current).
test("needsRehash re-hashes an Argon2-prefixed hash with an unparseable param header", () => {
  assert.equal(needsRehash("$argon2id$notaparamstring"), true);
});

// The single weak-params test below leaves EACH `< current` comparison individually
// mutable-to-false-and-surviving (any one true keeps the OR true). Pin each parameter on
// its own — only-memory-weak and only-time-weak — so a mutation that drops a specific
// downgrade check (e.g. stops noticing a weakened memoryCost) fails. (parallelism has a
// floor of 1 = the current value, so `m[3] < 1` is unreachable — an equivalent mutant.)
test("needsRehash detects a weakened memoryCost alone (kills the m[1] check)", async () => {
  const weakMem = await argon2Hash("x", { memoryCost: 4096, timeCost: 2, parallelism: 1 });
  assert.equal(needsRehash(weakMem), true, "lower memoryCost alone must trigger a rehash");
});

test("needsRehash detects a weakened timeCost alone (kills the m[2] check)", async () => {
  const weakTime = await argon2Hash("x", { memoryCost: 19456, timeCost: 1, parallelism: 1 });
  assert.equal(needsRehash(weakTime), true, "lower timeCost alone must trigger a rehash");
});
