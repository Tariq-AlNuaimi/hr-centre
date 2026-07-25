import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { bulkDeleteAssetSchema } from "@/lib/validations/asset";

/**
 * Bulk-delete assets from the list's multi-select (T-app-floor bulk actions).
 * Editor-gated, rate-limited, zod-validated at the boundary.
 *
 * AUDIT INVARIANT (ADR-010 / `no-unaudited-bulk-write`): deletes run as per-row
 * `prisma.asset.delete` inside ONE `$transaction` — deliberately NOT `deleteMany`, which
 * would bypass BOTH the soft-delete extension (rows would be hard-deleted, skipping the
 * recycling bin) and the audit extension (no DELETE audit_logs row per asset). Same shape
 * the CSV import uses for creates. Atomic: any failing row rolls the whole batch back.
 */
// Bounded batch — keeps the audited per-row loop within request budget. The BOUND ITSELF is
// enforced by `bulkDeleteAssetSchema` (max 100) at the zod boundary, so an oversized payload is
// rejected before any DB work; this constant only caps the follow-up read.
const MAX_IDS = 100;

export const POST = withRateLimit(
  withEditorAuth(async (request: NextRequest) => {
    const body = await request.json().catch(() => null);
    const parsed = bulkDeleteAssetSchema.safeParse(body);
    if (!parsed.success) {
      return err(parsed.error.issues.map((i) => i.message).join(", "));
    }

    // De-duplicate so a repeated id can't make the count lie or double-delete.
    const ids = [...new Set(parsed.data.ids)];

    // Only delete rows that actually exist (and aren't already soft-deleted — the extension
    // filters those out of `findMany`), so the reported count is honest.
    const existing = await prisma.asset.findMany({
      where: { id: { in: ids } },
      select: { id: true },
      take: MAX_IDS,
    });
    if (existing.length === 0) return err("No matching assets found.");

    // Per-row audited deletes inside one transaction (NOT deleteMany — ADR-010).
    await prisma.$transaction(existing.map((a) => prisma.asset.delete({ where: { id: a.id } })));

    return ok({ deleted: existing.length });
  }),
  { id: "asset-write", limit: 30, windowMs: 60000 },
);
