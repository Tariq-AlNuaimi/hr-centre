/**
 * Is this employee ID a placeholder rather than a real Odoo ID? Pre-joiners
 * get `PENDING-<random>` until HR records the real one (lib/people/provisional-id.ts),
 * and the first-run admin is `BOOTSTRAP-ADMIN`. Screens show a "Pending ID"
 * chip instead of the raw string (UX review R11). Pure — safe in client code.
 */
export function isPendingEmployeeId(odooId: string): boolean {
  return odooId.startsWith("PENDING-") || odooId === "BOOTSTRAP-ADMIN";
}
