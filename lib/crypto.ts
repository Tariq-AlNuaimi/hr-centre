import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * App-layer secret encryption at rest (ADR-031). Used for the Restricted endpoint
 * TOKENS an HR_ADMIN sets in Settings (`AppSetting.valueEncrypted`). AES-256-GCM
 * (authenticated, so tampering is detectable); the key is derived from `AUTH_SECRET`
 * via HKDF-SHA256 with a fixed app-specific `info` label — no NEW secret to manage,
 * and `AUTH_SECRET` is already Restricted + required.
 *
 * SERVER-ONLY: reads AUTH_SECRET and handles plaintext secrets — never import from a
 * client component. The plaintext is materialized ONLY at the moment of an outbound
 * LLM/scoring call; it is never returned to the client or written to the audit log
 * (`valueEncrypted` is in SCRUB_FIELDS).
 *
 * OPERATIONAL CAVEAT (documented in SECURITY.md §4): rotating `AUTH_SECRET` changes
 * the derived key, so previously-stored ciphertext can no longer be decrypted —
 * `decryptSecret` returns null (treated as "not configured") and the operator
 * re-enters the tokens. Same class of caveat as the JWT / token-HMAC keys.
 */

// Fixed, non-secret HKDF parameters. The salt/info bind the derived key to THIS use
// so the same AUTH_SECRET can derive unrelated keys elsewhere without collision.
const HKDF_SALT = Buffer.from("rihal-app-setting-salt-v1");
const HKDF_INFO = Buffer.from("rihal-app-setting-secret-aes256gcm-v1");
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set (>=32 chars) to encrypt secrets at rest");
  }
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), HKDF_SALT, HKDF_INFO, KEY_BYTES));
}

/**
 * Encrypt a UTF-8 plaintext secret. Returns `iv:authTag:ciphertext` (all base64).
 * A fresh random IV per call means the same plaintext encrypts to different blobs.
 */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/**
 * Decrypt a blob produced by `encryptSecret`. Returns null on ANY failure —
 * malformed input, a wrong/rotated key, or a tampered ciphertext (GCM auth fails) —
 * so a corrupt setting degrades to "not configured" rather than throwing.
 */
export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null;
  const parts = blob.split(":");
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    if (iv.length !== IV_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * A short, non-reversible hint for a stored secret so the UI can show "•••• 1a2b"
 * without ever returning the plaintext. Derived from the ciphertext blob (not the
 * plaintext), so it leaks nothing about the secret itself.
 */
export function secretHint(blob: string | null | undefined): string | null {
  if (!blob) return null;
  // Last 4 chars of the base64 ciphertext segment — stable per stored value, opaque.
  const seg = blob.split(":")[2] ?? "";
  return seg.length >= 4 ? seg.slice(-4) : null;
}
