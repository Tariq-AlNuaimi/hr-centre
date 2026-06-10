import { test } from "node:test";
import assert from "node:assert/strict";

// secret-box reads AUTH_SECRET at call time, so set it before exercising.
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-auth-secret-for-secret-box-tests-0001";

const { encryptSecret, decryptSecret, maskSecret } = await import("../../lib/secret-box");

test("encrypt → decrypt round-trips", () => {
  const plain = "sk-ant-api03-EXAMPLE-key-value-RhFA";
  const enc = encryptSecret(plain);
  assert.notEqual(enc, plain, "ciphertext must differ from plaintext");
  assert.equal(decryptSecret(enc), plain);
});

test("each encryption uses a fresh IV (ciphertexts differ)", () => {
  const a = encryptSecret("same-value");
  const b = encryptSecret("same-value");
  assert.notEqual(a, b, "random IV should make ciphertexts differ");
  assert.equal(decryptSecret(a), "same-value");
  assert.equal(decryptSecret(b), "same-value");
});

test("tampered ciphertext fails authentication", () => {
  const enc = encryptSecret("secret");
  const buf = Buffer.from(enc, "base64");
  buf[buf.length - 1] ^= 0xff; // flip a bit in the ciphertext
  assert.throws(() => decryptSecret(buf.toString("base64")));
});

test("maskSecret shows only the last 4 chars", () => {
  assert.equal(maskSecret("abcdRhFA"), "••••RhFA");
});
