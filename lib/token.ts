import { randomBytes, createHmac } from "node:crypto";

// Invitation-token hash-at-rest (SECURITY.md §1; Phase-5 prerequisite, findings
// register 2026-06-27). The candidate is authorized by an opaque high-entropy
// token carried ONLY in the emailed `/a/<token>` link. We never persist the raw
// token: the DB stores `tokenHash = HMAC-SHA256(token, key)` (indexed/unique) and
// `resolveToken` looks a candidate up by re-hashing the presented token.
//
// Why HMAC, not bcrypt: the token is a 256-bit random credential (no brute-force
// surface that a salt would defend), and we must resolve it by an INDEXED lookup.
// bcrypt's per-value salt makes the hash non-deterministic, so you can't index it
// — you'd table-scan + compare every row. HMAC-SHA256 keyed with a server secret
// is deterministic (indexable) and not invertible: a DB read (threat T-04) yields
// the hash, which cannot be turned back into a usable URL token without the key.
//
// Key: TOKEN_HMAC_KEY (Restricted). Falls back to AUTH_SECRET so local/dev and a
// fork that hasn't set a dedicated key still work (AUTH_SECRET is always present,
// min 32 chars). Production SHOULD set TOKEN_HMAC_KEY so rotating the auth signing
// key doesn't silently invalidate every outstanding invitation link.

const RAW_TOKEN_BYTES = 32; // 256 bits of entropy → base64url ≈ 43 chars

function hmacKey(): string {
  const key = process.env.TOKEN_HMAC_KEY ?? process.env.AUTH_SECRET;
  if (!key) {
    // Never hash with an empty key — that would make every token collide on the
    // same hash. AUTH_SECRET is required by lib/env.ts, so this only trips in a
    // misconfigured runtime; fail loud rather than issue forgeable tokens.
    throw new Error("TOKEN_HMAC_KEY/AUTH_SECRET must be set to hash invitation tokens");
  }
  return key;
}

/** Mint a fresh raw invitation token (the value that goes in the emailed link). */
export function generateInvitationToken(): string {
  return randomBytes(RAW_TOKEN_BYTES).toString("base64url");
}

/** Deterministic HMAC-SHA256 (hex) of a raw token — the value stored + indexed. */
export function hashInvitationToken(rawToken: string): string {
  return createHmac("sha256", hmacKey()).update(rawToken).digest("hex");
}

// NOTE: a constant-time `tokenHashEquals` once lived here but was dead code —
// `resolveToken` authorizes a candidate by an INDEXED `where: { tokenHash }`
// lookup (the DB does the comparison), never by comparing two hashes in app
// code. If a future path ever needs an in-process hash compare, reintroduce it
// with `crypto.timingSafeEqual` (equal-length hex buffers) rather than `===`.
