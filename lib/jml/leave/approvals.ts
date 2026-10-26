import type { JmlApprovalType } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { loadCaseFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import {
  APPROVAL_HOLDERS,
  checkHolders,
  decisionProblem,
  requiresSecondLevelDelegate,
} from "./approval-rules";
import { loadLeaveRow } from "./leave-data";
import { noticeToOwners } from "./notices";
import { DOCUMENTED_EXIT_TYPES } from "./rules";

/**
 * §4.3 approvals on a case — HR Offboarding `/api/exits/[id]/approvals`, for
 * ALL FIVE types (F5). Decisions are recorded by an HR user holding
 * `jml.decideApprovals` on the holder's behalf (the Operations Director has no
 * login), with the reference the authorisation came from. A granted Early
 * Release (both holders) sets the case's early-release flag the date change
 * reads; Final Settlement Approval is two rows, read by the settlement (S6).
 */

const SELECT = {
  id: true,
  approvalType: true,
  holderRoleKey: true,
  status: true,
  requestedAt: true,
  decisionDate: true,
  reference: true,
  comments: true,
  delegateUsed: true,
  secondLevelUsed: true,
  holderEmployee: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} as const;

export async function listApprovals(actor: JmlActor, caseId: string) {
  await loadCaseFor(actor, caseId, "jml.view", "LEAVE");
  const rows = await prisma.jmlApproval.findMany({
    where: { caseId },
    orderBy: [{ approvalType: "asc" }, { holderRoleKey: "asc" }],
    take: 50,
    select: SELECT,
  });
  return {
    approvals: rows,
    terminationAuthorisation: checkHolders("TERMINATION_AUTHORISATION", rows),
    finalSettlementApproval: checkHolders("FINAL_SETTLEMENT_APPROVAL", rows),
  };
}

function typeRefusal(
  type: JmlApprovalType,
  exitType: string,
  settlementApplicable: boolean,
): string | null {
  if (type === "TERMINATION_AUTHORISATION" && !DOCUMENTED_EXIT_TYPES.has(exitType)) {
    return "Termination Authorisation applies to a termination or summary dismissal only.";
  }
  if (type === "FINAL_SETTLEMENT_APPROVAL" && !settlementApplicable) {
    return "No settlement applies to this exit, so there is nothing to approve.";
  }
  return null;
}

/** Request the missing holder rows of one type (idempotent). */
export async function requestApproval(actor: JmlActor, caseId: string, type: JmlApprovalType) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageLeavers", "LEAVE");
  if (["CLOSED", "CANCELLED", "ARCHIVED"].includes(kase.status))
    throw new JmlError("This exit case is closed.", 409);
  const row = await loadLeaveRow(caseId);
  const d = row.leaveDetail;
  const refusal = typeRefusal(type, d.exitType, d.settlementApplicable);
  if (refusal) throw new JmlError(refusal, 409);
  const existing = await prisma.jmlApproval.findMany({
    where: { caseId, approvalType: type },
    select: { holderRoleKey: true },
  });
  const have = new Set(existing.map((e) => e.holderRoleKey));
  const missing = APPROVAL_HOLDERS[type].filter((h) => !have.has(h));
  await auditedTransaction(async (tx) => {
    for (const holderRoleKey of missing) {
      await tx.jmlApproval.create({
        data: {
          caseId,
          approvalType: type,
          holderRoleKey,
          holderEmployeeId: holderRoleKey === "Line Manager" ? d.lineManagerEmployeeId : null,
        },
        select: { id: true },
      });
    }
  });
  return { requested: missing, alreadyPresent: [...have] };
}

async function assertEscalation(
  type: JmlApprovalType,
  delegateUsed: boolean,
  secondLevelUsed: boolean,
) {
  if (!delegateUsed && !secondLevelUsed) return;
  const authority = await prisma.jmlApprovalAuthority.findUnique({
    where: { approvalType: type },
    select: { active: true, delegateEmployeeId: true, secondLevelDelegateEmployeeId: true },
  });
  if (delegateUsed && !(authority?.active && authority.delegateEmployeeId)) {
    throw new JmlError(
      "No delegate is configured for this approval type, so a delegate cannot have decided it.",
      409,
    );
  }
  if (secondLevelUsed) {
    if (!requiresSecondLevelDelegate(type) || !authority?.secondLevelDelegateEmployeeId) {
      throw new JmlError("No second-level delegate is configured for this approval type.", 409);
    }
  }
}

export async function decideApproval(
  actor: JmlActor,
  caseId: string,
  approvalId: string,
  input: {
    status: "GRANTED" | "REJECTED";
    decisionDate: Date;
    reference: string | null;
    comments: string | null;
    delegateUsed: boolean;
    secondLevelUsed: boolean;
  },
) {
  const kase = await loadCaseFor(actor, caseId, "jml.decideApprovals", "LEAVE");
  const approval = await prisma.jmlApproval.findUnique({
    where: { id: approvalId },
    select: { id: true, caseId: true, status: true, holderRoleKey: true, approvalType: true },
  });
  if (!approval || approval.caseId !== caseId) throw new JmlError("Approval not found", 404);
  const problem = decisionProblem(approval, input);
  if (problem) throw new JmlError(problem, 409);
  await assertEscalation(approval.approvalType, input.delegateUsed, input.secondLevelUsed);
  await auditedTransaction(async (tx) => {
    await tx.jmlApproval.update({
      where: { id: approvalId, status: "PENDING" },
      data: { ...input, decidedById: actor.userId },
      select: { id: true },
    });
    if (approval.approvalType === "EARLY_RELEASE_VIA_LEAVE" && input.status === "GRANTED") {
      const all = await tx.jmlApproval.findMany({
        where: { caseId, approvalType: "EARLY_RELEASE_VIA_LEAVE" },
        select: { approvalType: true, holderRoleKey: true, status: true },
      });
      if (checkHolders("EARLY_RELEASE_VIA_LEAVE", all).granted) {
        await tx.leaveCaseDetail.update({
          where: { caseId },
          data: { earlyReleaseApproved: true },
          select: { caseId: true },
        });
      }
    }
  });
  await noticeToOwners(
    caseId,
    "JML_INFO",
    `${approval.holderRoleKey} ${input.status === "GRANTED" ? "granted" : "refused"} the ${approval.approvalType.replaceAll("_", " ").toLowerCase()} (${kase.caseRef}).`,
    `decision:${approvalId}`,
  );
  return { id: approvalId, status: input.status };
}
