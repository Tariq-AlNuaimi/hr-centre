// Vibe Inspector — assessment credential helpers (ADR-016).
// Encrypts login secrets before persisting and shapes a secret-free summary for the
// client. The audit extension additionally scrubs passwordEnc/cookieEnc.

import { encryptSecret } from "@/lib/secret-box";
import type { AssessmentCredential, AuthMode } from "@/generated/prisma/client";
import type { CredentialInput } from "@/lib/validations/assessment";

export interface CredentialRow {
  role: string;
  username: string | null;
  passwordEnc: string | null;
  cookieEnc: string | null;
  order: number;
}

/** Encrypt + shape credentials for a create/replace, scoped to the auth mode. */
export function toCredentialRows(credentials: CredentialInput[] | undefined, authMode: AuthMode): CredentialRow[] {
  if (authMode === "NONE" || !credentials) return [];
  return credentials
    .filter((c) => c.role.trim().length > 0)
    .map((c, i) => ({
      role: c.role.trim(),
      username: authMode === "FORM" ? c.username?.trim() || null : null,
      passwordEnc: authMode === "FORM" && c.password ? encryptSecret(c.password) : null,
      cookieEnc: authMode === "COOKIE" && c.cookie ? encryptSecret(c.cookie) : null,
      order: i,
    }));
}

/** Secret-free view for the client — never expose password/cookie ciphertext. */
export function credentialSummaries(rows: AssessmentCredential[]) {
  return [...rows]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      role: c.role,
      username: c.username,
      hasPassword: Boolean(c.passwordEnc),
      hasCookie: Boolean(c.cookieEnc),
    }));
}
