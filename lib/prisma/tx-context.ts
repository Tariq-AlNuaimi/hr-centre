import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The active transaction client, published so the audit extensions can write
 * their row on it — ADR-068.
 *
 * ## The problem this closes
 *
 * A Prisma query extension is built by `defineExtension((client) => …)` and
 * closes over that OUTER client. Inside `prisma.$transaction(async (tx) => …)`
 * the write runs on `tx`, but the extension's `auditLog.create` runs on the
 * captured client — a different connection, a different transaction. So the two
 * commit independently, and **a rolled-back transaction leaves its audit row
 * behind**: the trail asserts a change that never happened.
 *
 * Measured, not assumed. A deliberately rolled-back transaction containing one
 * `employee.update` left the employee row untouched and one audit row saying it
 * had changed. ADR-068 carries the transcript.
 *
 * A false positive is not the lesser failure here. §12.2's trail is read to
 * answer "who changed this person's record", and a fabricated entry is worse
 * than a missing one, because someone will act on it.
 *
 * ## The worse instance, found while fixing the first
 *
 * The soft-delete extension resolves its MODEL DELEGATE from the same captured
 * client — `client[model]` — and then runs `findUnique` + `update` on it. So a
 * soft delete inside a transaction wrote its **data** outside the transaction
 * too. Measured the same way: `tx.user.delete(...)` inside a deliberately
 * rolled-back transaction left `deletedAt` SET on a row the rollback was
 * supposed to restore. That is data loss surviving a rollback, not merely a
 * misleading log line.
 *
 * It is latent at the time of writing — no route soft-deletes inside a
 * transaction, because the only two in-transaction deletes target `Assignment`
 * and `ProjectMember`, neither of which is in `SOFT_DELETE_MODELS`. `Kpi`,
 * `Employee`, `Department`, `OrgEntity` and `User` all are, and the day someone
 * writes `tx.kpi.delete(...)` the trap closes silently. `currentClient` below is
 * what both extensions now resolve through.
 *
 * ## Why an AsyncLocalStorage
 *
 * A query extension has no access to the `tx` handle — it is not in `args`, not
 * on `this`, and Prisma exposes no accessor for it. The repo already solves the
 * same shape of problem the same way: `lib/audit-context.ts` propagates the
 * ACTOR through an `AsyncLocalStorage` because an extension cannot be handed
 * request state either, and the extension already reads it. This is one more
 * store beside that one, not a new idea.
 *
 * ## Why the store is module-private
 *
 * Same reason `auditStorage` is: a caller holding the raw store could `.run()`
 * an arbitrary client into the audit path — including one pointed at a
 * transaction that is not the one doing the write. `runInAuditTx` is the only
 * writer and `currentAuditWriter` the only reader.
 *
 * ## Why this file does not import `prisma`
 *
 * `lib/prisma.ts` composes the extensions, and the extensions read this store —
 * so importing the client here would close the cycle
 * `lib/prisma.ts → audit-extension → tx-context → lib/prisma.ts`. ESM tolerates
 * it by hoisting, which is precisely the kind of tolerance that turns into an
 * `undefined` at module-eval time after an unrelated import is reordered. The
 * store has no need of the client; `auditedTransaction`, which does, lives in
 * `lib/prisma.ts` where the client already is.
 */

/**
 * Anything that can write an audit row. Structurally satisfied by the extended
 * client and by a transaction handle alike — which is the whole point, since
 * this exists to swap one for the other.
 */
export type AuditWriter = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auditLog: { create: (args: any) => Promise<unknown> };
};

// The store holds the whole transaction client, not just its `auditLog`
// delegate: the soft-delete extension needs a MODEL delegate off the same
// handle (see `currentClient` below), and narrowing the stored value to one
// accessor would have made that impossible without a second store holding the
// same object.
const txStorage = new AsyncLocalStorage<unknown>();

/**
 * Run `fn` with `tx` published as the active client for its async scope.
 *
 * Not exported to routes: `auditedTransaction` in `lib/prisma.ts` is the only
 * caller, so the store cannot be pointed at a client that is not the one
 * actually doing the writes.
 */
export function runInAuditTx<T>(tx: unknown, fn: () => Promise<T>): Promise<T> {
  return txStorage.run(tx, fn);
}

/**
 * The transaction client for the caller's async scope, or `fallback` when there
 * is no transaction — which is the ordinary case, and the one where using the
 * captured client has always been correct.
 *
 * The cast is safe by construction: `runInAuditTx` is private to this module and
 * `auditedTransaction` is its only caller, so the store only ever holds a Prisma
 * transaction client, which is structurally a client.
 */
export function currentClient<T>(fallback: T): T {
  return (txStorage.getStore() as T | undefined) ?? fallback;
}

/** `currentClient`, typed for the audit extensions' one use of it. */
export function currentAuditWriter(fallback: AuditWriter): AuditWriter {
  return currentClient(fallback);
}
