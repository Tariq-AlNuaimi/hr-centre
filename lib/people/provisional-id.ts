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
