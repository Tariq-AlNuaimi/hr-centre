import {
  FieldEncryptionError,
  ID_DOCUMENT_KEYRING,
  decryptField,
  encryptField,
  type Keyring,
} from "@/lib/crypto/field-encryption";
import { IdDocumentKeyError } from "@/lib/people/id-documents";

/**
 * The ONLY crossing for hiring compensation — ADR-080 decision 2.
 *
 * Six Interview Hub fields are Restricted pay data: offer salary and
 * allowances, a candidate's salary expectation, a payslip's stated amount, an
 * offer version's frozen terms and a negotiated salary. Each is stored as an
 * ADR-067 AES-256-GCM envelope in an `*Enc` text column, under a key of its own
 * so hiring pay can rotate (or leak) independently of employee salary.
 *
 * The AAD binds every envelope to its row AND field — `hiring:offer:<id>:salary`
 * — so a ciphertext copied onto another offer, or into another column of the
 * same offer, will not open. Callers therefore need the row id BEFORE the
 * insert; `newHiringId()` supplies one.
 *
 * Posture (same as ID documents, lib/people/id-documents.ts):
 *   - SEAL fails closed and loudly (`HiringCompKeyError` → 503 with a sentence):
 *     pay is never written in the clear and never written unreadably.
 *   - OPEN degrades to "unavailable" for that field only, so a missing key
 *     hides pay while the rest of the record still renders.
 */

const HIRING_COMP_KEYRING: Keyring = {
  current: "HIRING_COMP_ENCRYPTION_KEY",
  previous: "HIRING_COMP_ENCRYPTION_KEY_PREVIOUS",
  purpose: "Hiring compensation is stored encrypted (ADR-080)",
};

export type CompModel = "offer" | "candidate" | "document" | "offerVersion" | "negotiationNote";

export class HiringCompKeyError extends Error {
  readonly status = 503;
  constructor() {
    super(
      "Pay figures cannot be saved right now: the hiring encryption key is missing or invalid " +
        "on the server. Nothing was saved. Ask a platform administrator to set " +
        "HIRING_COMP_ENCRYPTION_KEY.",
    );
    this.name = "HiringCompKeyError";
  }
}

const aadFor = (model: string, id: string, field: string) => `hiring:${model}:${id}:${field}`;

function seal(model: string, id: string, field: string, plaintext: string, ring: Keyring) {
  try {
    return encryptField(plaintext, aadFor(model, id, field), ring);
  } catch (e) {
    if (e instanceof FieldEncryptionError) throw new HiringCompKeyError();
    throw e;
  }
}

function open(model: string, id: string, field: string, envelope: string, ring: Keyring) {
  try {
    return decryptField(envelope, aadFor(model, id, field), ring);
  } catch (e) {
    if (e instanceof FieldEncryptionError) return null;
    throw e;
  }
}

/** Seal a money amount (or clear it with null). */
export function sealAmount(
  model: CompModel,
  id: string,
  field: string,
  value: number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) throw new RangeError(`${field} must be a finite number`);
  return seal(model, id, field, String(value), HIRING_COMP_KEYRING);
}

/** Open a sealed amount. null = none recorded OR unreadable (see `isUnreadable`). */
export function openAmount(
  model: CompModel,
  id: string,
  field: string,
  envelope: string | null,
): number | null {
  if (!envelope) return null;
  const text = open(model, id, field, envelope, HIRING_COMP_KEYRING);
  if (text === null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Seal a JSON value (allowances map, frozen offer terms). */
export function sealJson(
  model: CompModel,
  id: string,
  field: string,
  value: unknown,
): string | null {
  if (value === null || value === undefined) return null;
  return seal(model, id, field, JSON.stringify(value), HIRING_COMP_KEYRING);
}

export function openJson<T>(
  model: CompModel,
  id: string,
  field: string,
  envelope: string | null,
): T | null {
  if (!envelope) return null;
  const text = open(model, id, field, envelope, HIRING_COMP_KEYRING);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** True when a stored envelope exists but cannot be opened (missing/rotated key, tampering). */
export function isUnreadable(model: CompModel, id: string, field: string, envelope: string | null) {
  return envelope !== null && open(model, id, field, envelope, HIRING_COMP_KEYRING) === null;
}

/** The candidate's national / civil ID — under the ID-document key, not the pay key. */
export function sealNec(candidateId: string, value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return encryptField(value, aadFor("candidate", candidateId, "nec"), ID_DOCUMENT_KEYRING);
  } catch (e) {
    if (e instanceof FieldEncryptionError) {
      throw new IdDocumentKeyError(
        "The national ID cannot be saved right now: the ID encryption key is missing or invalid " +
          "on the server. Nothing was saved. Ask a platform administrator to set ID_ENCRYPTION_KEY.",
      );
    }
    throw e;
  }
}

export function openNec(candidateId: string, envelope: string | null): string | null {
  if (!envelope) return null;
  return open("candidate", candidateId, "nec", envelope, ID_DOCUMENT_KEYRING);
}

/** A row id minted before insert, so the AAD can bind to it. */
export function newHiringId(): string {
  return `h${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * A secret hiring setting (the AI provider key), under the hiring key with an
 * AAD of `hiring:setting:<key>:value`. Seal fails closed; open answers null
 * when the key is missing or rotated, so AI then reads as unconfigured.
 */
export function sealSecretSetting(key: string, value: string): string {
  return seal("setting", key, "value", value, HIRING_COMP_KEYRING);
}

export function openSecretSetting(key: string, envelope: string | null): string | null {
  if (!envelope) return null;
  return open("setting", key, "value", envelope, HIRING_COMP_KEYRING);
}
