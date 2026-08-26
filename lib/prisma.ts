import { Prisma } from "@/generated/prisma/client";
import { createBaseClient } from "./prisma/client";
import { softDeleteExtension } from "./prisma/soft-delete-extension";
import { auditExtension } from "./prisma/audit-extension";
import { runInAuditTx } from "./prisma/tx-context";

const globalForPrisma = globalThis as unknown as {
  prismaBase: ReturnType<typeof createBaseClient> | undefined;
};

// ONE base client -> one pg pool per process. `$extends` returns a facade over
// the same engine/pool, so `prisma` and `prismaUnfiltered` share connections
// instead of each opening their own pool (halves connections against Neon and
// cold-start instantiation on serverless). Extensions apply only to the
// `prisma` facade -- `prismaUnfiltered` stays raw by construction.
const base = globalForPrisma.prismaBase ?? createBaseClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = base;
}

/**
 * Main Prisma client with soft-delete filtering and audit trail.
 * Use this for all normal application queries.
 *
 * The soft-delete extension is the outermost hook for `delete`/`deleteMany`
 * and rewrites them to `update` on the base client, so the audit extension
 * never sees soft deletes -- the soft-delete extension records those audit
 * rows itself (see soft-delete-extension.ts). create/update flow through the
 * audit extension normally.
 */
export const prisma = base.$extends(softDeleteExtension).$extends(auditExtension);

/**
 * Unfiltered Prisma client without soft-delete filtering.
 * Use this for the recycling bin, admin queries, and Auth.js adapter.
 */
export const prismaUnfiltered = base;

/**
 * `prisma.$transaction`, with the transaction client published so the audit
 * extensions write their row ON IT — ADR-068. **Use this for every interactive
 * transaction**; `rihal-template/no-bare-prisma-transaction` refuses the bare
 * form.
 *
 * Without it, the extension's `auditLog.create` runs on the client captured in
 * `defineExtension` rather than on `tx`, so the write and its audit row commit
 * independently and a rolled-back transaction leaves a row asserting a change
 * that never happened. The reasoning, and the measurement, are in
 * `lib/prisma/tx-context.ts`.
 *
 * The callback still receives `tx` and must still use it for its writes: this
 * changes where the AUDIT row goes, not where the data goes. `tx` is passed
 * explicitly rather than read from the store so the data path stays visible at
 * the call site, which is where a reader looks for it.
 *
 * It lives here rather than in `lib/prisma/tx-context.ts` because it needs the
 * composed client, and importing that into the store's module would close an
 * import cycle back through the extensions.
 */
export function auditedTransaction<T>(
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  },
): Promise<T> {
  // eslint-disable-next-line rihal-template/no-bare-prisma-transaction -- THIS is the wrapper the rule points everyone at; it is the one place the bare call is correct.
  return prisma.$transaction(
    // `tx` is an extended client, so `tx.auditLog.create` re-enters the query
    // hooks — harmless, because `AuditLog` is in the extension's EXCLUDE set and
    // an audit row is never itself audited.
    (tx) => runInAuditTx(tx, () => fn(tx)),
    options,
  );
}
