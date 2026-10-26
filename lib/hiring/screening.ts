import { prisma } from "@/lib/prisma";
import { can, seesComp, type HiringActor } from "./access";
import { loadAssessmentConfig } from "./assessments";
import { openAmount } from "./comp-crypto";
import { applyStageChange } from "./candidate-stage";
import { employerLine, isWithinBand, screenVerdict, yearsFromProfile } from "./screen-verdict";
import { toOMRorNull } from "./money";
import type { LoadedRequisition } from "./requisitions";

/**
 * CV screening for one requisition (Interview Hub `/positions/[id]/screening`):
 * the applicants still at New application / CV screened, ranked by fit, each
 * with a verdict against the pass threshold and the band. The verdict uses the
 * real expectation; a reader without comp rights gets the verdict word, never
 * the figure or the band.
 */

const SCREEN_CAP = 500;
const SCREEN_STAGES = ["NEW_APPLICATION", "CV_SCREENED"] as const;

export async function screeningView(actor: HiringActor, l: LoadedRequisition) {
  const r = l.req;
  const pii = can(actor, "hiring.viewPii", l.subject);
  const comp = seesComp(actor, l.subject, {
    hiringManagerId: r.hiringManagerId,
    hmSeesSalary: r.hmSeesSalary,
  });
  const [rows, config] = await Promise.all([
    prisma.hiringCandidate.findMany({
      where: { requisitionId: r.id, stage: { in: [...SCREEN_STAGES] }, erasedAt: null },
      orderBy: [{ overallScore: "desc" }, { createdAt: "asc" }],
      take: SCREEN_CAP,
      select: {
        id: true,
        name: true,
        stage: true,
        source: true,
        overallScore: true,
        aiRationale: true,
        aiWhyNot: true,
        currentEmployer: true,
        profileData: true,
        salaryExpectationEnc: true,
      },
    }),
    loadAssessmentConfig(),
  ]);
  const bandMin = toOMRorNull(r.salaryBandMin, r.salaryCurrency);
  const bandMax = toOMRorNull(r.salaryBandMax, r.salaryCurrency);
  const applicants = rows.map((c) => {
    const expectation = openAmount("candidate", c.id, "salaryExpectation", c.salaryExpectationEnc);
    const score = c.overallScore && c.overallScore > 0 ? c.overallScore : null;
    const { verdict, why } = screenVerdict({
      fit: score,
      expectation,
      bandMin,
      bandMax,
      fitThreshold: config.passThreshold,
    });
    return {
      id: c.id,
      name: c.name,
      stage: c.stage,
      source: c.source,
      overallScore: pii ? score : null,
      aiNote: pii ? (c.aiWhyNot ?? c.aiRationale) : null,
      subLine: pii ? employerLine(c.currentEmployer, yearsFromProfile(c.profileData)) : null,
      salaryExpectation: comp ? expectation : null,
      verdict,
      why,
      withinBand: isWithinBand(expectation, bandMin, bandMax),
    };
  });
  return {
    requisition: { id: r.id, title: r.title },
    applicants,
    scoredCount: applicants.filter((a) => a.verdict !== null).length,
    fitThreshold: config.passThreshold,
    canSeeExpectation: comp,
    canManage: can(actor, "hiring.manage", l.subject),
  };
}

/**
 * Shortlist or reject a screened selection. Shortlisting walks NEW_APPLICATION
 * through CV_SCREENED first — the screen IS the mandatory step, so recording it
 * is what lets the shortlist move pass its gate honestly. (Interview Hub moved
 * straight to SHORTLISTED, which its own gate then refused.)
 */
export async function screeningAction(
  actor: HiringActor,
  l: LoadedRequisition,
  body: { action: "shortlist" | "reject"; candidateIds: string[] },
) {
  const rows = await prisma.hiringCandidate.findMany({
    where: {
      id: { in: [...new Set(body.candidateIds)] },
      requisitionId: l.req.id,
      stage: { in: [...SCREEN_STAGES] },
    },
    select: { id: true, stage: true, requisitionId: true, preferredAt: true },
    take: SCREEN_CAP,
  });
  for (const c of rows) {
    if (body.action === "reject") {
      await applyStageChange({
        cand: c,
        toStage: "REJECTED",
        movedById: actor.userId,
        reason: "Not shortlisted at CV screening",
      });
      continue;
    }
    let cand = c;
    if (c.stage === "NEW_APPLICATION") {
      await applyStageChange({
        cand: c,
        toStage: "CV_SCREENED",
        movedById: actor.userId,
        reason: "CV screened",
      });
      cand = { ...c, stage: "CV_SCREENED" };
    }
    await applyStageChange({
      cand,
      toStage: "SHORTLISTED",
      movedById: actor.userId,
      reason: "Shortlisted at CV screening",
    });
  }
  return { moved: rows.length, skipped: body.candidateIds.length - rows.length };
}
