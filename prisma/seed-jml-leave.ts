import type { PrismaClient } from "../generated/prisma/client";
import {
  ASSET_TYPES,
  LEAVE_ACCESS_CHECKLIST,
  LEAVE_TASKS,
  type LeaveSeedTask,
} from "./seed-jml-leave-data";
import { seededAssigneeRole } from "./seed-jml-routing";

/**
 * Leaver configuration (port spec §5.1) — find-then-create, never overwriting a
 * row HR may have edited: the FULL (50) and LIGHT (47) offboarding templates,
 * the 26 access checklist items and the default asset types.
 */

const TEMPLATES: Array<{ name: string; scope: "FULL" | "LIGHT"; tasks: LeaveSeedTask[] }> = [
  { name: "Baseline offboarding — Full", scope: "FULL", tasks: LEAVE_TASKS },
  {
    name: "Baseline offboarding — Light",
    scope: "LIGHT",
    tasks: LEAVE_TASKS.filter((t) => !t.fullOnly),
  },
];

async function seedLeaveTemplates(prisma: PrismaClient) {
  for (const tpl of TEMPLATES) {
    const exists = await prisma.jmlTaskTemplate.findFirst({
      where: { name: tpl.name },
      select: { id: true },
    });
    if (exists) continue;
    const created = await prisma.jmlTaskTemplate.create({
      data: {
        name: tpl.name,
        version: 1,
        active: true,
        caseType: "LEAVE",
        criteria: {},
        employmentScope: tpl.scope,
        nationalityScope: "ANY",
      },
      select: { id: true },
    });
    for (const [i, t] of tpl.tasks.entries()) {
      await prisma.jmlTemplateTask.create({
        data: {
          templateId: created.id,
          code: t.code,
          name: t.name,
          stage: t.stage,
          sortOrder: i,
          dateBasis: t.dateBasis,
          offsetDays: t.offsetDays,
          offsetUnit: "WORKING_DAYS",
          mandatory: t.mandatory ?? true,
          blocking: t.blocking ?? false,
          confirmationRequired: t.confirmationRequired ?? false,
          defaultConfirmingParty: t.defaultConfirmingParty ?? null,
          reversalFlag: t.reversalFlag ?? false,
          dependsOnCodes: t.dependsOnCodes ?? [],
          appliesToExitTypes: t.appliesToExitTypes ?? [],
          appliesToNationality: t.appliesToNationality ?? "ANY",
          appliesToSettlement: t.appliesToSettlement ?? null,
          conditions: {},
          assigneeRole: seededAssigneeRole(tpl.name, t.code),
        },
        select: { id: true },
      });
    }
  }
}

async function seedAccessChecklist(prisma: PrismaClient) {
  for (const [i, item] of LEAVE_ACCESS_CHECKLIST.entries()) {
    const exists = await prisma.jmlAccessChecklistItem.findUnique({
      where: { domain_label: { domain: item.domain, label: item.label } },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.jmlAccessChecklistItem.create({
      data: { ...item, sortOrder: (i + 1) * 10 },
      select: { id: true },
    });
  }
}

async function seedAssetTypes(prisma: PrismaClient) {
  for (const [i, label] of ASSET_TYPES.entries()) {
    const exists = await prisma.jmlAssetType.findUnique({ where: { label }, select: { id: true } });
    if (exists) continue;
    await prisma.jmlAssetType.create({
      data: { label, sortOrder: (i + 1) * 10 },
      select: { id: true },
    });
  }
}

export async function seedJmlLeave(prisma: PrismaClient): Promise<void> {
  await seedLeaveTemplates(prisma);
  await seedAccessChecklist(prisma);
  await seedAssetTypes(prisma);
}
