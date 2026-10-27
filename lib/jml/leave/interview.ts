import type { Prisma } from "@/generated/prisma/client";
import { auditedTransaction, prisma } from "@/lib/prisma";
import { canFor, loadCaseFor, type JmlActor } from "../access";
import { JmlError } from "../errors";
import { openMoney, sealMoney } from "../money/crypto";
import {
  checkAssessment,
  checkInterviewCapture,
  reasonsChanged,
  type TaxonomyCode,
} from "./interview-rules";

/**
 * The exit interview and its assessment (§12.3–12.4, AC-8/AC-9). Codes are
 * checked against the configured taxonomy (F9). The narrative is Restricted:
 * sealed, never reported or exported (AC-9.3). Assessment is `jml.assessExits`
 * (Senior HR / HR Manager); changing the coded reasons clears it.
 */

export async function activeTaxonomy(): Promise<TaxonomyCode[]> {
  const rows = await prisma.leaveReasonCode.findMany({
    select: {
      code: true,
      label: true,
      active: true,
      category: { select: { level1: true, active: true } },
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    take: 300,
  });
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    level1: r.category.level1,
    active: r.active && r.category.active,
  }));
}

const SELECT = {
  conducted: true,
  primaryL1: true,
  primaryL2Code: true,
  secondaryL2Code: true,
  narrativeEnc: true,
  destinationType: true,
  retentionAttempted: true,
  counterOfferMade: true,
  recommendScore: true,
  returnScore: true,
  interviewedAt: true,
  regrettable: true,
  preventable: true,
  preventionFactor: true,
  assessedAt: true,
  interviewer: { select: { name: true } },
  assessor: { select: { name: true } },
} as const satisfies Prisma.LeaveExitInterviewSelect;

export async function getInterview(actor: JmlActor, caseId: string) {
  const kase = await loadCaseFor(actor, caseId, "jml.view", "LEAVE");
  const row = await prisma.leaveExitInterview.findUnique({ where: { caseId }, select: SELECT });
  const { narrativeEnc, ...rest } = row ?? { narrativeEnc: null };
  return {
    interview: row
      ? { ...rest, narrative: openMoney("interview", caseId, "narrative", narrativeEnc) }
      : null,
    taxonomy: await activeTaxonomy(),
    can: {
      capture: canFor(actor, "jml.manageLeavers", kase.subject),
      assess: canFor(actor, "jml.assessExits", kase.subject),
    },
  };
}

export type InterviewInput = {
  conducted: "CONDUCTED" | "DECLINED";
  primaryL1: string;
  primaryL2Code: string;
  secondaryL2Code: string | null;
  narrative: string | null;
  destinationType: string | null;
  retentionAttempted: boolean | null;
  counterOfferMade: boolean | null;
  recommendScore: number;
  returnScore: number;
  interviewedAt: Date | null;
};

export async function saveInterview(actor: JmlActor, caseId: string, input: InterviewInput) {
  const kase = await loadCaseFor(actor, caseId, "jml.manageLeavers", "LEAVE");
  if (kase.status === "DRAFT")
    throw new JmlError("Activate the exit before recording the interview.", 409);
  if (["CANCELLED", "ARCHIVED"].includes(kase.status))
    throw new JmlError("This exit case is closed.", 409);
  const detail = await prisma.leaveCaseDetail.findUniqueOrThrow({
    where: { caseId },
    select: { exitType: true },
  });
  const problems = checkInterviewCapture(input, {
    exitType: detail.exitType,
    taxonomy: await activeTaxonomy(),
  });
  if (problems.length) throw new JmlError(problems.map((p) => p.message).join(" "), 422);
  const existing = await prisma.leaveExitInterview.findUnique({
    where: { caseId },
    select: { primaryL1: true, primaryL2Code: true, secondaryL2Code: true, assessedAt: true },
  });
  const clear = Boolean(existing?.assessedAt) && reasonsChanged(existing, input);
  const data = {
    conducted: input.conducted,
    primaryL1: input.primaryL1 as never,
    primaryL2Code: input.primaryL2Code,
    secondaryL2Code: input.secondaryL2Code,
    narrativeEnc: sealMoney("interview", caseId, "narrative", input.narrative?.trim() || null),
    destinationType: input.destinationType as never,
    retentionAttempted: input.retentionAttempted,
    counterOfferMade: input.counterOfferMade,
    recommendScore: input.recommendScore,
    returnScore: input.returnScore,
    interviewedAt: input.interviewedAt,
    ...(clear
      ? {
          regrettable: null,
          preventable: null,
          preventionFactor: null,
          assessorId: null,
          assessedAt: null,
        }
      : {}),
  };
  await auditedTransaction((tx) =>
    existing
      ? tx.leaveExitInterview.update({ where: { caseId }, data, select: { caseId: true } })
      : tx.leaveExitInterview.create({
          data: { caseId, interviewerId: actor.userId, ...data },
          select: { caseId: true },
        }),
  );
  return { saved: true, assessmentCleared: clear };
}

export async function assessInterview(
  actor: JmlActor,
  caseId: string,
  input: {
    regrettable: string | null;
    preventable: string | null;
    preventionFactor: string | null;
  },
) {
  await loadCaseFor(actor, caseId, "jml.assessExits", "LEAVE");
  const existing = await prisma.leaveExitInterview.findUnique({
    where: { caseId },
    select: { caseId: true },
  });
  if (!existing) throw new JmlError("Record the exit interview before assessing it.", 409);
  const problems = checkAssessment(input);
  if (problems.length) throw new JmlError(problems.map((p) => p.message).join(" "), 422);
  await auditedTransaction((tx) =>
    tx.leaveExitInterview.update({
      where: { caseId },
      data: {
        regrettable: input.regrettable as never,
        preventable: input.preventable as never,
        preventionFactor:
          input.preventable === "PREVENTABLE" ? (input.preventionFactor as never) : null,
        assessorId: actor.userId,
        assessedAt: new Date(),
      },
      select: { caseId: true },
    }),
  );
  return { assessed: true };
}
