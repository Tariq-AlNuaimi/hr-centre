import { randomBytes } from "node:crypto";

/**
 * Provisional Odoo ids for pre-joiners (JML S1, ADR-075). Pure, so the import
 * validator can recognise them without loading a database client.
 *
 * `Employee.odooId` is THE permanent key and is required, but a person who has
 * accepted an offer has no Odoo record yet. They get `PENDING-<random>` — a
 * namespace no real Odoo id uses — until HR records the real one through
 * `recordOdooId` (lib/people/odoo-id.ts).
 */

export const PROVISIONAL_PREFIX = "PENDING-";

export function provisionalOdooId(): string {
  return `${PROVISIONAL_PREFIX}${randomBytes(9).toString("hex")}`;
}

export function isProvisionalOdooId(odooId: string): boolean {
  return odooId.startsWith(PROVISIONAL_PREFIX);
}

/**
 * A placeholder for the unique `Employee.email` until the joiner's work address
 * is issued (JML S3). `.invalid` is reserved (RFC 2606), so nothing can ever
 * deliver to it, and login provisioning refuses it.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "pre-joiner.invalid";

export function placeholderEmail(): string {
  return `pending-${randomBytes(9).toString("hex")}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`));
}
