import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

// SUNSET COMPLETED 2026-07-25 (OPEN-ITEMS item 12, V2-409 debt): `bcryptjs` is REMOVED.
// Argon2id (ADR-039) is now the only supported algorithm.
//
// BREAKING FOR PRE-ADR-039 FORKS — read before syncing this change into an existing fork.
// A legacy `$2*` (bcrypt) hash can no longer be verified, so any user who has NOT logged in
// since the Argon2id migration cannot authenticate; `verifyPassword` returns false and they
// must go through the password-reset flow (`/forgot-password`) to regain access. Nothing is
// lost — the account and its data are untouched — but the login itself is unrecoverable
// without a reset. Before adopting, a fork with pre-existing users should confirm:
//   SELECT count(*) FROM "users" WHERE "passwordHash" LIKE '$2%';   -- must be 0
// (Verified 0 in this template's seeded database; a fresh fork only ever writes Argon2id,
// so this is a no-op for anything created from the template.)

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
 * Verify a plaintext password against a stored Argon2id hash.
 *
 * Argon2id is the ONLY supported algorithm since the bcrypt sunset (2026-07-25). A
 * non-Argon2 hash — including a legacy `$2*` bcrypt one — is treated as a failed login
 * (returns false), NOT an error: the affected user recovers via the password-reset flow.
 * See the module header for the fork-migration caveat.
 *
 * Returns false (never throws) on a malformed/unknown hash — a bad hash is a failed
 * login, not a 500.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    if (!hash.startsWith("$argon2")) return false;
    return await argon2Verify(hash, plain);
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
