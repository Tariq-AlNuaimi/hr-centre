import bcrypt from "bcryptjs";

// Single source of truth for the bcrypt work factor. Tune once here rather than
// per call site. 12 is a sensible 2026 default; raise it as hardware improves.
export const BCRYPT_COST = 12;

/** Hash a plaintext password with the shared cost factor. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}
