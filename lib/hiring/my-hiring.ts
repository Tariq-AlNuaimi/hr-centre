import { prisma } from "@/lib/prisma";
import { LINEAR_STAGES, stepForStage, type Stage } from "@/lib/hiring/stage-rules";

/**
 * "My hiring" — the hiring manager's own view (UX review tickets P1-9,
 * docs/blueprints/ux-p1-team.md US-2; Greenhouse's Hiring Manager Review):
 * the requisitions they own with candidates per phase, the candidates waiting
 * for THEIR decision, and the job descriptions waiting for their signature.
 * Keyed on `hiringManagerId` (the requisition's own field), so it shows only
 * what the person already owns. Candidate rows carry name and stage only —
 * no contact, nationality or pay. Bounded throughout.
 */

const LIVE = ["DRAFT", "PENDING_APPROVAL", "OPEN", "ON_HOLD", "REOPENED"] as const;
/** The stages at which the hiring manager decides (after HR's shortlist; at the decision). */
export const HM_REVIEW_STAGES: readonly Stage[] = ["SHORTLISTED", "DECISION_PENDING"];

/** The next stage on the linear path (an "Advance"), or null at the end. */
export function nextStage(stage: Stage): Stage | null {
  const i = LINEAR_STAGES.indexOf(stage);
  return i >= 0 && i < LINEAR_STAGES.length - 1 ? LINEAR_STAGES[i + 1]! : null;
}

export async function myHiring(userId: string, now: Date = new Date()) {
  const requisitions = await prisma.hiringRequisition.findMany({
    where: { hiringManagerId: userId, status: { in: [...LIVE] } },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: {
      id: true,
      title: true,
      status: true,
      jdStatus: true,
      jdVersion: true,
      createdAt: true,
    },
  });
  const ids = requisitions.map((r) => r.id);
  const awaitingJd = requisitions.filter((r) => r.jdStatus === "AWAITING_SIGNOFF");
  const [byStage, awaiting, signed] = ids.length
    ? await Promise.all([
        prisma.hiringCandidate.groupBy({
          by: ["requisitionId", "stage"],
          where: { requisitionId: { in: ids } },
          _count: { _all: true },
        }),
        prisma.hiringCandidate.findMany({
          where: { requisitionId: { in: ids }, stage: { in: [...HM_REVIEW_STAGES] } },
          orderBy: { updatedAt: "asc" },
          take: 30,
          select: { id: true, name: true, stage: true, requisitionId: true, updatedAt: true },
        }),
        // The hiring-manager signatures already on each awaiting JD's current version.
        prisma.hiringJdSignoff.findMany({
          where: {
            requisitionId: { in: awaitingJd.map((r) => r.id) },
            signatory: "HIRING_MANAGER",
          },
          select: { requisitionId: true, version: true },
        }),
      ])
    : [[], [], []];
  const signedNow = new Set(signed.map((s) => `${s.requisitionId}:${s.version}`));

  const titleOf = new Map(requisitions.map((r) => [r.id, r.title]));
  const DAY = 86_400_000;
  return {
    requisitions: requisitions.map((r) => {
      const steps = Array<number>(8).fill(0);
      for (const g of byStage) {
        if (g.requisitionId === r.id && g.stage !== "REJECTED" && g.stage !== "WITHDRAWN")
          steps[stepForStage(g.stage)]! += g._count._all;
      }
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        daysOpen: Math.max(0, Math.floor((now.getTime() - r.createdAt.getTime()) / DAY)),
        perStep: steps.slice(1),
      };
    }),
    awaitingReview: awaiting.map((c) => ({
      id: c.id,
      name: c.name,
      stage: c.stage as Stage,
      next: nextStage(c.stage as Stage),
      requisition: { id: c.requisitionId!, title: titleOf.get(c.requisitionId!) ?? "" },
      waitingDays: Math.max(0, Math.floor((now.getTime() - c.updatedAt.getTime()) / DAY)),
    })),
    jdSignoffs: awaitingJd
      .filter((r) => !signedNow.has(`${r.id}:${r.jdVersion}`))
      .map((r) => ({ id: r.id, title: r.title })),
  };
}
