import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { HiringActor } from "../access";
import type { LoadedRequisition } from "../requisitions";
import { aiComplete, AiError } from "./engine";
import { aiOff } from "./insights";
import { buildPrompt, fitFields, SkillInputError, type FitJson } from "./skills";
import { extractJson, isRawOnly } from "./text";
import { aiConfigured } from "./config";

/**
 * "Run AI screen" (Interview Hub `lib/services/screening.ts`). Scores the
 * requisition's NEW applications that have a CV profile and no score yet, a few
 * per request so one call stays well inside the function deadline; the screen
 * calls again until nothing is pending. Each write overwrites the same fit
 * fields, so a retried chunk never double-counts. A kill-switch or cap trip
 * halts the run — the rest stay pending, and the reply says why.
 */

export const SCREEN_CHUNK = 5;

const pendingWhere = (requisitionId: string): Prisma.HiringCandidateWhereInput => ({
  requisitionId,
  stage: "NEW_APPLICATION",
  erasedAt: null,
  deletedAt: null,
  OR: [{ overallScore: null }, { overallScore: 0 }],
});

export async function screenStatus(l: LoadedRequisition) {
  const [pending, noProfile] = await Promise.all([
    prisma.hiringCandidate.count({
      where: { ...pendingWhere(l.req.id), profileData: { not: Prisma.DbNull } },
    }),
    prisma.hiringCandidate.count({
      where: { ...pendingWhere(l.req.id), profileData: { equals: Prisma.DbNull } },
    }),
  ]);
  return { pending, noProfile, configured: await aiConfigured() };
}

type Outcome = "scored" | "failed" | "halted";

async function scoreOne(id: string, userId: string): Promise<Outcome> {
  try {
    const built = await buildPrompt("fit", id);
    const result = await aiComplete({ ...built, feature: "AI screen (fit)", userId });
    if (!result) return "failed";
    const json = extractJson(result.text);
    if (isRawOnly(json)) return "failed";
    const f = fitFields(json as FitJson);
    if (f.overall === null) return "failed";
    await prisma.hiringCandidate.update({
      where: { id },
      data: {
        overallScore: f.overall,
        aiRationale: f.rationale,
        aiWhyNot: f.recommendation,
        ...(f.scores ? { fitScores: f.scores as Prisma.InputJsonValue } : {}),
      },
      select: { id: true },
    });
    return "scored";
  } catch (e) {
    if (e instanceof AiError && (e.code === "budget_exceeded" || e.code === "kill_switch"))
      return "halted";
    if (e instanceof SkillInputError) return "failed";
    return "failed";
  }
}

/** One chunk. `skip` carries ids that already failed this run so they are not retried forever. */
export async function screenChunk(
  actor: HiringActor,
  l: LoadedRequisition,
  skip: readonly string[],
) {
  if (!(await aiConfigured())) throw aiOff();
  const ids = (
    await prisma.hiringCandidate.findMany({
      where: {
        ...pendingWhere(l.req.id),
        profileData: { not: Prisma.DbNull },
        id: { notIn: [...skip] },
      },
      orderBy: { createdAt: "asc" },
      take: SCREEN_CHUNK,
      select: { id: true },
    })
  ).map((r) => r.id);
  let scored = 0;
  const failed: string[] = [];
  let halted = false;
  for (const id of ids) {
    const o = await scoreOne(id, actor.userId);
    if (o === "halted") {
      halted = true;
      break;
    }
    if (o === "scored") scored += 1;
    else failed.push(id);
  }
  const remaining = await prisma.hiringCandidate.count({
    where: {
      ...pendingWhere(l.req.id),
      profileData: { not: Prisma.DbNull },
      id: { notIn: [...skip, ...failed] },
    },
  });
  return { scored, failed, halted, remaining };
}
