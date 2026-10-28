import { auditedTransaction, prisma } from "@/lib/prisma";
import { addWorkingDays, type WorkingCalendar } from "@/lib/working-time/calendar";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { loadCaseFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { resolveHrAssignment } from "../engine/assignment";
import { generateTasks } from "../engine/generate";
import { materialiseTasks } from "../engine/materialise";
import { notifyRoutedTasks, routingContextFor } from "../routing/assign";
import { selectLeaveTemplate, templateTaskDefs } from "../engine/templates";
import { leaveActivationProblems } from "./activation-gate";
import { refreshSnapshots } from "./draft";
import {
  leaveAnchors,
  loadLeaveRow,
  revocationAnchor,
  type LeaveDetail,
  type LeaveRow,
} from "./leave-data";
import { noticeToOwners } from "./notices";
import { describeRefusal } from "./rules";

/**
 * Activate an exit case — HR Offboarding `activateCase`. One transaction: owner
 * from the rule (the employee's current placement), the FULL/LIGHT template
 * (nationality scope honoured — F11), tasks on the working calendar, one REVOKE
 * access item per active checklist row (due the LPWD — the notice start for a
 * summary dismissal), and the employee's outstanding assets attached to this
 * case for return. Owners get CASE_ACTIVATED (F3).
 */

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

async function candidate(row: LeaveRow & { leaveDetail: LeaveDetail }) {
  const approvals = await prisma.jmlApproval.findMany({
    where: { caseId: row.id, approvalType: "TERMINATION_AUTHORISATION" },
    select: { approvalType: true, holderRoleKey: true, status: true },
    take: 20,
  });
  return { ...row.leaveDetail, status: row.status, approvals };
}

function placementOf(row: LeaveRow) {
  return {
    entityId: row.employee.entityId,
    directorateId: row.employee.department?.directorateId ?? null,
    departmentId: row.employee.departmentId,
  };
}

/** Every blocker at once, for the activation panel. */
export async function previewLeaveActivation(actor: JmlActor, caseId: string) {
  await loadCaseFor(actor, caseId, "jml.view", "LEAVE");
  const row = await loadLeaveRow(caseId);
  const problems = leaveActivationProblems(await candidate(row)).map((p) => p.message);
  if (!(await resolveHrAssignment(placementOf(row), "LEAVE"))) {
    problems.push("No HR assignment rule covers this employee's position.");
  }
  const d = row.leaveDetail;
  if (!(await selectLeaveTemplate(d.employmentTypeAtExit, d.nationality))) {
    problems.push("No active leaver checklist template matches this exit.");
  }
  return { ready: problems.length === 0, blockers: problems };
}

async function accessItems(tx: Tx, caseId: string, employeeId: string, due: Date) {
  const checklist = await tx.jmlAccessChecklistItem.findMany({
    where: { active: true },
    orderBy: [{ domain: "asc" }, { sortOrder: "asc" }],
    take: 200,
  });
  for (const item of checklist) {
    await tx.jmlAccessItem.create({
      data: {
        caseId,
        employeeId,
        direction: "REVOKE",
        domain: item.domain,
        systemName: item.label,
        sharedCredential: item.sharedCredential,
        rotationRequired: item.rotationRequired || item.sharedCredential,
        dueDate: due,
      },
      select: { id: true },
    });
  }
  return checklist.length;
}

async function attachAssets(tx: Tx, caseId: string, employeeId: string, due: Date) {
  const open = await tx.jmlAsset.findMany({
    where: { employeeId, returnedDate: null, writtenOff: false },
    select: { id: true, returnDueDate: true },
    take: 200,
  });
  for (const a of open) {
    await tx.jmlAsset.update({
      where: { id: a.id },
      data: { returnedOnCaseId: caseId, returnDueDate: a.returnDueDate ?? due },
      select: { id: true },
    });
  }
  return open.length;
}

function generate(
  d: LeaveDetail,
  defs: Awaited<ReturnType<typeof templateTaskDefs>>,
  calendar: WorkingCalendar,
) {
  return generateTasks(
    defs,
    {
      caseType: "LEAVE",
      leave: {
        exitType: d.exitType,
        nationality: d.nationality,
        settlementApplicable: d.settlementApplicable,
      },
      anchors: leaveAnchors(d),
    },
    calendar,
  );
}

/** The tasks activation WOULD generate, without writing (the re-key plan reads it). */
export async function wouldGenerate(row: LeaveRow & { leaveDetail: LeaveDetail }) {
  const d = row.leaveDetail;
  const template = await selectLeaveTemplate(d.employmentTypeAtExit, d.nationality);
  if (!template) return [];
  return generate(d, await templateTaskDefs(template.id), await loadWorkingCalendar());
}

export async function activateLeave(actor: JmlActor, caseId: string) {
  await loadCaseFor(actor, caseId, "jml.manageLeavers", "LEAVE");
  const row = await loadLeaveRow(caseId);
  const problems = leaveActivationProblems(await candidate(row));
  if (problems.length > 0) throw new JmlError(describeRefusal(problems), 422);
  const owner = await resolveHrAssignment(placementOf(row), "LEAVE");
  if (!owner) {
    throw new JmlError(
      "No HR assignment rule covers this employee's position, so the HR owner cannot be derived (BR-OFF-002). Add one in JML settings.",
      409,
    );
  }
  const d = row.leaveDetail;
  const template = await selectLeaveTemplate(d.employmentTypeAtExit, d.nationality);
  if (!template) throw new JmlError("No active leaver checklist template matches this exit.", 409);
  const calendar = await loadWorkingCalendar();
  const tasks = generate(d, await templateTaskDefs(template.id), calendar);
  const due = addWorkingDays(revocationAnchor(d)!, 0, calendar);
  const result = await auditedTransaction(
    async (tx) => {
      await refreshSnapshots(tx, caseId, row.employeeId);
      await tx.jmlCase.update({
        where: { id: caseId, version: row.version, status: "DRAFT" },
        data: {
          status: "ACTIVE",
          hrOwnerUserId: owner.rule.juniorHr.id,
          seniorHrUserId: owner.rule.seniorHr.id,
          templateId: template.id,
          activatedAt: new Date(),
          lastUpdatedById: actor.userId,
          version: { increment: 1 },
        },
        select: { id: true },
      });
      const routing = await routingContextFor(tx, row.employeeId, owner.rule.juniorHr.id);
      const taskCount = await materialiseTasks(tx, caseId, tasks, routing);
      const accessItemCount = await accessItems(tx, caseId, row.employeeId, due);
      const assetCount = await attachAssets(tx, caseId, row.employeeId, due);
      return {
        caseId,
        taskCount,
        accessItemCount,
        assetCount,
        hrOwnerUserId: owner.rule.juniorHr.id,
      };
    },
    { timeout: 20_000 },
  );
  await noticeToOwners(
    caseId,
    "JML_CASE_ACTIVATED",
    `${row.caseRef} is active: ${result.taskCount} tasks generated.`,
    "activated",
  );
  await notifyRoutedTasks(caseId);
  return result;
}
