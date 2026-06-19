import { prisma, prismaUnfiltered } from "@/lib/prisma";
import { ok } from "@/lib/api-response";
import { withInternalAuth, withRateLimit } from "@/lib/api-helpers";
import { env } from "@/lib/env";
import {
  RECYCLABLE_ENTITY_TYPES,
  recyclableAccessor,
  recyclableClient,
  permanentlyDelete,
} from "@/lib/prisma/recyclable";

// Internal endpoint -- audit-log retention (ADR-018).
//
// Two callers, two secrets (both >=32 chars, enforced by lib/env.ts; they MAY
// be set to the same value -- they gate the identical action):
//   - GET:  Vercel Cron (daily, wired in vercel.json). Vercel injects
//           `Authorization: Bearer $CRON_SECRET` and can only send GET, so
//           this route opts into Bearer auth. While CRON_SECRET is unset the
//           cron gets a 200 `{ skipped: true }` -- dormancy is silent, not a
//           daily red invocation in the Vercel dashboard.
//   - POST: manual / GitHub Actions callers with `x-internal-token`
//           matching AUDIT_PURGE_TOKEN. 503 until that var is set.
//
// Daily retention worker. Three bounded jobs run per invocation:
//   1. audit_logs older than AUDIT_RETENTION_DAYS (default 365),
//   2. expired password-reset tokens (verification_tokens past `expires`),
//   3. recycling-bin GC: records soft-deleted past RECYCLE_BIN_RETENTION_DAYS
//      (default 90) are permanently deleted, each with an explicit DELETE audit
//      row (SR-H1) so soft-deleted PII does not linger in the bin forever.
//
// Deletes audit_logs rows older than AUDIT_RETENTION_DAYS (default 365) in
// capped batches: the first activation on a long-lived fork may face a huge
// backlog, and a single unbounded DELETE could exceed the function duration,
// roll back, and retry the same oversized delete every day forever. Batches
// commit incrementally, so partial progress survives a timeout and the next
// run finishes the job. AuditLog is in the audit-extension's EXCLUDE set, so
// deletes here do not recursively write more audit rows.

export const maxDuration = 60;

const BATCH_SIZE = 10_000;

// Recycling-bin GC (SR-H1): permanently remove rows soft-deleted longer ago than
// RECYCLE_BIN_RETENTION_DAYS. Bounded so a huge backlog can't exceed the function
// duration -- RECYCLE_GC_BATCH per query, RECYCLE_GC_MAX per run (the remainder
// waits for the next daily run, like the audit_logs purge above).
const RECYCLE_GC_BATCH = 500;
const RECYCLE_GC_MAX = 5_000;

async function purgeRecycleBin() {
  const retentionDays = env.RECYCLE_BIN_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const recyclable = recyclableClient(prismaUnfiltered);

  let purged = 0;
  for (const entityType of Object.keys(RECYCLABLE_ENTITY_TYPES)) {
    const accessor = recyclableAccessor(entityType);
    if (!accessor) continue;

    while (purged < RECYCLE_GC_MAX) {
      // Never fetch more than the per-run budget still allows, so the cap holds
      // exactly (no overshoot by up to a batch on the final iteration).
      const take = Math.min(RECYCLE_GC_BATCH, RECYCLE_GC_MAX - purged);
      const batch = await recyclable[accessor].findMany({
        where: { deletedAt: { not: null, lt: cutoff } },
        take,
      });
      if (batch.length === 0) break;

      for (const record of batch) {
        // Hard-delete + explicit DELETE audit row (cron => null attribution).
        // permanentlyDelete owns the "audited hard delete" invariant, shared
        // with the manual permanent-delete route. Sequential by design: a
        // daily off-peak GC must not exhaust the Prisma connection pool.
        await permanentlyDelete(prismaUnfiltered, accessor, entityType, record);
        purged += 1;
      }

      if (batch.length < take) break;
    }
  }
  return { purged, retentionDays, cutoff: cutoff.toISOString() };
}

async function purge() {
  // Use the zod-validated env (coerced + defaulted) -- not a raw parse, which
  // would yield NaN -> Invalid Date on a malformed value.
  const retentionDays = env.AUDIT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  let purged = 0;
  for (;;) {
    // Parameterized ($executeRaw tagged template); raw because Prisma's
    // deleteMany cannot cap the number of rows a single statement touches.
    const deleted = await prisma.$executeRaw`
      DELETE FROM audit_logs
      WHERE id IN (
        SELECT id FROM audit_logs WHERE timestamp < ${cutoff} LIMIT ${BATCH_SIZE}
      )`;
    purged += deleted;
    if (deleted < BATCH_SIZE) break;
  }

  // Garbage-collect expired password-reset tokens. They are only deleted when a
  // reset completes for that identifier, so unused/expired tokens would
  // otherwise accumulate in verification_tokens forever. Piggybacking on the
  // daily retention cron keeps the table bounded with no new schedule.
  // prismaUnfiltered: VerificationToken is in the soft-delete EXCLUDE set, and
  // this hard-delete of already-expired rows wants no filtering.
  const tokensPurged = await prismaUnfiltered.verificationToken.deleteMany({
    where: { expires: { lt: new Date() } },
  });

  // Recycling-bin GC: permanently delete records soft-deleted past their
  // retention window (RECYCLE_BIN_RETENTION_DAYS) so deleted PII does not linger
  // in the bin forever. Piggybacks on the same daily cron (no new schedule).
  const recycle = await purgeRecycleBin();

  return ok({
    purged,
    expiredTokensPurged: tokensPurged.count,
    cutoff: cutoff.toISOString(),
    retentionDays,
    recycleBinPurged: recycle.purged,
    recycleBinRetentionDays: recycle.retentionDays,
    recycleBinCutoff: recycle.cutoff,
  });
}

export const GET = withRateLimit(
  withInternalAuth("CRON_SECRET", purge, { bearer: true, skipWhenUnconfigured: true }),
  { id: "audit-purge", limit: 5, windowMs: 60_000 }
);
export const POST = withRateLimit(
  withInternalAuth("AUDIT_PURGE_TOKEN", purge),
  { id: "audit-purge", limit: 5, windowMs: 60_000 }
);
