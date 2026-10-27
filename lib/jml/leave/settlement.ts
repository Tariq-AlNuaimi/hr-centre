import { auditedTransaction, prisma } from "@/lib/prisma";
import { decryptSalary } from "@/lib/pms/employee-select";
import type { StatutoryRow } from "@/lib/statutory/parameters";
import { canFor, loadCaseFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { openMoney, sealMoney } from "../money/crypto";
import { checkHolders } from "./approval-rules";
import {
  computeGratuity,
  computeLeave,
  GratuityUnavailableError,
  money,
  serviceMonths,
  settlementTotals,
  visaCostRecoveryApplies,
} from "./gratuity";
import { paymentDeadline } from "./settlement-rules";

/**
 * The final settlement (§16.1, C2–C5) — HR Offboarding `/api/settlement/*`.
 * Hire date and basic wage come from the core record (F18: the source asked
 * for them to be typed in). Every figure is sealed in one envelope; only
 * `jml.viewSettlement` opens it. Lines need `jml.manageSettlement`; approval
 * needs `jml.approveSettlement` AND both Final Settlement Approval signatures
 * (F5); payment confirmation records the C5 window.
 */

export type Figures = {
  basicMonthly: number;
  leaveBalanceDays: number;
  serviceDays: number;
  preSplitDays: number;
  postSplitDays: number;
  dailyRate: number;
  dismissalFactor: number;
  gratuityPreSplitAmount: number;
  gratuityPostSplitAmount: number;
  gratuityTotal: number;
  leaveOutcome: "ENCASHMENT" | "DEDUCTION" | "NONE";
  leaveEncashmentAmount: number;
  leaveDeductionAmount: number;
  outstandingSalaryAmount: number;
  additionsTotal: number;
  deductionsTotal: number;
  grossTotalAmount: number;
  netTotalAmount: number;
};

const sealFigures = (caseId: string, f: Figures) =>
  sealMoney("settlement", caseId, "figures", JSON.stringify(f));
const openFigures = (caseId: string, env: string | null): Figures | null => {
  const raw = openMoney("settlement", caseId, "figures", env);
  return raw ? (JSON.parse(raw) as Figures) : null;
};

export async function statutoryRows(): Promise<StatutoryRow[]> {
  const rows = await prisma.statutoryParameter.findMany({
    select: { key: true, value: true, effectiveFrom: true, effectiveTo: true, verified: true },
    take: 500,
  });
  return rows.map((r) => ({ ...r, value: r.value.toString() }));
}

export async function loadContext(caseId: string) {
  const kase = await prisma.jmlCase.findUniqueOrThrow({
    where: { id: caseId },
    select: {
      status: true,
      caseRef: true,
      leaveDetail: {
        select: {
          exitType: true,
          nationality: true,
          lastDayOfService: true,
          settlementApplicable: true,
          migrated: true,
        },
      },
      employee: { select: { odooId: true, dateOfJoining: true, basicSalaryEnc: true } },
      settlement: true,
      approvals: {
        where: { approvalType: "FINAL_SETTLEMENT_APPROVAL" },
        select: { approvalType: true, holderRoleKey: true, status: true },
      },
    },
  });
  if (!kase.leaveDetail) throw new JmlError("Case not found", 404);
  return { ...kase, leaveDetail: kase.leaveDetail };
}

async function linesOf(caseId: string, open: boolean) {
  const rows = await prisma.leaveSettlementLine.findMany({
    where: { caseId },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      lineType: true,
      deductionType: true,
      description: true,
      lineAmountEnc: true,
      reasonCode: true,
      documentaryReference: true,
      assetId: true,
      authorisedBy: { select: { name: true } },
    },
  });
  return rows.map(({ lineAmountEnc, ...l }) => ({
    ...l,
    lineAmount: open ? openMoney("settlementLine", l.id, "lineAmount", lineAmountEnc) : undefined,
  }));
}

type SettlementRow = NonNullable<Awaited<ReturnType<typeof loadContext>>["settlement"]>;

function settlementStatus(s: SettlementRow | null) {
  return {
    calculatedAt: s?.calculatedAt ?? null,
    provisional: s?.provisional ?? true,
    unverifiedKeys: s?.unverifiedKeys ?? [],
    recalculationRequired: s?.recalculationRequired ?? false,
    signatureReference: s?.signatureReference ?? null,
    approvedAt: s?.approvedAt ?? null,
    paymentDate: s?.paymentDate ?? null,
    paymentReference: s?.paymentReference ?? null,
    paymentConfirmedAt: s?.paymentConfirmedAt ?? null,
  };
}

async function deadlineFor(lds: Date | null): Promise<Date | null> {
  const windowRow = (await statutoryRows()).find((r) => r.key === "settlement.paymentWindowDays");
  return lds && windowRow ? paymentDeadline(lds, Number(windowRow.value)) : null;
}

export async function getSettlement(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.view", "LEAVE");
  const ctx = await loadContext(caseId);
  const seeMoney = canFor(actor, "jml.viewSettlement", kase.subject);
  const s = ctx.settlement;
  return {
    applicable: ctx.leaveDetail.settlementApplicable,
    ...settlementStatus(s),
    hireDate: s?.hireDate ?? ctx.employee.dateOfJoining,
    paymentDeadline: await deadlineFor(ctx.leaveDetail.lastDayOfService),
    signatures: checkHolders("FINAL_SETTLEMENT_APPROVAL", ctx.approvals),
    figures: seeMoney && s ? openFigures(caseId, s.figuresEnc) : null,
    lines: s ? await linesOf(caseId, seeMoney) : [],
    can: {
      seeMoney,
      manage: canFor(actor, "jml.manageSettlement", kase.subject),
      approve: canFor(actor, "jml.approveSettlement", kase.subject),
    },
  };
}

