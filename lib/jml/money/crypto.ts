import {
  FieldEncryptionError,
  SALARY_KEYRING,
  decryptField,
  encryptField,
} from "@/lib/crypto/field-encryption";
import { JmlError } from "../errors";

/**
 * The ONLY crossing for leaver money (D14) — asset deductions and the final
 * settlement. Settlement figures are derived from the employee's basic salary
 * and are the same data class, so they share SALARY_KEYRING (one key to set,
 * one to rotate). The AAD binds each envelope to its model, row and field
 * (`jml:asset:<id>:deductionAmount`) so a ciphertext moved elsewhere won't open.
 *
 * SEAL fails closed (503 with a sentence); OPEN degrades to null for that
 * field so a missing key hides money while the rest of the case renders.
 * Amounts are OMR strings with at most 3 decimals (baisa).
 */

const aad = (model: string, id: string, field: string) => `jml:${model}:${id}:${field}`;

export function sealMoney(
  model: string,
  id: string,
  field: string,
  value: string | null,
): string | null {
  if (value === null) return null;
  try {
    return encryptField(value, aad(model, id, field), SALARY_KEYRING);
  } catch (e) {
    if (e instanceof FieldEncryptionError) {
      throw new JmlError(
        "Amounts cannot be saved right now: the salary encryption key is missing on the server. Nothing was saved.",
        503,
      );
    }
    throw e;
  }
}

export function openMoney(
  model: string,
  id: string,
  field: string,
  envelope: string | null,
): string | null {
  if (envelope === null) return null;
  try {
    return decryptField(envelope, aad(model, id, field), SALARY_KEYRING);
  } catch (e) {
    if (e instanceof FieldEncryptionError) return null;
    throw e;
  }
}
