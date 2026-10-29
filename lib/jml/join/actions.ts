import { auditedTransaction, prisma } from "@/lib/prisma";
import { existingLoginEmails, provisionLoginFor } from "@/lib/pms/import/run";
import { isPlaceholderEmail } from "@/lib/people/provisional-id";
import { utcDate, zonedToday } from "@/lib/working-time/calendar";
import { loadWorkingCalendar } from "@/lib/working-time/load";
import { loadCaseFor, type JmlActor } from "../access";
import { queueEmail } from "../email/queue";
import { EMAIL_TYPES } from "../email/types";
import { JmlError } from "../errors";
import { refreshCase } from "../engine/tasks";
import { SETTLED_TASK_STATUSES } from "../vocab";
import { submitAndRecord } from "./it-intake";
import { shiftedDue } from "./start-shift";
import { onActualStartEntered, onStartDateChanged } from "./triggers";
import { resolveCaseTaskNotices } from "../routing/assign";

/**
 * Joiner case actions — HR Onboarding `case.ts` (start date, actual start) plus
 * the actions the source never had a screen or a writer for (8.4.5/8.4.6):
 * confirming IT readiness, resubmitting to IT and sending the welcome-review
 * message by hand.
 */

type Tx = Parameters<Parameters<typeof auditedTransaction>[0]>[0];

const DAY_MS = 86_400_000;

async function loadJoin(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageJoiners", "JOIN");
  const detail = await prisma.jmlJoinDetail.findUnique({
    where: { caseId },
    select: { plannedStartDate: true, actualStartDate: true, probationMonths: true },
  });
  if (!detail) throw new JmlError("Joiner not found", 404);
  return { kase, detail };
}

