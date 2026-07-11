import bcrypt from "bcryptjs";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

// Argon2id is the current algorithm (OWASP Password Storage default; ADR-039).
// These params are the OWASP 2026 baseline — tune per deployment: raise
// memoryCost / timeCost as hardware allows. @node-rs/argon2 defaults to the
// Argon2id variant, and the parameters are embedded in the hash string, so
// verify() needs no options to check an existing hash.
export const ARGON2_OPTIONS = {
  memoryCost: 19456, // KiB (19 MiB)
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash a plaintext password with Argon2id (the current algorithm). */
export function hashPassword(plain: string): Promise<string> {
  return argon2Hash(plain, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored hash, transparently handling
 * BOTH current Argon2id hashes (`$argon2…`) and any legacy bcrypt hash (`$2a/b/x/y$…`)
 * so an existing fork's users log in without a forced reset. Routing is by "is it
 * Argon2?" — the exact complement of needsRehash() — so every non-Argon2 hash goes
 * to bcrypt.compare (which handles all `$2*` variants), never to argon2Verify.
 * Returns false (never throws) on a malformed/unknown hash — a bad hash is a failed
 * login, not a 500. Pair with needsRehash() to upgrade a legacy hash after verify.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    if (hash.startsWith("$argon2")) return await argon2Verify(hash, plain);
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * True when a stored hash should be re-hashed after a successful login. Two
 * cases: (1) a legacy non-Argon2id hash (e.g. bcrypt), and (2) an Argon2id hash
 * whose embedded parameters are WEAKER than the current ARGON2_OPTIONS — so when
 * the params are raised over time (as the module comment invites), already-
 * migrated hashes get upgraded to the new floor on next login instead of being
 * frozen at the old strength. This is the silent-migration hook: verify with
 * verifyPassword(), then if needsRehash() write a fresh hashPassword() value.
 */
export function needsRehash(hash: string): boolean {
  if (!hash.startsWith("$argon2")) return true;
  // Argon2 encodes its params as `...$m=<KiB>,t=<iters>,p=<lanes>$...`.
  const m = hash.match(/\$m=(\d+),t=(\d+),p=(\d+)\$/);
  if (!m) return true; // unparseable argon2 header -> re-hash defensively
  return (
    Number(m[1]) < ARGON2_OPTIONS.memoryCost ||
    Number(m[2]) < ARGON2_OPTIONS.timeCost ||
    Number(m[3]) < ARGON2_OPTIONS.parallelism
  );
}
