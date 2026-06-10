// AES-256-GCM secret box for encrypting Restricted values at rest (ADR-016).
//
// Used to store the AI provider API key in the DB without persisting plaintext.
// The key is derived from AUTH_SECRET (already required by the app) via scrypt, so
// no new secret is introduced. Ciphertext format (single base64 string):
//   base64( iv[12] || authTag[16] || ciphertext )
//
// NOTE: rotating AUTH_SECRET invalidates previously-encrypted values — they will
// fail to decrypt and the engine falls back to the env config until re-saved.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required to encrypt/decrypt stored secrets");
  }
  // Fixed salt: the secret itself is the entropy; a static salt keeps decryption
  // deterministic across instances without a separate stored salt.
  return scryptSync(secret, "vibe-inspector.secret-box.v1", 32);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * Decrypt without throwing. Returns null when the payload can't be decrypted —
 * e.g. AUTH_SECRET was rotated, or the ciphertext is corrupt. Callers treat null
 * as "no usable stored key" and fall back gracefully (never 500).
 */
export function tryDecryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decryptSecret(payload);
  } catch {
    return null;
  }
}

/**
 * Remove a known secret from a string before it's surfaced in an error message or
 * persisted run failure — some upstream providers echo the Authorization key in
 * their error bodies.
 */
export function redactSecret(text: string, secret: string | null | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

/** Last-4 masked form for display, e.g. "••••RhFA". Never returns the full key. */
export function maskSecret(plaintext: string): string {
  // Don't leak a short/empty key by "masking" its entirety.
  if (plaintext.length <= 4) return "••••";
  return `••••${plaintext.slice(-4)}`;
}
