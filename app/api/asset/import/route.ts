import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withEditorAuth, withRateLimit } from "@/lib/api-helpers";
import { ok, err } from "@/lib/api-response";
import { parseCsvToObjects } from "@/lib/csv";
import { createAssetSchema } from "@/lib/validations/asset";
import type { Prisma } from "@/generated/prisma/client";

const MAX_ROWS = 500; // bounded batch — keeps the audited per-row create loop within budget.

/**
 * Bulk-import assets from CSV (T11). Editor-gated, rate-limited. Validates every row
 * with the same `createAssetSchema` as the single POST, then creates them with per-row
 * `prisma.asset.create` inside ONE `$transaction` — NOT `createMany` (which bypasses the
 * audit + soft-delete extensions, `no-unaudited-bulk-write` / ADR-010). Atomic: any bad
 * row (validation, in-batch duplicate, or existing tag) aborts the whole import with a
 * row-indexed error report; nothing is written unless every row is valid.
 */
export const POST = withRateLimit(
  withEditorAuth(async (request: NextRequest) => {
    const body = await request.json().catch(() => null);
    const csv = body && typeof body.csv === "string" ? body.csv : "";
    const rows = parseCsvToObjects(csv);

    if (rows.length === 0) return err("No data rows found in the CSV.");
    if (rows.length > MAX_ROWS) {
      return err(`Too many rows (${rows.length}); import at most ${MAX_ROWS} at a time.`);
    }

    // Validate every row up-front (fail the whole batch on any error — atomic import).
    // CSV import covers the scalar columns only; custom-field VALUES are not imported here.
    const valid: Prisma.AssetUncheckedCreateInput[] = [];
    const errors: string[] = [];
    rows.forEach((r, i) => {
      const candidate = {
        assetTag: r.assetTag,
        name: r.name,
        serial: r.serial || undefined,
        purchasedAt: r.purchasedAt || undefined,
        status: r.status || "IN_STOCK",
        category: r.category || "LAPTOP",
      };
      const res = createAssetSchema.safeParse(candidate);
      if (!res.success) {
        errors.push(`Row ${i + 2}: ${res.error.issues.map((x) => x.message).join(", ")}`);
      } else {
        const { customFields: _cf, ...scalars } = res.data;
        valid.push(scalars);
      }
    });

    // In-batch duplicate asset tags.
    const seen = new Set<string>();
    for (let i = 0; i < valid.length; i++) {
      const tag = valid[i].assetTag;
      if (seen.has(tag)) errors.push(`Duplicate asset tag in file: ${tag}`);
      seen.add(tag);
    }

    // Tags that already exist in the DB.
    if (seen.size > 0) {
      const existing = await prisma.asset.findMany({
        where: { assetTag: { in: [...seen] } },
        select: { assetTag: true },
        take: MAX_ROWS,
      });
      for (const e of existing) errors.push(`Asset tag already in use: ${e.assetTag}`);
    }

    if (errors.length > 0) return err(errors.join("; "));

    // Per-row audited creates inside one transaction (NOT createMany — ADR-010).
    await prisma.$transaction(valid.map((data) => prisma.asset.create({ data })));

    return ok({ imported: valid.length });
  }),
  { id: "asset-import", limit: 10, windowMs: 60000 },
);
