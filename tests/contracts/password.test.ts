import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { hash as argon2Hash } from "@node-rs/argon2";
import {
  ARGON2_OPTIONS,
  hashPassword,
  verifyPassword,
  needsRehash,
} from "../../lib/password";

// The Argon2id parameters are a security floor, not a tuning preference: too low
// and stolen hashes are cheap to crack. Pin the OWASP 2026 minimums so a future
// edit that weakens them fails the gate (SR-N4; ADR-039; SECURITY.md §2/§4).
test("ARGON2_OPTIONS meet the OWASP minimum parameters", () => {
  assert.ok(
    ARGON2_OPTIONS.memoryCost >= 19456,
    `memoryCost must be >= 19456 KiB, got ${ARGON2_OPTIONS.memoryCost}`
  );
  assert.ok(
    ARGON2_OPTIONS.timeCost >= 2,
    `timeCost must be >= 2, got ${ARGON2_OPTIONS.timeCost}`
  );
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

test("verifyPassword still accepts a legacy bcrypt hash (silent migration)", async () => {
  // A hash produced the OLD way must keep verifying, so existing users log in
  // without a reset (ADR-039 legacy-verify window).
  const legacy = await bcrypt.hash("old-password", 12);
  assert.ok(legacy.startsWith("$2"), "sanity: bcrypt hash prefix");
  assert.equal(await verifyPassword("old-password", legacy), true);
  assert.equal(await verifyPassword("nope", legacy), false);
});

test("needsRehash flags legacy hashes and clears for Argon2id", async () => {
  const legacy = await bcrypt.hash("x", 12);
  assert.equal(needsRehash(legacy), true, "bcrypt hash must be upgraded");
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
