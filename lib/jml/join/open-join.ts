import { randomBytes } from "node:crypto";
import { auditedTransaction, prisma } from "@/lib/prisma";
import type { OpenJoinCaseInput } from "@/lib/validations/jml/joiner";
import { cancelOpenWork } from "../engine/case-actions";
import { JmlError } from "../errors";
import { isLive } from "../vocab";
import { DRAFT_REF_PREFIX } from "./draft";

/**
 * The JML entry point for other modules (D8) — Hiring calls this when an offer
 * is accepted, after creating the PRE_JOINER through `lib/people/write.ts`.
 *
 * It opens a DRAFT joiner case for that employee: HR completes what Hiring does
 * not know (IT answers, contract type, line manager…) and activates it from the
 * joiner screen, exactly like a hand-made draft. Idempotent on `sourceRef`
 * (Hiring passes `hiring:<candidateId>`): calling twice returns the same case.
 *
 * Service-level by design: the caller has already authorised its own action
 * (accepting an offer); this function performs no permission check of its own
 * and records `actorUserId` as the case's last updater.
 */
export async function openJoinCase(
  input: OpenJoinCaseInput,
  actorUserId: string | null,
): Promise<{ caseId: string; created: boolean }> {
  const existing = await prisma.jmlJoinDetail.findUnique({
    where: { sourceRef: input.sourceRef },
    select: { caseId: true },
  });
  if (existing) return { caseId: existing.caseId, created: false };
  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { status: true, contractType: true },
  });
  if (!employee) throw new JmlError("That employee does not exist.", 404);
  if (employee.status !== "PRE_JOINER") {
    throw new JmlError(
      "Only a pre-joiner can be onboarded; this person is already an employee.",
      409,
    );
  }
  const open = await prisma.jmlCase.findFirst({
    where: { employeeId: input.employeeId, caseType: "JOIN", status: { not: "CANCELLED" } },
    select: { id: true },
  });
  if (open) throw new JmlError("This pre-joiner already has an onboarding case.", 409);
  const payrollDefault = employee.contractType
    ? await prisma.jmlEmploymentTypeConfig.findUnique({
        where: { employmentType: employee.contractType },
        select: { payrollApplicableDefault: true },
      })
    : null;
  const caseId = await auditedTransaction(async (tx) => {
    const kase = await tx.jmlCase.create({
      data: {
        caseRef: `${DRAFT_REF_PREFIX}${randomBytes(8).toString("hex")}`,
        caseType: "JOIN",
        status: "DRAFT",
        stage: "PREBOARDING",
        employeeId: input.employeeId,
        lastUpdatedById: actorUserId,
      },
      select: { id: true },
    });
    await tx.jmlJoinDetail.create({
      data: {
        caseId: kase.id,
        sourceRef: input.sourceRef,
        plannedStartDate: input.plannedStartDate,
        contractTypeId: input.contractTypeId,
        probationMonths: input.probationMonths,
        payrollApplicable:
          input.payrollApplicable ?? payrollDefault?.payrollApplicableDefault ?? true,
      },
      select: { caseId: true },
    });
    if (input.plannedStartDate) {
      await tx.employee.update({
        where: { id: input.employeeId },
        data: { dateOfJoining: input.plannedStartDate },
        select: { id: true },
      });
    }
    return kase.id;
  });
  return { caseId, created: true };
}

/**
 * The other half of D8 for Hiring: an offer withdrawn after acceptance. A
 * draft is discarded (the pre-joiner stays — Hiring owns it); an activated
 * onboarding is cancelled with its open work. Idempotent.
 */
export async function withdrawJoinCase(
  sourceRef: string,
  reason: string,
  actorUserId: string | null,
): Promise<{ outcome: "discarded" | "cancelled" | "none" }> {
  const detail = await prisma.jmlJoinDetail.findUnique({
    where: { sourceRef },
    select: { caseId: true, case: { select: { status: true, caseRef: true, version: true } } },
  });
  if (!detail) return { outcome: "none" };
  const { status, caseRef } = detail.case;
  if (status === "DRAFT") {
    await auditedTransaction(async (tx) => {
      // Freed, so a later re-acceptance opens a fresh case rather than the binned one.
      await tx.jmlJoinDetail.update({
        where: { caseId: detail.caseId },
        data: { sourceRef: null },
        select: { caseId: true },
      });
      await tx.jmlCase.delete({ where: { id: detail.caseId }, select: { id: true } });
    });
    return { outcome: "discarded" };
  }
  if (!isLive(status)) return { outcome: "none" };
  await auditedTransaction(async (tx) => {
    await cancelOpenWork(tx, detail.caseId, `${caseRef} cancelled`);
    await tx.jmlCase.update({
      where: { id: detail.caseId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason.slice(0, 1000),
        lastUpdatedById: actorUserId,
        version: { increment: 1 },
      },
      select: { id: true },
    });
  });
  return { outcome: "cancelled" };
}
