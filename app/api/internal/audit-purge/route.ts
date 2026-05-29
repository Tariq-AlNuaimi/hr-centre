import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok } from "@/lib/api-response";
import { withInternalAuth } from "@/lib/api-helpers";

// Internal endpoint -- DORMANT. Nothing calls it on a schedule. The monthly
// audit-retention workflow was removed in ADR-006 and the template ships no cron.
// Audit-log retention is the IT team's responsibility post-handoff: wire a Vercel
// Cron or a Neon retention policy to POST here if the project will live long-term.
// Header: x-internal-token must match the AUDIT_PURGE_TOKEN env var.
// Returns 503 if AUDIT_PURGE_TOKEN is unset (template ships without it configured).
//
// Deletes audit_logs rows older than AUDIT_RETENTION_DAYS (default 365).
// AuditLog is in the audit-extension's EXCLUDE set, so deletes here do not
// recursively write more audit rows.

export const POST = withInternalAuth("AUDIT_PURGE_TOKEN", async (_req: NextRequest) => {
  const retentionDays = Number(process.env.AUDIT_RETENTION_DAYS ?? "365");
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (prisma as any).auditLog.deleteMany({
    where: { timestamp: { lt: cutoff } },
  });

  return ok({
    purged: result.count as number,
    cutoff: cutoff.toISOString(),
    retentionDays,
  });
});
