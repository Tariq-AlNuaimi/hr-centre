import { test } from "node:test";
import assert from "node:assert/strict";

// lib/crypto derives its key from AUTH_SECRET at call time — set a deterministic one
// for this suite (the app always has AUTH_SECRET; this just makes the test hermetic).
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-auth-secret-at-least-32-chars-long-xx";

import { encryptSecret, decryptSecret, secretHint, safeEqual } from "../../lib/crypto";

// AES-256-GCM secret-at-rest helpers (ADR-031). These lock the encrypted-token
// contract: a roundtrip recovers the plaintext, the ciphertext is non-deterministic
// (random IV), tampering is detected (auth tag), and any malformed/forged input
// degrades to null instead of throwing.

test("encrypt → decrypt recovers the plaintext", () => {
  const plain = "sk-endpoint-token-value-1234567890-abcdef";
  const blob = encryptSecret(plain);
  assert.notEqual(blob, plain);
  assert.equal(blob.split(":").length, 3); // iv:authTag:ciphertext
  assert.equal(decryptSecret(blob), plain);
});

test("same plaintext encrypts to different blobs (random IV)", () => {
  assert.notEqual(encryptSecret("identical"), encryptSecret("identical"));
});

test("a tampered ciphertext fails authentication → null (never the wrong plaintext)", () => {
  const blob = encryptSecret("a-real-secret");
  const [iv, tag, data] = blob.split(":");
  const bytes = Buffer.from(data, "base64");
  bytes[0] ^= 0xff; // flip a byte
  assert.equal(decryptSecret([iv, tag, bytes.toString("base64")].join(":")), null);
});

test("malformed / empty / null input → null, not a throw", () => {
  assert.equal(decryptSecret("not-a-blob"), null);
  assert.equal(decryptSecret("only:two"), null);
  assert.equal(decryptSecret(""), null);
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(undefined), null);
});

test("secretHint is an opaque last-4 of the ciphertext (not the plaintext)", () => {
  const plain = "another-secret-token-value";
  const blob = encryptSecret(plain);
  const hint = secretHint(blob);
  assert.ok(hint && hint.length === 4);
  assert.ok(!plain.includes(hint!)); // derived from ciphertext, leaks nothing
  assert.equal(secretHint(null), null);
});

test("safeEqual is a correct constant-time compare", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
});
