import type { JmlAccessDomain } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { canFor, loadCaseFor, MANAGE_PERMISSION, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { accessConfirmationProblem, rotationFor, type AccessConfirmation } from "./rules";

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
  return {
    items,
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
    const d = await prisma.leaveCaseDetail.findUnique({
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
