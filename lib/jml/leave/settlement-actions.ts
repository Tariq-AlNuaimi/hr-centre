import { auditedTransaction, prisma } from "@/lib/prisma";
import { loadCaseFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { sealMoney } from "../money/crypto";
import { checkHolders } from "./approval-rules";
import { settlementLineProblems } from "./gratuity";
import { noticeToOwners } from "./notices";
import { loadContext, statutoryRows } from "./settlement";
import { canApproveSettlement, canCloseSettlement, paymentDeadline } from "./settlement-rules";

/**
 * Settlement actions after the calculation — lines (C4), approval (AC-10.8 +
 * both Final Settlement Approval signatures, F5), payment (AC-10.7 / C5) and
 * the settlement side of closure.
 */

async function assertEditable(caseId: string) {
  const s = await prisma.leaveSettlement.findUnique({
    where: { caseId },
    select: { approvedAt: true, calculatedAt: true },
  });
  if (!s?.calculatedAt) throw new JmlError("Calculate the settlement before adding lines.", 409);
  if (s.approvedAt)
    throw new JmlError("The settlement is approved; its lines can no longer change.", 409);
}

/** C4: a line with a type, a positive amount, reason code, reference and an authoriser. */
export async function addSettlementLine(
  actor: JmlActor,
  caseId: string,
  input: {
    lineType: "ADDITION" | "DEDUCTION";
    deductionType: string | null;
    description: string;
    lineAmount: string;
    reasonCode: string;
    documentaryReference: string;
    authorisedById: string;
    assetId: string | null;
  },
) {
  await loadCaseFor(actor, caseId, "jml.manageSettlement", "LEAVE");
  await assertEditable(caseId);
  const problems = settlementLineProblems({ ...input, lineAmount: Number(input.lineAmount) });
  if (problems.length) throw new JmlError(problems.join(" "), 422);
  if (input.assetId) {
    const asset = await prisma.jmlAsset.findUnique({
      where: { id: input.assetId },
      select: { returnedOnCaseId: true },
    });
    if (asset?.returnedOnCaseId !== caseId)
      throw new JmlError("That asset is not on this exit.", 422);
  }
  const authoriser = await prisma.user.findUnique({
    where: { id: input.authorisedById },
    select: { id: true },
  });
  if (!authoriser) throw new JmlError("The authorising approver is not an active user.", 422);
  const id = (await import("node:crypto")).randomUUID();
  await auditedTransaction(async (tx) => {
    await tx.leaveSettlementLine.create({
      data: {
        id,
        caseId,
        lineType: input.lineType,
        deductionType: input.lineType === "DEDUCTION" ? (input.deductionType as never) : null,
        description: input.description,
        lineAmountEnc: sealMoney("settlementLine", id, "lineAmount", input.lineAmount)!,
        reasonCode: input.reasonCode,
        documentaryReference: input.documentaryReference,
        authorisedById: input.authorisedById,
        assetId: input.assetId,
      },
      select: { id: true },
    });
    await tx.leaveSettlement.update({
      where: { caseId },
      data: { recalculationRequired: true },
      select: { caseId: true },
    });
  });
  return { id, recalculationRequired: true };
}

export async function removeSettlementLine(actor: JmlActor, caseId: string, lineId: string) {
  await loadCaseFor(actor, caseId, "jml.manageSettlement", "LEAVE");
  await assertEditable(caseId);
  const line = await prisma.leaveSettlementLine.findUnique({
    where: { id: lineId },
    select: { caseId: true },
  });
  if (line?.caseId !== caseId) throw new JmlError("Line not found", 404);
  await auditedTransaction(async (tx) => {
    await tx.leaveSettlementLine.delete({ where: { id: lineId }, select: { id: true } });
    await tx.leaveSettlement.update({
      where: { caseId },
      data: { recalculationRequired: true },
      select: { caseId: true },
    });
  });
  return { removed: true, recalculationRequired: true };
}

/** AC-10.8 + F5: verified figures, referenced deductions, settled assets and BOTH signatures. */
export async function approveSettlement(
  actor: JmlActor,
  caseId: string,
  input: { signatureReference: string | null },
) {
  const kase = await loadCaseFor(actor, caseId, "jml.approveSettlement", "LEAVE");
  const ctx = await loadContext(caseId);
  const s = ctx.settlement;
  const assets = await prisma.jmlAsset.findMany({
    where: { returnedOnCaseId: caseId },
    select: {
      identifier: true,
      description: true,
      returnedDate: true,
      writtenOff: true,
      deductionApplicable: true,
    },
    take: 200,
  });
  const unreferenced = await prisma.leaveSettlementLine.count({
    where: { caseId, lineType: "DEDUCTION", documentaryReference: "" },
  });
  const verdict = canApproveSettlement({
    calculated: Boolean(s?.calculatedAt),
    recalculationRequired: s?.recalculationRequired ?? false,
    provisional: s?.provisional ?? true,
    unverifiedKeys: s?.unverifiedKeys ?? [],
    unreferencedDeductions: unreferenced,
    assets,
    signatures: checkHolders("FINAL_SETTLEMENT_APPROVAL", ctx.approvals),
    alreadyApproved: Boolean(s?.approvedAt),
  });
  if (!verdict.allowed) throw new JmlError(verdict.reasons.join(" "), 409);
  await auditedTransaction((tx) =>
    tx.leaveSettlement.update({
      where: { caseId, approvedAt: null },
      data: {
        approvedAt: new Date(),
        approvedById: actor.userId,
        signatureReference: input.signatureReference,
      },
      select: { caseId: true },
    }),
  );
  await noticeToOwners(
    caseId,
    "JML_INFO",
    `${kase.caseRef}: the final settlement is approved and can be paid.`,
    "settlement-approved",
  );
  return { approved: true };
}

/** AC-10.7 / C5: payment confirmed with a reference; returns how the window went. */
export async function confirmPayment(
  actor: JmlActor,
  caseId: string,
  input: { paymentDate: Date; paymentReference: string },
) {
  await loadCaseFor(actor, caseId, "jml.manageSettlement", "LEAVE");
  const ctx = await loadContext(caseId);
  if (!ctx.settlement?.approvedAt)
    throw new JmlError("The settlement must be approved before payment is confirmed.", 409);
  if (ctx.settlement.paymentConfirmedAt) throw new JmlError("Payment is already confirmed.", 409);
  await auditedTransaction((tx) =>
    tx.leaveSettlement.update({
      where: { caseId, paymentConfirmedAt: null },
      data: {
        paymentDate: input.paymentDate,
        paymentReference: input.paymentReference,
        paymentConfirmedAt: input.paymentDate,
        paymentConfirmedById: actor.userId,
      },
      select: { caseId: true },
    }),
  );
  const windowRow = (await statutoryRows()).find((r) => r.key === "settlement.paymentWindowDays");
  const lds = ctx.leaveDetail.lastDayOfService;
  const due = lds && windowRow ? paymentDeadline(lds, Number(windowRow.value)) : null;
  return { confirmed: true, dueBy: due, withinWindow: due ? input.paymentDate <= due : null };
}

/** For closure: the settlement side of AC-10.7. */
export async function settlementClosureProblems(caseId: string): Promise<string[]> {
  const s = await prisma.leaveSettlement.findUnique({
    where: { caseId },
    select: { approvedAt: true, paymentConfirmedAt: true, paymentReference: true },
  });
  const verdict = canCloseSettlement({
    approvedAt: s?.approvedAt ?? null,
    paymentConfirmedAt: s?.paymentConfirmedAt ?? null,
    paymentReference: s?.paymentReference ?? null,
  });
  return verdict.allowed ? [] : verdict.reasons;
}
