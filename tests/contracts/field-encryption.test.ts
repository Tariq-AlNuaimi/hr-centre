import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

/**
 * ADR-067's AES-256-GCM field encryption.
 *
 * The properties asserted here are the ones the ADR *claims*, so if any of them
 * stops being true the claim in the decision record becomes false and this
 * fails. The row-binding test in particular is the whole reason the AAD exists:
 * without it, someone with database write access copies a director's ciphertext
 * onto a row they may read, and the application decrypts it for them.
 */

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");

process.env.SALARY_ENCRYPTION_KEY = KEY;
delete process.env.SALARY_ENCRYPTION_KEY_PREVIOUS;

const {
  encryptField,
  decryptField,
  isEncryptedEnvelope,
  envelopeMatchesPlaintext,
  resetKeyCacheForTests,
  FieldEncryptionError,
} = await import("../../lib/crypto/field-encryption");

const EMP = "1204"; // an odooId — the AAD, per ADR-067

// --- round trip ---------------------------------------------------------------

test("a salary survives the round trip exactly, decimals included", () => {
  for (const value of ["1000", "1234.500", "0", "0.001", "999999999.999"]) {
    assert.equal(decryptField(encryptField(value, EMP), EMP), value);
  }
});

test("the envelope is versioned and shaped as the ADR documents", () => {
  const envelope = encryptField("2500", EMP);
  const parts = envelope.split(".");
  assert.equal(parts.length, 4);
  assert.equal(parts[0], "v1", "the version prefix is what makes rotation a migration");
  assert.ok(isEncryptedEnvelope(envelope));
  assert.equal(isEncryptedEnvelope("2500"), false, "plaintext must not read as an envelope");
  assert.equal(isEncryptedEnvelope("v1.a.b"), false, "a truncated envelope is not an envelope");
});

test("the plaintext never appears in the envelope", () => {
  const envelope = encryptField("7777", EMP);
  assert.ok(!envelope.includes("7777"), `salary leaked into the envelope: ${envelope}`);
});

// --- the property the AAD exists for ------------------------------------------

test("a ciphertext cannot be moved to another employee's row", () => {
  // The attack: someone with DB write access copies a director's encrypted
  // salary onto a row they ARE entitled to read, then reads it through the app.
  const directorsSalary = encryptField("5500", "1001");
  assert.throws(
    () => decryptField(directorsSalary, "1204"),
    FieldEncryptionError,
    "a ciphertext bound to 1001 must not open under 1204",
  );
  assert.equal(decryptField(directorsSalary, "1001"), "5500", "and still opens on its own row");
});

test("encrypting without binding data is refused rather than done weakly", () => {
  assert.throws(() => encryptField("1000", ""), FieldEncryptionError);
});

// --- IV freshness -------------------------------------------------------------

test("equal salaries encrypt to different envelopes", () => {
  // Otherwise the database reveals who is paid the same as whom, without
  // decrypting anything.
  const a = encryptField("3000", "1110");
  const b = encryptField("3000", "1110");
  assert.notEqual(a, b, "a reused IV would leak equality across rows");
  assert.equal(decryptField(a, "1110"), decryptField(b, "1110"));
});

// --- tampering ----------------------------------------------------------------

test("a flipped byte in the ciphertext is caught, not silently decrypted", () => {
  const envelope = encryptField("1000", EMP);
  const parts = envelope.split(".");
  const ct = Buffer.from(parts[2], "base64url");
  ct[0] ^= 0xff;
  parts[2] = ct.toString("base64url");
  assert.throws(() => decryptField(parts.join("."), EMP), FieldEncryptionError);
});

test("a stripped auth tag is caught", () => {
  const parts = encryptField("1000", EMP).split(".");
  parts[3] = Buffer.alloc(16).toString("base64url");
  assert.throws(() => decryptField(parts.join("."), EMP), FieldEncryptionError);
});

test("plaintext left in the column is refused loudly, not read as a salary", () => {
  // The state the migration exists to eliminate. Silently treating it as a
  // value would make a half-finished migration invisible.
  assert.throws(() => decryptField("4200", EMP), FieldEncryptionError);
  assert.throws(() => decryptField("v2.a.b.c", EMP), FieldEncryptionError);
});

// --- rotation -----------------------------------------------------------------

test("rotation: the previous key still opens what it wrote, and writes use the current one", () => {
  const underOldKey = encryptField("1800", EMP);

  // Rotate: yesterday's key becomes PREVIOUS, a new one becomes CURRENT.
  process.env.SALARY_ENCRYPTION_KEY = OTHER_KEY;
  process.env.SALARY_ENCRYPTION_KEY_PREVIOUS = KEY;
  resetKeyCacheForTests();

  assert.equal(decryptField(underOldKey, EMP), "1800", "old rows keep opening mid-rotation");

  const underNewKey = encryptField("1800", EMP);
  assert.notEqual(underNewKey, underOldKey);

  // Finish the rotation: drop the previous key.
  delete process.env.SALARY_ENCRYPTION_KEY_PREVIOUS;
  resetKeyCacheForTests();
  assert.equal(decryptField(underNewKey, EMP), "1800", "re-encrypted rows survive the drop");
  assert.throws(
    () => decryptField(underOldKey, EMP),
    FieldEncryptionError,
    "anything not re-encrypted before the drop is unreadable — the pass must complete",
  );

  process.env.SALARY_ENCRYPTION_KEY = KEY;
  resetKeyCacheForTests();
});

// --- key hygiene --------------------------------------------------------------

test("a missing key fails closed, naming the variable and never a value", () => {
  const saved = process.env.SALARY_ENCRYPTION_KEY;
  delete process.env.SALARY_ENCRYPTION_KEY;
  resetKeyCacheForTests();
  try {
    assert.throws(
      () => encryptField("1000", EMP),
      (err: Error) => {
        assert.match(err.message, /SALARY_ENCRYPTION_KEY/, "the NAME belongs in the message");
        assert.ok(!err.message.includes(saved as string), "the VALUE never does");
        return true;
      },
    );
  } finally {
    process.env.SALARY_ENCRYPTION_KEY = saved;
    resetKeyCacheForTests();
  }
});

test("a key of the wrong length is refused rather than stretched", () => {
  const saved = process.env.SALARY_ENCRYPTION_KEY;
  process.env.SALARY_ENCRYPTION_KEY = randomBytes(16).toString("base64");
  resetKeyCacheForTests();
  try {
    assert.throws(() => encryptField("1000", EMP), /exactly 32 bytes/);
  } finally {
    process.env.SALARY_ENCRYPTION_KEY = saved;
    resetKeyCacheForTests();
  }
});

// --- the verification helper the migration script depends on ------------------

test("envelopeMatchesPlaintext is true only for the right value, row and key", () => {
  const envelope = encryptField("2450", "1205");
  assert.equal(envelopeMatchesPlaintext(envelope, "2450", "1205"), true);
  assert.equal(envelopeMatchesPlaintext(envelope, "2451", "1205"), false, "wrong value");
  assert.equal(envelopeMatchesPlaintext(envelope, "2450", "1206"), false, "wrong row");
  assert.equal(envelopeMatchesPlaintext("not-an-envelope", "2450", "1205"), false);
});