function addMonths(date: Date, months: number): Date {
  const d = utcDate(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Day one: the employee becomes ACTIVE, gets a login if their work address is issued. */
async function activateEmployee(
  tx: Tx,
  employeeId: string,
  start: Date,
  probationMonths: number | null,
) {
  const e = await tx.employee.findUnique({
    where: { id: employeeId },
    select: { status: true, email: true, name: true, userId: true, probationEndDate: true },
  });
  if (!e) throw new JmlError("The joiner's employee record is missing.", 409);
  let userId = e.userId;
  if (!userId && !isPlaceholderEmail(e.email)) {
    const taken = await existingLoginEmails(tx, [e.email]);
    userId = await provisionLoginFor(tx, { email: e.email, name: e.name, status: "ACTIVE" }, taken);
  }
  await tx.employee.update({
    where: { id: employeeId },
    data: {
      ...(e.status === "PRE_JOINER" ? { status: "ACTIVE" as const } : {}),
      dateOfJoining: start,
      userId,
      ...(probationMonths !== null && !e.probationEndDate
        ? { probationEndDate: addMonths(start, probationMonths) }
        : {}),
    },
    select: { id: true },
  });
}

/** QA2 N-12 — how much earlier than planned a start may be confirmed. */
export const EARLY_START_DAYS = 7;

export function dayOneProblem(p: {
  actualStart: Date;
  plannedStart: Date | null;
  email: string | null | undefined;
}): { message: string; status: 400 | 409 } | null {
  if (p.plannedStart) {
    const earliest = utcDate(p.plannedStart).getTime() - EARLY_START_DAYS * DAY_MS;
    if (utcDate(p.actualStart).getTime() < earliest) {
      return {
        status: 400,
        message:
          `The actual start is more than ${EARLY_START_DAYS} days before the planned start ` +
          `(${utcDate(p.plannedStart).toISOString().slice(0, 10)}). Move the planned start first ` +
          `if they really started early.`,
      };
    }
  }
  if (!p.email || isPlaceholderEmail(p.email)) {
    return {
      status: 409,
      message:
        "Add the joiner's work email before confirming the start: without it they get no login and " +
        "show a placeholder address everywhere.",
    };
  }
  return null;
}

/** AC-7.2/7.3: once, ACTIVE cases only, never in the future (Muscat today). */
export async function confirmActualStart(actor: JmlActor, caseId: string, date: Date) {
  const { kase, detail } = await loadJoin(actor, caseId);
  if (detail.actualStartDate)
    throw new JmlError("The actual start has already been confirmed.", 409);
  // QA D-02 recovery: before the fix, a checklist finished ahead of day one
  // auto-COMPLETED the case and stranded the joiner as PRE_JOINER. Such a case
  // (COMPLETED, no actual start) may still confirm the start.
  const stranded = kase.status === "COMPLETED";
  if (kase.status !== "ACTIVE" && !stranded) {
    throw new JmlError("Only an active onboarding can start.", 409);
  }
  const calendar = await loadWorkingCalendar();
  if (utcDate(date) > zonedToday(new Date(), calendar.schedule.timeZone)) {
    throw new JmlError("The actual start date cannot be in the future.", 400);
  }
  // QA2 N-12 — day-one guards. A start confirmed three weeks before the
  // planned (contract) start was accepted, and an ACTIVE employee was left
  // with a placeholder address and no login.
  const problem = dayOneProblem({
    actualStart: date,
    plannedStart: detail.plannedStartDate,
    email: (
      await prisma.employee.findUnique({
        where: { id: kase.employeeId },
        select: { email: true },
      })
    )?.email,
  });
  if (problem) throw new JmlError(problem.message, problem.status);
  const completed = await auditedTransaction(async (tx) => {
    await tx.jmlJoinDetail.update({
      where: { caseId },
      data: { actualStartDate: date },
      select: { caseId: true },
    });
    await activateEmployee(tx, kase.employeeId, date, detail.probationMonths);
    await tx.jmlCase.update({
      where: { id: caseId, version: kase.version },
      data: {
        ...(kase.stage === "PREBOARDING" ? { stage: "FIRST_DAY" as const } : {}),
        lastUpdatedById: actor.userId,
        version: { increment: 1 },
      },
      select: { id: true },
    });
    // A checklist already finished completes the case now that the joiner has
    // started (refreshCase holds a JOIN open until then).
    if (stranded) return true;
    return (await refreshCase(tx, caseId, actor.userId)).completedNow;
  });
  await onActualStartEntered(caseId);
  if (completed) await resolveCaseTaskNotices(caseId);
  return { actualStartDate: date.toISOString().slice(0, 10) };
}

export async function changeStartDate(actor: JmlActor, caseId: string, newStart: Date) {
  const { kase, detail } = await loadJoin(actor, caseId);
  if (kase.status === "DRAFT") throw new JmlError("Edit a draft's planned start on its form.", 409);
  if (kase.status === "CANCELLED" || kase.status === "ARCHIVED") {
    throw new JmlError("This onboarding is closed.", 409);
  }
  if (detail.actualStartDate) throw new JmlError("This joiner has already started.", 409);
  const previous = detail.plannedStartDate;
  if (!previous) throw new JmlError("This onboarding has no planned start to move.", 409);
  const shiftDays = Math.round(
    (utcDate(newStart).getTime() - utcDate(previous).getTime()) / DAY_MS,
  );
  if (shiftDays === 0) throw new JmlError("That is already the planned start date.", 409);
  const calendar = await loadWorkingCalendar();
  let moved = 0;
  await auditedTransaction(async (tx) => {
    const tasks = await tx.jmlTask.findMany({
      where: { caseId, status: { notIn: [...SETTLED_TASK_STATUSES] }, dueDate: { not: null } },
      select: {
        id: true,
        dateBasis: true,
        offsetDays: true,
        offsetUnit: true,
        dueDate: true,
        dueDateOverrideReason: true,
        statutory: true,
      },
      take: 1000,
    });
    for (const t of tasks) {
      const due = shiftedDue(t, newStart, shiftDays, calendar);
      if (!due || due.getTime() === utcDate(t.dueDate!).getTime()) continue;
      await tx.jmlTask.update({
        where: { id: t.id },
        data: { dueDate: due, ...(t.statutory ? { complianceDeadline: due } : {}) },
        select: { id: true },
      });
      moved += 1;
    }
    await tx.jmlJoinDetail.update({
      where: { caseId },
      data: { plannedStartDate: newStart },
      select: { caseId: true },
    });
    await tx.employee.update({
      where: { id: kase.employeeId },
      data: { dateOfJoining: newStart },
      select: { id: true },
    });
    await tx.jmlCase.update({
      where: { id: caseId, version: kase.version },
      data: { lastUpdatedById: actor.userId, version: { increment: 1 } },
      select: { id: true },
    });
  });
  const told = await onStartDateChanged(caseId, previous);
  return { shiftDays, tasksMoved: moved, ...told };
}

/** Onboarding 8.4.5 fixed: IT readiness has a writer and a date. */
export async function confirmItReadiness(actor: JmlActor, caseId: string, confirmed: boolean) {
  const { kase } = await loadJoin(actor, caseId);
  if (kase.status !== "ACTIVE") throw new JmlError("Only an active onboarding can change.", 409);
  await prisma.jmlJoinDetail.update({
    where: { caseId },
    data: confirmed
      ? { itReadinessConfirmed: true, itReadinessAt: new Date(), itReadinessById: actor.userId }
      : { itReadinessConfirmed: false, itReadinessAt: null, itReadinessById: null },
    select: { caseId: true },
  });
  return { itReadinessConfirmed: confirmed };
}

export async function resubmitToIt(actor: JmlActor, caseId: string) {
  const { kase } = await loadJoin(actor, caseId);
  if (kase.status !== "ACTIVE") throw new JmlError("Only an active onboarding can change.", 409);
  return submitAndRecord(caseId);
}

/** §11.2 row 10 — "HR reviews and sends": queued by hand from the case (8.4.6). */
export async function sendWelcomeReview(actor: JmlActor, caseId: string, recipient: string) {
  const { kase } = await loadJoin(actor, caseId);
  if (kase.status === "CANCELLED" || kase.status === "ARCHIVED" || kase.status === "DRAFT") {
    throw new JmlError("Messages are sent only for an activated, open onboarding.", 409);
  }
  return queueEmail({
    type: EMAIL_TYPES.WELCOME_REVIEW,
    recipient,
    subject: `Welcome email review — ${kase.caseRef}`,
    caseId,
  });
}