function basicOf(e: { odooId: string; basicSalaryEnc: string | null }): number | null {
  const v = decryptSalary(e.basicSalaryEnc, e.odooId);
  return v === null ? null : Number(v);
}

async function lineTotals(caseId: string) {
  const lines = await prisma.leaveSettlementLine.findMany({
    where: { caseId },
    select: { id: true, lineType: true, lineAmountEnc: true },
    take: 100,
  });
  const amount = (l: (typeof lines)[number]) =>
    Number(openMoney("settlementLine", l.id, "lineAmount", l.lineAmountEnc) ?? NaN);
  const additions = lines.filter((l) => l.lineType === "ADDITION").map(amount);
  const deductions = lines.filter((l) => l.lineType === "DEDUCTION").map(amount);
  if ([...additions, ...deductions].some((n) => !Number.isFinite(n))) {
    throw new JmlError(
      "A settlement line cannot be read (the salary encryption key changed?). Nothing was calculated.",
      503,
    );
  }
  return { additions, deductions };
}

/** AC-10.2–10.4: gratuity on the record's hire date and basic wage, leave at LDS, totals. */
export async function calculateSettlement(
  actor: JmlActor,
  caseId: string,
  input: { leaveBalanceDays: number; outstandingSalaryAmount: number },
) {
  await loadCaseFor(actor, caseId, "jml.manageSettlement", "LEAVE");
  const ctx = await loadContext(caseId);
  const d = ctx.leaveDetail;
  if (!d.settlementApplicable) throw new JmlError("No settlement applies to this exit.", 409);
  if (!d.lastDayOfService) throw new JmlError("Set the Last Day of Service first.", 409);
  if (ctx.settlement?.approvedAt)
    throw new JmlError("The settlement is approved; it can no longer be recalculated.", 409);
  if (!ctx.employee.dateOfJoining) {
    throw new JmlError(
      "The employee record has no date of joining — record it on the employee before calculating.",
      422,
    );
  }
  const basic = basicOf(ctx.employee);
  if (basic === null) {
    throw new JmlError(
      "The employee record has no basic salary (or it cannot be read) — record it before calculating.",
      422,
    );
  }
  const rows = await statutoryRows();
  let g;
  try {
    g = computeGratuity(
      {
        hireDate: ctx.employee.dateOfJoining,
        lastDayOfService: d.lastDayOfService,
        basicMonthly: basic,
        exitType: d.exitType,
      },
      rows,
    );
  } catch (e) {
    if (e instanceof GratuityUnavailableError) throw new JmlError(e.message, 422);
    throw e;
  }
  const leave = computeLeave(
    { balanceDaysAtLastDayOfService: input.leaveBalanceDays, basicMonthly: basic },
    rows,
    d.lastDayOfService,
  );
  const { additions, deductions } = await lineTotals(caseId);
  const encash = leave.kind === "ENCASHMENT" ? leave.amount : 0;
  const totals = settlementTotals({
    gratuityTotal: g.total,
    leaveEncashment: encash,
    outstandingSalary: input.outstandingSalaryAmount,
    additions,
    deductions,
  });
  const figures: Figures = {
    basicMonthly: basic,
    leaveBalanceDays: input.leaveBalanceDays,
    serviceDays: g.serviceDays,
    preSplitDays: g.preSplitDays,
    postSplitDays: g.postSplitDays,
    dailyRate: money(g.dailyRate),
    dismissalFactor: g.dismissalEntitlementFactor,
    gratuityPreSplitAmount: g.preSplitAmount,
    gratuityPostSplitAmount: g.postSplitAmount,
    gratuityTotal: g.total,
    leaveOutcome: leave.kind,
    leaveEncashmentAmount: encash,
    leaveDeductionAmount: leave.kind === "DEDUCTION" ? leave.amount : 0,
    outstandingSalaryAmount: money(input.outstandingSalaryAmount),
    additionsTotal: money(additions.reduce((a, b) => a + b, 0)),
    deductionsTotal: money(deductions.reduce((a, b) => a + b, 0)),
    grossTotalAmount: totals.gross,
    netTotalAmount: totals.net,
  };
  const data = {
    figuresEnc: sealFigures(caseId, figures),
    provisional: g.provisional,
    unverifiedKeys: g.unverifiedParameters,
    hireDate: ctx.employee.dateOfJoining,
    calculatedAt: new Date(),
    calculatedById: actor.userId,
    recalculationRequired: false,
  };
  await auditedTransaction((tx) =>
    ctx.settlement
      ? tx.leaveSettlement.update({
          where: { caseId, approvedAt: null },
          data,
          select: { caseId: true },
        })
      : tx.leaveSettlement.create({ data: { caseId, ...data }, select: { caseId: true } }),
  );
  const visa = visaCostRecoveryApplies(
    {
      nationality: d.nationality,
      serviceMonths: serviceMonths(ctx.employee.dateOfJoining, d.lastDayOfService),
    },
    rows,
    d.lastDayOfService,
  );
  return {
    calculated: true,
    provisional: g.provisional,
    unverifiedKeys: g.unverifiedParameters,
    leaveOutcome: leave.kind,
    visaCostRecovery: visa,
  };
}
