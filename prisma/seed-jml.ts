import type { PrismaClient } from "../generated/prisma/client";
import {
  EXIT_REASON_LEVEL_1,
  EXIT_REASON_TAXONOMY,
  LEVEL_1_LABELS,
  STATUTORY_SEED,
} from "./seed-jml-data";
import {
  STARTER_JOIN_TEMPLATE,
  STARTER_MOVE_TEMPLATES,
  seedTemplateOnce,
  addStarterItConditions,
} from "./seed-jml-templates";
import { seedJmlDocuments } from "./seed-jml-documents";
import { seedJmlLeave } from "./seed-jml-leave";

/**
 * The JML module's production seed (docs/blueprints/jml.md, PROTOCOL: real
 * configuration only, idempotent, never people or cases). Called from
 * prisma/seed.ts on every production build. Uses the RAW client with
 * find-then-create (never `upsert`, which would trip no-unaudited-bulk-write),
 * and NEVER overwrites a row an administrator may have edited or verified.
 */
export async function seedJml(prisma: PrismaClient): Promise<void> {
  await seedStatutoryParameters(prisma);
  await seedReasonTaxonomy(prisma);
  await seedTemplateOnce(prisma, STARTER_JOIN_TEMPLATE);
  await addStarterItConditions(prisma);
  for (const tpl of STARTER_MOVE_TEMPLATES) await seedTemplateOnce(prisma, tpl);
  await seedJmlLeave(prisma);
  await seedJmlDocuments(prisma);
}

async function seedStatutoryParameters(prisma: PrismaClient): Promise<void> {
  for (const p of STATUTORY_SEED) {
    const existing = await prisma.statutoryParameter.findUnique({
      where: { key_effectiveFrom: { key: p.key, effectiveFrom: p.effectiveFrom } },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.statutoryParameter.create({
      data: {
        key: p.key,
        value: p.value,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
        verified: false,
        note: p.note,
      },
      select: { id: true },
    });
  }
}

async function seedReasonTaxonomy(prisma: PrismaClient): Promise<void> {
  for (const [i, level1] of EXIT_REASON_LEVEL_1.entries()) {
    const found = await prisma.jmlExitReasonCategory.findUnique({
      where: { level1 },
      select: { id: true },
    });
    const categoryId =
      found?.id ??
      (
        await prisma.jmlExitReasonCategory.create({
          data: { level1, label: LEVEL_1_LABELS[level1], sortOrder: (i + 1) * 10 },
          select: { id: true },
        })
      ).id;
    for (const [j, code] of EXIT_REASON_TAXONOMY[level1].entries()) {
      const exists = await prisma.jmlExitReasonCode.findUnique({
        where: { code: code.code },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.jmlExitReasonCode.create({
        data: { categoryId, code: code.code, label: code.label, sortOrder: (j + 1) * 10 },
        select: { id: true },
      });
    }
  }
}
