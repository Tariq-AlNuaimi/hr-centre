import type { JmlAccessDomain } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { canFor, loadCaseFor, MANAGE_PERMISSION, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { accessConfirmationProblem, rotationFor, type AccessConfirmation } from "./rules";
import { loadSchedule } from "@/lib/working-time/load";
import { zonedToday } from "@/lib/working-time/calendar";
import { accessSummary, defaultCutoff, localInputToInstant } from "../leave/cutoff";

/**
 * The access register (Offboarding §9.8, D3): GRANT items on a joiner, REVOKE
 * items on a leaver (generated from the checklist at activation). Unrotated
 * shared credentials are surfaced on every read (AC-7.2).
 */

const ITEM_SELECT = {
  id: true,
  direction: true,
  domain: true,
  systemName: true,
  accessLevel: true,
  sharedCredential: true,
  rotationRequired: true,
  dueDate: true,
  confirmedDate: true,
  confirmingParty: true,
  reference: true,
  confirmedBy: { select: { name: true } },
} as const;

export async function listAccessItems(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.view");
  const items = await prisma.jmlAccessItem.findMany({
    where: { caseId },
    orderBy: [{ domain: "asc" }, { createdAt: "asc" }],
    select: ITEM_SELECT,
    take: 300,
  });
  const { timeZone } = await loadSchedule();
  return {
    items,
    // P2-5 — per-system status at a glance, and (leavers) when the login is cut.
    summary: accessSummary(items, zonedToday(new Date(), timeZone)),
    cutoff: kase.caseType === "LEAVE" ? await cutoffFor(caseId, timeZone) : null,
    open: items.filter((i) => !i.confirmedDate).length,
    unrotatedShared: items
      .filter((i) => i.sharedCredential && !i.confirmedDate)
      .map((i) => i.systemName),
    can: { manage: canFor(actor, MANAGE_PERMISSION[kase.caseType], kase.subject) },
  };
}

export async function addAccessItem(
  actor: JmlActor,
  caseId: string,
  input: {
    domain: JmlAccessDomain;
    systemName: string;
    accessLevel: string | null;
    sharedCredential: boolean;
    rotationRequired: boolean;
    dueDate: Date | null;
  },
) {
  const head = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: { caseType: true },
  });
  if (!head) throw new JmlError("Case not found", 404);
  const kase = await loadCaseFor(actor, caseId, MANAGE_PERMISSION[head.caseType]);
  if (["DRAFT", "CLOSED", "CANCELLED", "ARCHIVED", "COMPLETED"].includes(kase.status)) {
    throw new JmlError("Access items are recorded on an active case.", 409);
  }
  const leave = kase.caseType === "LEAVE";
  let due = input.dueDate;
  if (!due && leave) {
    const d = await prisma.jmlExitDetail.findUnique({
      where: { caseId },
      select: { lastPhysicalWorkingDay: true, exitType: true, noticeStartDate: true },
    });
    due =
      d?.exitType === "SUMMARY_DISMISSAL" ? d.noticeStartDate : (d?.lastPhysicalWorkingDay ?? null);
  }
  if (!due) throw new JmlError("Give the date the access is due.", 422);
  return auditedTransaction((tx) =>
    tx.jmlAccessItem.create({
      data: {
        caseId,
        employeeId: kase.employeeId,
        direction: leave ? "REVOKE" : "GRANT",
        domain: input.domain,
        systemName: input.systemName,
        accessLevel: input.accessLevel,
        sharedCredential: input.sharedCredential,
        rotationRequired: rotationFor(input.sharedCredential, input.rotationRequired),
        dueDate: due,
      },
      select: { id: true },
    }),
  );
}

export async function confirmAccessItem(
  actor: JmlActor,
  caseId: string,
  itemId: string,
  input: AccessConfirmation,
) {
  const head = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: { caseType: true },
  });
  if (!head) throw new JmlError("Case not found", 404);
  await loadCaseFor(actor, caseId, MANAGE_PERMISSION[head.caseType]);
  const item = await prisma.jmlAccessItem.findUnique({
    where: { id: itemId },
    select: { caseId: true, confirmedDate: true, rotationRequired: true, direction: true },
  });
  if (!item || item.caseId !== caseId) throw new JmlError("Access item not found", 404);
  const problem = accessConfirmationProblem(item, input);
  if (problem) throw new JmlError(problem, 422);
  const reference = input.coveredByDisablementOf
    ? `Covered by disablement of ${input.coveredByDisablementOf}${input.reference ? ` — ${input.reference}` : ""}`
    : input.reference;
  await auditedTransaction((tx) =>
    tx.jmlAccessItem.update({
      where: { id: itemId, confirmedDate: null },
      data: {
        confirmingParty: input.confirmingParty,
        confirmedDate: input.confirmedDate,
        reference,
        confirmedById: actor.userId,
      },
      select: { id: true },
    }),
  );
  const open = await prisma.jmlAccessItem.count({ where: { caseId, confirmedDate: null } });
  return { confirmed: true, open };
}

async function cutoffFor(caseId: string, timeZone: string) {
  const d = await prisma.jmlExitDetail.findUnique({
    where: { caseId },
    select: { accessCutoffAt: true, lastPhysicalWorkingDay: true, loginRevokedAt: true },
  });
  if (!d) return null;
  return {
    at: d.accessCutoffAt ?? defaultCutoff(d.lastPhysicalWorkingDay, timeZone),
    isDefault: d.accessCutoffAt === null,
    loginRevokedAt: d.loginRevokedAt,
    timeZone,
  };
}

/**
 * P2-5 — HR sets (or clears, back to the 17:00 default) the leaver's access
 * cut-off. `at` is a wall-clock time in the schedule's zone ("YYYY-MM-DDTHH:mm").
 * Refused once the login is already revoked: the cut-off has happened.
 */
export async function setAccessCutoff(actor: JmlActor, caseId: string, at: string | null) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageLeavers", "LEAVE");
  if (["CLOSED", "CANCELLED", "ARCHIVED"].includes(kase.status)) {
    throw new JmlError("The access cut-off is set on an open exit.", 409);
  }
  const d = await prisma.jmlExitDetail.findUnique({
    where: { caseId },
    select: { loginRevokedAt: true },
  });
  if (!d) throw new JmlError("Case not found", 404);
  if (d.loginRevokedAt) throw new JmlError("The login has already been revoked.", 409);
  const { timeZone } = await loadSchedule();
  const instant = at === null ? null : localInputToInstant(at, timeZone);
  if (at !== null && !instant) throw new JmlError("at: use a date and time.", 422);
  await prisma.jmlExitDetail.update({
    where: { caseId },
    data: { accessCutoffAt: instant },
    select: { caseId: true },
  });
  return cutoffFor(caseId, timeZone);
}
