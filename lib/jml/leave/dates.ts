import { auditedTransaction, prisma } from "@/lib/prisma";
import { addWorkingDays, utcDate } from "@/lib/working-time/calendar";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import type { ExitDatesInput } from "@/lib/validations/jml/leave";
import { loadCaseFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { recalculateDueDates } from "../engine/generate";
import { SETTLED_TASK_STATUSES } from "../vocab";
import { leaveAnchors, loadLeaveRow, revocationAnchor } from "./leave-data";
import { noticeToOwners } from "./notices";
import { dateProblems } from "./rules";

/**
 * The exit's date model changes — HR Offboarding `PUT /api/exits/[id]/dates`
 * (AC-3.3/3.4/3.6). On a draft it is plain editing. On an activated case:
 * only open tasks keyed to a basis that moved are recalculated; open
 * revocation items and unreturned assets follow the LPWD; moving the LPWD
 * without the LDS is an early release and needs it approved (the flag, or the
 * granted Early Release approval); the owner and paired senior get the
 * recalculation notice. Offboarding validated exit type / nationality / notice
 * days here and then never wrote them — they are written.
 */

const TERMINAL = new Set(["CLOSED", "CANCELLED", "ARCHIVED"]);
const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

export async function changeExitDates(actor: JmlActor, caseId: string, input: ExitDatesInput) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageLeavers", "LEAVE");
  if (TERMINAL.has(kase.status)) throw new JmlError("This exit case is closed.", 409);
  if (kase.version !== input.expectedVersion)
    throw new JmlError("Someone else changed this case. Reload and try again.", 409);
  const row = await loadLeaveRow(caseId);
  const d = row.leaveDetail;
  const problems = dateProblems(input);
  if (problems.length > 0) throw new JmlError(problems.map((p) => p.message).join(" "), 422);
  const live = kase.status !== "DRAFT";
  if (live && (!input.lastPhysicalWorkingDay || !input.lastDayOfService)) {
    throw new JmlError("An active case keeps both exit dates.", 409);
  }
  const earlyRelease =
    !same(d.lastPhysicalWorkingDay, input.lastPhysicalWorkingDay) &&
    same(d.lastDayOfService, input.lastDayOfService);
  if (live && earlyRelease && !(input.earlyReleaseApproved ?? d.earlyReleaseApproved)) {
    throw new JmlError(
      "Moving the Last Physical Working Day without the Last Day of Service is an early release via leave, which needs approval (AC-3.3). Record the Early Release approval first.",
      422,
    );
  }
  const before = leaveAnchors(d);
  const after = leaveAnchors(input);
  const calendar = await loadWorkingCalendar();
  const openTasks = live
    ? await prisma.jmlTask.findMany({
        where: { caseId, status: { notIn: [...SETTLED_TASK_STATUSES] } },
        select: {
          id: true,
          code: true,
          dateBasis: true,
          offsetDays: true,
          offsetUnit: true,
          dueDate: true,
        },
        take: 1000,
      })
    : [];
  const changes = recalculateDueDates(openTasks, before, after, calendar);
  const oldRevoke = revocationAnchor(d);
  const newRevoke = revocationAnchor({ ...input });
  const revokeMoved = live && newRevoke && !same(oldRevoke, newRevoke);
  await auditedTransaction(async (tx) => {
    await tx.leaveCaseDetail.update({
      where: { caseId },
      data: {
        exitType: input.exitType,
        exitSubtype: input.exitSubtype,
        nationality: input.nationality,
        noticeStartDate: input.noticeStartDate,
        noticePeriodDays: input.noticePeriodDays,
        noticePeriodOverrideReason: input.noticePeriodOverrideReason,
        lastPhysicalWorkingDay: input.lastPhysicalWorkingDay,
        lastDayOfService: input.lastDayOfService,
        departureDate: input.departureDate,
        ...(input.earlyReleaseApproved !== undefined
          ? { earlyReleaseApproved: input.earlyReleaseApproved }
          : {}),
      },
      select: { caseId: true },
    });
    const byCode = new Map(openTasks.map((t) => [t.code, t.id]));
    for (const c of changes) {
      await tx.jmlTask.update({
        where: { id: byCode.get(c.code)! },
        data: { dueDate: c.to },
        select: { id: true },
      });
    }
    if (revokeMoved) {
      const due = addWorkingDays(newRevoke, 0, calendar);
      const items = await tx.jmlAccessItem.findMany({
        where: { caseId, direction: "REVOKE", confirmedDate: null },
        select: { id: true },
        take: 500,
      });
      for (const i of items)
        await tx.jmlAccessItem.update({
          where: { id: i.id },
          data: { dueDate: due },
          select: { id: true },
        });
      const assets = await tx.jmlAsset.findMany({
        where: { returnedOnCaseId: caseId, returnedDate: null, writtenOff: false },
        select: { id: true },
        take: 200,
      });
      for (const a of assets)
        await tx.jmlAsset.update({
          where: { id: a.id },
          data: { returnDueDate: due },
          select: { id: true },
        });
    }
    // D7: once departed, the core record's last working day follows the LDS.
    if (
      d.departureAppliedAt &&
      input.lastDayOfService &&
      !same(d.lastDayOfService, input.lastDayOfService)
    ) {
      await tx.employee.update({
        where: { id: row.employeeId },
        data: { lastWorkingDay: utcDate(input.lastDayOfService) },
        select: { id: true },
      });
    }
    await tx.jmlCase.update({
      where: { id: caseId, version: kase.version },
      data: { version: { increment: 1 }, lastUpdatedById: actor.userId },
      select: { id: true },
    });
  });
  if (live && changes.length > 0) {
    await noticeToOwners(
      caseId,
      "JML_RECALCULATION_NOTICE",
      `${row.caseRef}: the exit dates changed and ${changes.length} task due date${changes.length === 1 ? "" : "s"} moved.`,
      `recalc:${Date.now()}`,
    );
  }
  return {
    recalculated: changes.length,
    changes: changes.map((c) => ({
      code: c.code,
      from: c.from?.toISOString().slice(0, 10) ?? null,
      to: c.to.toISOString().slice(0, 10),
    })),
  };
}
