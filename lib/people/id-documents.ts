import {
  FieldEncryptionError,
  ID_DOCUMENT_KEYRING,
  decryptField,
  encryptField,
} from "@/lib/crypto/field-encryption";

/**
 * The two ID-number crossings — blueprint §2 (AC-F2.2). Same AES-256-GCM
 * envelope and `odooId` binding as salary (ADR-067), under a SEPARATE key
 * (`ID_ENCRYPTION_KEY`) so the two rotate independently.
 *
 * Failure posture differs on purpose between the two directions:
 *   - WRITE fails closed and loudly (`IdDocumentKeyError`): storing an ID number
 *     we could never read back, or in the clear, is never acceptable.
 *   - READ degrades to "unavailable" for THAT field only, so a missing key in
 *     production hides the ID numbers with a clear message while the rest of the
 *     record still renders (blueprint worst path).
 */

export class IdDocumentKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdDocumentKeyError";
  }
}

export function encryptIdNumber(plaintext: string | null, odooId: string): string | null {
  if (plaintext === null) return null;
  try {
    return encryptField(plaintext, odooId, ID_DOCUMENT_KEYRING);
  } catch (e) {
    if (e instanceof FieldEncryptionError) {
      throw new IdDocumentKeyError(
        "ID document numbers cannot be saved right now: the ID encryption key is missing or " +
          "invalid on the server. Nothing was saved. Ask a platform administrator to set " +
          "ID_ENCRYPTION_KEY.",
      );
    }
    throw e;
  }
}

/** `{ value }` when it opens, `{ unavailable: true }` when the key cannot open it. */
export function readIdNumber(
  envelope: string | null,
  odooId: string,
): { value: string | null; unavailable: boolean } {
  if (envelope === null) return { value: null, unavailable: false };
  try {
    return { value: decryptField(envelope, odooId, ID_DOCUMENT_KEYRING), unavailable: false };
  } catch (e) {
    if (e instanceof FieldEncryptionError) return { value: null, unavailable: true };
    throw e;
  }
}
