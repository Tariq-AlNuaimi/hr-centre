import { auditedTransaction, prisma } from "@/lib/prisma";
import { canFor, loadCaseFor, MANAGE_PERMISSION, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { openMoney, sealMoney } from "../money/crypto";

/**
 * The asset register (Offboarding §9.8.1, D3: one register for the whole
 * lifecycle). An asset is ISSUED on a JOIN (or any) case and RETURNED on the
 * LEAVE case it was attached to at activation. The deduction amount is
 * Restricted: only `jml.manageSettlement` may send it, it is sealed at rest,
 * and only `jml.viewSettlement` reads it back.
 */

const TERMINAL = ["CLOSED", "CANCELLED", "ARCHIVED", "COMPLETED"];

const ASSET_SELECT = {
  id: true,
  assetType: { select: { id: true, label: true } },
  description: true,
  identifier: true,
  issuedDate: true,
  conditionAtIssue: true,
  returnDueDate: true,
  returnedDate: true,
  conditionAtReturn: true,
  deductionApplicable: true,
  deductionAmountEnc: true,
  writtenOff: true,
  writtenOffReason: true,
  issuedOnCaseId: true,
  returnedOnCaseId: true,
  verifiedBy: { select: { name: true } },
} as const;

/** F7: active types for any HR user who may work a case — not an admin list. */
export async function activeAssetTypes() {
  return prisma.jmlAssetType.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true, label: true },
    take: 100,
  });
}

export async function listCaseAssets(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.view");
  const seeMoney = canFor(actor, "jml.viewSettlement", kase.subject);
  const rows = await prisma.jmlAsset.findMany({
    where: { OR: [{ issuedOnCaseId: caseId }, { returnedOnCaseId: caseId }] },
    orderBy: [{ createdAt: "asc" }],
    select: ASSET_SELECT,
    take: 200,
  });
  return {
    assets: rows.map(({ deductionAmountEnc, ...a }) => ({
      ...a,
      deductionAmount: seeMoney
        ? openMoney("asset", a.id, "deductionAmount", deductionAmountEnc)
        : undefined,
    })),
    outstanding: rows.filter(
      (a) => a.returnedOnCaseId === caseId && !a.returnedDate && !a.writtenOff,
    ).length,
    can: {
      manage: canFor(actor, MANAGE_PERMISSION[kase.caseType], kase.subject),
      deduction: canFor(actor, "jml.manageSettlement", kase.subject),
      seeMoney,
    },
  };
}

export async function addAsset(
  actor: JmlActor,
  caseId: string,
  input: {
    assetTypeId: string;
    description: string | null;
    identifier: string | null;
    issuedDate: Date | null;
    conditionAtIssue: string | null;
    returnDueDate: Date | null;
  },
) {
  const head = await prisma.jmlCase.findUnique({
    where: { id: caseId },
    select: { caseType: true },
  });
  if (!head) throw new JmlError("Case not found", 404);
  const kase = await loadCaseFor(actor, caseId, MANAGE_PERMISSION[head.caseType]);
  if (kase.status === "DRAFT" || TERMINAL.includes(kase.status)) {
    throw new JmlError("Assets are recorded on an active case.", 409);
  }
  const type = await prisma.jmlAssetType.findUnique({
    where: { id: input.assetTypeId },
    select: { active: true },
  });
  if (!type?.active) throw new JmlError("Choose an active asset type.", 422);
  let returnDueDate = input.returnDueDate;
  if (kase.caseType === "LEAVE" && !returnDueDate) {
    const d = await prisma.leaveCaseDetail.findUnique({
      where: { caseId },
      select: { lastPhysicalWorkingDay: true, exitType: true, noticeStartDate: true },
    });
    returnDueDate =
      d?.exitType === "SUMMARY_DISMISSAL" ? d.noticeStartDate : (d?.lastPhysicalWorkingDay ?? null);
    if (!returnDueDate)
      throw new JmlError("Set the Last Physical Working Day before adding assets to return.", 409);
  }
  const leave = kase.caseType === "LEAVE";
  const created = await auditedTransaction((tx) =>
    tx.jmlAsset.create({
      data: {
        employeeId: kase.employeeId,
        assetTypeId: input.assetTypeId,
        description: input.description,
        identifier: input.identifier,
        issuedDate: input.issuedDate ?? (leave ? null : new Date()),
        conditionAtIssue: input.conditionAtIssue,
        returnDueDate,
        issuedOnCaseId: leave ? null : caseId,
        returnedOnCaseId: leave ? caseId : null,
      },
      select: { id: true },
    }),
  );
  return created;
}

async function loadAsset(actor: JmlActor, caseId: string, assetId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageLeavers", "LEAVE");
  const asset = await prisma.jmlAsset.findUnique({
    where: { id: assetId },
    select: { id: true, returnedOnCaseId: true, returnedDate: true, writtenOff: true },
  });
  if (!asset || asset.returnedOnCaseId !== caseId) throw new JmlError("Asset not found", 404);
  if (asset.returnedDate) throw new JmlError("This asset's return is already recorded.", 409);
  if (asset.writtenOff) throw new JmlError("This asset was written off.", 409);
  return { kase, asset };
}

/** AC-7.3: returned date + condition + verifier (the actor); deduction ⇔ a positive amount. */
export async function recordAssetReturn(
  actor: JmlActor,
  caseId: string,
  assetId: string,
  input: {
    returnedDate: Date;
    conditionAtReturn: string;
    deductionApplicable: boolean;
    deductionAmount: string | null;
  },
) {
  const { kase } = await loadAsset(actor, caseId, assetId);
  if (input.deductionAmount !== null && !canFor(actor, "jml.manageSettlement", kase.subject)) {
    throw new JmlError("Only HR users who manage settlements may record a deduction amount.", 403);
  }
  const positive = input.deductionAmount !== null && Number(input.deductionAmount) > 0;
  if (input.deductionApplicable !== positive) {
    throw new JmlError(
      input.deductionApplicable
        ? "A deduction needs a positive amount."
        : "An amount was given but the deduction is not marked applicable.",
      422,
    );
  }
  await auditedTransaction((tx) =>
    tx.jmlAsset.update({
      where: { id: assetId, returnedDate: null },
      data: {
        returnedDate: input.returnedDate,
        conditionAtReturn: input.conditionAtReturn,
        deductionApplicable: input.deductionApplicable,
        deductionAmountEnc: sealMoney("asset", assetId, "deductionAmount", input.deductionAmount),
        verifiedById: actor.userId,
      },
      select: { id: true },
    }),
  );
  return { returned: true };
}

/** A lost or retained asset is written off with a reason (the column existed with no route — F6). */
export async function writeOffAsset(
  actor: JmlActor,
  caseId: string,
  assetId: string,
  reason: string,
) {
  const { kase } = await loadAsset(actor, caseId, assetId);
  if (!canFor(actor, "jml.manageSettlement", kase.subject)) {
    throw new JmlError(
      "Writing an asset off is a settlement decision (Senior HR or HR Manager).",
      403,
    );
  }
  await auditedTransaction((tx) =>
    tx.jmlAsset.update({
      where: { id: assetId, returnedDate: null, writtenOff: false },
      data: { writtenOff: true, writtenOffReason: reason, verifiedById: actor.userId },
      select: { id: true },
    }),
  );
  return { writtenOff: true };
}
