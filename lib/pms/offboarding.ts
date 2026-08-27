import type { auditedTransaction } from "@/lib/prisma";

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

/**
 * Off-boarding revokes access — ADR-069 amendment, operator decision 2026-08-26.
 *
 * §12.1 says a departure preserves the employee's RECORD and history. It says
 * nothing about their login, and the build originally read that silence as "leave
 * the account alone": the import refuses to CREATE a login for a leaver, but an
 * account that already existed survived the departure untouched. So a person who
 * left on Friday could sign in on Monday, see their own scorecard, and answer a
 * 360 they had been assigned — until somebody at `/users` remembered.
 *
 * The operator closed it: setting an employee to LEAVER now soft-deletes the
 * linked `User`. Access follows employment; the record does not.
 *
 * ## Why a soft delete is the right instrument here
 *
 * Both sign-in paths already refuse a soft-deleted account, and neither had to be
 * changed for this: `authorize()` looks up `deletedAt: null`, and `lib/auth.ts`'s
 * `signIn` callback refuses a federated identity whose user row is soft-deleted —
 * a guard kept deliberately for the day a provider returned. This decision is what
 * makes that guard load-bearing.
 *
 * It is also reversible by a person. `/recycling-bin` restores a `User`, so an
 * employee off-boarded by mistake — or one who returns — is a restore rather than
 * a re-creation, which keeps their `Account` linkage and their audit history
 * attached to the same id.
 *
 * ## What it deliberately does NOT do
 *
 *  - **It does not touch the employee row.** §12.1 is explicit that the record and
 *    the history are preserved, and `lib/prisma/recyclable.ts` excludes Employee
 *    from the bin for exactly that reason.
 *  - **It does not unlink `Employee.userId`.** The link is how the restored
 *    account finds its way back, and how the audit trail stays legible. A revoked
 *    account is a soft-deleted `User`, not an orphaned employee.
 *  - **It does not fire for an employee who has no login.** Most of the fixture is
 *    in that state today, and a no-op must stay a no-op rather than an error.
 *
 * Returns the revoked user's id, or null when there was nothing to revoke — so a
 * caller can say what happened rather than assuming.
 */
export async function revokeLoginOnOffboard(tx: Tx, employeeId: string): Promise<string | null> {
  // UNFILTERED via the relation rather than a second query: reading the employee
  // gives the link and costs one statement inside a transaction that is already
  // the longest write in the product.
  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true },
  });
  if (!employee?.userId) return null;

  // Already revoked? Ask explicitly, because `delete` is NOT idempotent here.
  //
  // The soft-delete extension rewrites `delete` into an `update` on the BASE
  // client (ADR-068 made it resolve the delegate off the active transaction), and
  // the base client carries no read filter — so deleting an already-deleted row
  // succeeds, re-stamps `deletedAt` to now, and emits a SECOND `DELETE` audit
  // row. The revocation date would then move every time a weekly re-import saw
  // last year's leaver still in the sheet, and §12.2's trail would say the
  // account was revoked on a date nobody revoked it.
  //
  // Naming `deletedAt` in the `where` is what suppresses the extension's
  // injected `deletedAt: null` on the read — the same mechanism the import's
  // existing-email lookup uses.
  const alreadyRevoked = await tx.user.findFirst({
    where: { id: employee.userId, deletedAt: { not: null } },
    select: { id: true },
  });
  if (alreadyRevoked) return null;

  // `delete` on the audited client is REWRITTEN to a soft delete by the
  // extension (`SOFT_DELETE_MODELS` carries `User`), so this sets `deletedAt`
  // AND `deletedBy` and emits the audit row. Calling `update` with a hand-set
  // `deletedAt` would skip `deletedBy` and record the wrong action verb.
  await tx.user.delete({ where: { id: employee.userId } });
  return employee.userId;
}
