import { auditedTransaction, prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/prisma/audit-extension";
import { loadCaseFor, type JmlActor } from "../access";
import { refreshCase } from "../engine/tasks";
import { JmlError } from "../errors";
import { SETTLED_TASK_STATUSES } from "../vocab";
import { activateLeave, wouldGenerate } from "./activation";
import { loadLeaveRow } from "./leave-data";
import {
  dispositionProblems,
  dueBeforeToday,
  rekeyEligibility,
  type Disposition,
} from "./rekey-rules";

/**
 * Re-key a back-dated exit (Offboarding `rekey.ts`): GET plans (the tasks that
 * fell due before today), POST activates the draft and records each answer —
 * completed on its real date, not applicable with a reason, or still
 * outstanding (it stays open and shows in the overdue digest). Unanswered or
 * unexpected codes are refused; a draft stays a draft until the answers fit.
 */

export async function rekeyPlan(actor: JmlActor, caseId: string, now = new Date()) {
  const kase = await loadCaseFor(actor, caseId, "jml.view", "LEAVE");
  const row = await loadLeaveRow(caseId);
  const problems = kase.status === "DRAFT" ? rekeyEligibility(row.leaveDetail, now) : [];
  const tasks =
    kase.status === "DRAFT"
      ? await wouldGenerate(row)
      : await prisma.jmlTask.findMany({
          where: { caseId, status: { notIn: [...SETTLED_TASK_STATUSES] } },
          select: { code: true, name: true, dueDate: true },
          take: 1000,
        });
  const due = new Set(dueBeforeToday(tasks, now));
  return {
    eligible:
      problems.length === 0 && (kase.status === "DRAFT" || Boolean(row.leaveDetail.rekeyedAt)),
    problems,
    tasks: tasks
      .filter((t) => due.has(t.code))
      .map((t) => ({ code: t.code, name: t.name, dueDate: t.dueDate })),
  };
}

export async function applyRekey(
  actor: JmlActor,
  caseId: string,
  input: { reason: string; dispositions: Disposition[] },
  now = new Date(),
) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageLeavers", "LEAVE");
  const row = await loadLeaveRow(caseId);
  if (kase.status !== "DRAFT" && !row.leaveDetail.rekeyedAt) {
    throw new JmlError("Only a draft exit (or one already being re-keyed) can be re-keyed.", 409);
  }
  if (kase.status === "DRAFT") {
    const problems = rekeyEligibility(row.leaveDetail, now);
    if (problems.length) throw new JmlError(problems.join(" "), 422);
    const plan = dueBeforeToday(await wouldGenerate(row), now);
    const answerProblems = dispositionProblems(plan, input.dispositions, {
      noticeStartDate: row.leaveDetail.noticeStartDate,
      now,
    });
    if (answerProblems.length) throw new JmlError(answerProblems.join(" "), 409);
    await activateLeave(actor, caseId);
  }
  const open = await prisma.jmlTask.findMany({
    where: { caseId, status: { notIn: [...SETTLED_TASK_STATUSES] } },
    select: { id: true, code: true, dueDate: true },
    take: 1000,
  });
  const plan = dueBeforeToday(open, now);
  const problems = dispositionProblems(
    plan,
    input.dispositions.filter((d) => plan.includes(d.code)),
    {
      noticeStartDate: row.leaveDetail.noticeStartDate,
      now,
    },
  );
  if (problems.length) throw new JmlError(problems.join(" "), 409);
  const idByCode = new Map(open.map((t) => [t.code, t.id]));
  const backdatedDays = Math.round(
    (now.getTime() - row.leaveDetail.noticeStartDate.getTime()) / 86_400_000,
  );
  let answered = 0;
  let outstanding = 0;
  await auditedTransaction(
    async (tx) => {
      for (const d of input.dispositions) {
        const id = idByCode.get(d.code);
        if (!id) continue;
        if (d.outcome === "STILL_OUTSTANDING") {
          outstanding += 1;
          continue;
        }
        answered += 1;
        await tx.jmlTask.update({
          where: { id },
          data:
            d.outcome === "COMPLETED"
              ? {
                  status: "COMPLETED",
                  completedAt: d.completedAt,
                  completedById: actor.userId,
                  version: { increment: 1 },
                }
              : {
                  status: "NOT_APPLICABLE",
                  notApplicableReason: d.reason,
                  version: { increment: 1 },
                },
          select: { id: true },
        });
      }
      await tx.jmlExitDetail.update({
        where: { caseId },
        data: { rekeyedAt: row.leaveDetail.rekeyedAt ?? now, rekeyReason: input.reason },
        select: { caseId: true },
      });
      await refreshCase(tx, caseId, actor.userId);
      await recordAudit(tx, {
        entityType: "JmlCase",
        entityId: caseId,
        action: "UPDATE",
        after: {
          rekey: true,
          backdatedDays,
          retrospectivelyAnswered: answered,
          stillOutstanding: outstanding,
        },
      });
    },
    { timeout: 20_000 },
  );
  return { rekeyed: true, answered, stillOutstanding: outstanding };
}
