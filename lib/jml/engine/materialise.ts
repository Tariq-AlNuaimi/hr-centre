import type { Prisma } from "@/generated/prisma/client";
import type { auditedTransaction } from "@/lib/prisma";
import { resolveTaskOwner, type RoutingContext } from "../routing/rules";
import type { GeneratedTask } from "./generate";

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

/**
 * Write a generated task set onto a case, in the caller's transaction — one
 * audited `create` per task (a bulk insert would bypass the audit extension,
 * ADR-010). Every type's activation lands here. Each task's owner comes from
 * its assignee role (docs/blueprints/jml-task-routing.md): HR owner, the
 * line manager, or the desk as a group (owner null) — with the HR fallback.
 */
export async function materialiseTasks(
  tx: Tx,
  caseId: string,
  tasks: readonly GeneratedTask[],
  routing: RoutingContext,
): Promise<number> {
  for (const t of tasks) {
    await tx.jmlTask.create({
      data: {
        caseId,
        code: t.code,
        name: t.name,
        stage: t.stage,
        sortOrder: t.sortOrder,
        source: "TEMPLATE",
        status: "NOT_STARTED",
        dateBasis: t.dateBasis,
        offsetDays: t.offsetDays,
        offsetUnit: t.offsetUnit,
        dueDate: t.dueDate,
        ownerUserId: resolveTaskOwner(t.assigneeRole, routing),
        assigneeRole: t.assigneeRole,
        mandatory: t.mandatory,
        blocking: t.blocking,
        confirmationRequired: t.confirmationRequired,
        confirmingParty: t.confirmingParty,
        reversalFlag: t.reversalFlag,
        dependsOnCodes: t.dependsOnCodes,
        statutory: t.statutory,
        complianceCategory: t.complianceCategory,
        complianceDeadline: t.complianceDeadline,
        conditionSource: (t.conditionSource ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: { id: true },
    });
  }
  return tasks.length;
}
