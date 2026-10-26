import type { JmlApprovalType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { JmlError } from "../errors";
import {
  APPROVAL_HOLDERS,
  APPROVAL_TYPES,
  checkAuthorityConfig,
  requiresSecondLevelDelegate,
} from "./approval-rules";

/**
 * Approval authority (Offboarding ApprovalConfig, AC-11.1/11.2) — per type: the
 * holder label, the delegate and (for two types) the second-level delegate, all
 * EMPLOYEES with real foreign keys (the source stored loose ids).
 */

const SELECT = {
  approvalType: true,
  holderLabel: true,
  active: true,
  delegate: { select: { id: true, name: true } },
  secondLevelDelegate: { select: { id: true, name: true } },
} as const;

export async function listAuthorities() {
  const saved = await prisma.jmlApprovalAuthority.findMany({ select: SELECT, take: 20 });
  const byType = new Map(saved.map((s) => [s.approvalType, s]));
  return APPROVAL_TYPES.map((type) => ({
    approvalType: type,
    holders: APPROVAL_HOLDERS[type],
    requiresSecondLevel: requiresSecondLevelDelegate(type),
    saved: byType.get(type) ?? null,
  }));
}

/**
 * Employees whose login decides approvals as HR Manager — they cannot be the
 * second level (BR-OFF-032: the escalation must not lead back to the holder).
 */
async function hrManagerEmployeeIds(): Promise<string[]> {
  const rows = await prisma.roleAssignment.findMany({
    where: {
      role: {
        deletedAt: null,
        permissions: { hasSome: ["jml.decideApprovals", "jml.approveSettlement"] },
      },
      user: { deletedAt: null },
    },
    select: { user: { select: { employee: { select: { id: true } } } } },
    take: 500,
  });
  return rows.map((r) => r.user.employee?.id).filter((x): x is string => Boolean(x));
}

export async function saveAuthority(input: {
  approvalType: JmlApprovalType;
  holderLabel: string;
  delegateEmployeeId: string | null;
  secondLevelDelegateEmployeeId: string | null;
  active: boolean;
}) {
  const problems = checkAuthorityConfig(
    {
      approvalType: input.approvalType,
      delegateId: input.delegateEmployeeId,
      secondLevelDelegateId: input.secondLevelDelegateEmployeeId,
    },
    { secondLevelIneligible: await hrManagerEmployeeIds() },
  );
  if (problems.length > 0) throw new JmlError(problems.map((p) => p.message).join(" "), 422);
  const data = {
    holderLabel: input.holderLabel,
    delegateEmployeeId: input.delegateEmployeeId,
    secondLevelDelegateEmployeeId: requiresSecondLevelDelegate(input.approvalType)
      ? input.secondLevelDelegateEmployeeId
      : null,
    active: input.active,
  };
  const existing = await prisma.jmlApprovalAuthority.findUnique({
    where: { approvalType: input.approvalType },
    select: { id: true },
  });
  if (existing) {
    await prisma.jmlApprovalAuthority.update({
      where: { id: existing.id },
      data,
      select: { id: true },
    });
  } else {
    await prisma.jmlApprovalAuthority.create({
      data: { approvalType: input.approvalType, ...data },
      select: { id: true },
    });
  }
  return { saved: true };
}
