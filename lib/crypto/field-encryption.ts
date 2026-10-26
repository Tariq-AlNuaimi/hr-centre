import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Application-level AES-256-GCM for a single Restricted column — ADR-067.
 *
 * This exists for exactly one threat: **someone who reads the database
 * directly.** A Neon connection string, a support export, a backup, or a leaked
 * `DATABASE_URL` yields every salary in the company in one `SELECT`. It does
 * NOT address the ADR-065 path, where a platform admin reaches HR access
 * *through the application* — the app decrypts for them, by design. Conflating
 * the two is the main way this control gets mis-sold.
 *
 * Node's built-in `crypto`, so there is no dependency to audit and nothing new
 * in any bundle.
 *
 * ## The envelope
 *
 *     v1.<base64url iv>.<base64url ciphertext>.<base64url authTag>
 *
 * The version prefix is not decoration. It is what makes a key rotation a
 * migration rather than a rewrite: a reader can tell which scheme produced a
 * value before trying to undo it.
 *
 * ## The ciphertext is bound to its row
 *
 * GCM's additional authenticated data is the employee's `odooId`. Two reasons,
 * and the second is the one that matters:
 *
 *  1. `odooId` is known *before* the row exists, so the import encrypts in the
 *     same pass that builds the insert. Binding to the cuid `id` would force an
 *     update-after-insert on a Restricted value.
 *  2. It makes a ciphertext non-transferable. Someone with database WRITE
 *     access cannot copy a director's encrypted salary onto a row they are
 *     entitled to read and have the application decrypt it for them — the tag
 *     check fails, because the AAD no longer matches. Without AAD that attack
 *     works against every scheme ADR-067 considered.
 *
 * ## Failure is loud, deliberately
 *
 * `decryptField` throws rather than returning null. A ciphertext that will not
 * open is a data-integrity event — a wrong key, a tampered row, or a value
 * moved between rows — and tamper-detection is the whole point of the AAD
 * above. Returning null would render it as "no salary recorded", which is the
 * one outcome that makes tampering invisible. A directory page that fails
 * loudly because a row was altered is behaving correctly.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM's standard nonce length; anything else weakens it.
const KEY_BYTES = 32; // AES-256.

/** The env var NAMES. Their VALUES are Restricted and must never be logged. */
/**
 * A named pair of key variables. Salary (ADR-067) was the only one; HR Centre
 * F-b adds ID documents under their OWN key so the two can rotate — or leak —
 * independently. Everything else (envelope, AAD binding, rotation fallback) is
 * shared.
 */
export type Keyring = { current: string; previous: string; purpose: string };

export const SALARY_KEYRING: Keyring = {
  current: "SALARY_ENCRYPTION_KEY",
  previous: "SALARY_ENCRYPTION_KEY_PREVIOUS",
  purpose: "Salary is stored encrypted (ADR-067)",
};

export const ID_DOCUMENT_KEYRING: Keyring = {
  current: "ID_ENCRYPTION_KEY",
  previous: "ID_ENCRYPTION_KEY_PREVIOUS",
  purpose: "Civil ID and passport numbers are stored encrypted (HR Centre F-b)",
};

export class FieldEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldEncryptionError";
  }
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/**
 * Read one key from the environment.
 *
 * Fails closed, and the message names the VARIABLE, never the value — the
 * `no-secret-env-in-console` floor rule applies to thrown messages too, because
 * an error string reaches logs just as surely as a `console.log`.
 */
function readKey(varName: string, required: boolean, purpose: string): Buffer | null {
  const raw = process.env[varName];
  if (!raw) {
    if (!required) return null;
    throw new FieldEncryptionError(
      `${varName} is not set. ${purpose}; the app cannot read or ` +
        `write it without the key. Generate one with: openssl rand -base64 32`,
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new FieldEncryptionError(`${varName} is not valid base64.`);
  }
  if (key.length !== KEY_BYTES) {
    throw new FieldEncryptionError(
      `${varName} must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

/**
 * Keys are read on first use rather than at module load, so a process that
 * never touches salary (most of them) does not require the key to boot, and so
 * a test can set the variable before the first call.
 */
const cachedKeys = new Map<string, { current: Buffer; previous: Buffer | null }>();

function keys(ring: Keyring) {
  let found = cachedKeys.get(ring.current);
  if (!found) {
    found = {
      current: readKey(ring.current, true, ring.purpose) as Buffer,
      previous: readKey(ring.previous, false, ring.purpose),
    };
    cachedKeys.set(ring.current, found);
  }
  return found;
}

/** Test seam. Not exported from any barrel — nothing in `app/` should call it. */
export function resetKeyCacheForTests(): void {
  cachedKeys.clear();
}

/** True when a stored value looks like something this module produced. */
export function isEncryptedEnvelope(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split(".").length === 4;
}

/**
 * Encrypt one field value, bound to `aad`.
 *
 * A fresh random IV per write means the same salary encrypts to a different
 * envelope every time — so ciphertext equality leaks nothing, and nobody can
 * tell from the database that two people are paid the same.
 */
export function encryptField(
  plaintext: string,
  aad: string,
  ring: Keyring = SALARY_KEYRING,
): string {
  if (aad.length === 0) {
    throw new FieldEncryptionError("Refusing to encrypt without binding data — see ADR-067.");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keys(ring).current, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, b64url(iv), b64url(ciphertext), b64url(cipher.getAuthTag())].join(".");
}

function openWith(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer, aad: string): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // A failed tag check is indistinguishable from a wrong key here, and that
    // is fine — the caller learns only "this did not open".
    return null;
  }
}

/**
 * Decrypt one field value. Throws if it will not open — see the header.
 *
 * Tries the current key, then the previous one, so a rotation can proceed
 * without a flag day: deploy both keys, re-encrypt in the background, then drop
 * the previous one.
 */
export function decryptField(
  envelope: string,
  aad: string,
  ring: Keyring = SALARY_KEYRING,
): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new FieldEncryptionError(
      `Stored value is not a ${VERSION} envelope. It may predate ADR-067's migration, or the ` +
        `column may hold plaintext that was never encrypted.`,
    );
  }
  const [, ivPart, ctPart, tagPart] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const ct = Buffer.from(ctPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");

  const { current, previous } = keys(ring);
  const opened =
    openWith(current, iv, ct, tag, aad) ?? (previous ? openWith(previous, iv, ct, tag, aad) : null);

  if (opened === null) {
    throw new FieldEncryptionError(
      "Encrypted value failed to decrypt. Either the key is wrong, or the row was altered, or " +
        "this ciphertext belongs to a different employee (it is bound to their id — ADR-067).",
    );
  }
  return opened;
}

/**
 * Round-trip check used by the migration script's verification pass.
 *
 * Constant-time comparison is not strictly required for a value we already
 * hold, but it costs nothing and keeps a plaintext salary out of a `===` that a
 * future refactor might turn into a log line.
 */
export function envelopeMatchesPlaintext(
  envelope: string,
  expectedPlaintext: string,
  aad: string,
): boolean {
  let decrypted: string;
  try {
    decrypted = decryptField(envelope, aad);
  } catch {
    return false;
  }
  const a = Buffer.from(decrypted, "utf8");
  const b = Buffer.from(expectedPlaintext, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
