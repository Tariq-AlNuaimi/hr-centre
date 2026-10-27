import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AiKind } from "@/lib/validations/hiring/ai";
import { can, type HiringActor } from "../access";
import { loadCandidate } from "../candidates";
import { HiringRuleError } from "../http";
import { canReveal } from "../interview-rules";
import { panelAiMode } from "../interview-views";
import { loadInterview } from "../interviews";
import { loadRequisition } from "../requisitions";
import { aiComplete, aiErrorMessage, AiError } from "./engine";
import { buildPrompt, fitFields, KIND_FEATURE, SkillInputError, type FitJson } from "./skills";
import { extractJson, isRawOnly } from "./text";

/**
 * Click-to-run AI insights (Interview Hub `/api/ai/insight`). The target is
 * fixed by the kind — jd → requisition, fit → candidate, transcript →
 * interview — so there is no free (entityType, entityId) pair to forge.
 * Running needs `hiring.manage` on the record; reading needs `hiring.view`,
 * and a FIT or TRANSCRIPT verdict is a judgment: a panelist sees it only once
 * the panel mode reveals it (anti-anchoring, Interview Hub T-16/T-22).
 */

const ENTITY: Record<AiKind, string> = {
  jd: "requisition",
  fit: "candidate",
  transcript: "interview",
};
const NOT_FOUND = () => new HiringRuleError("Not found.", 404);

async function subjectFor(
  actor: HiringActor,
  kind: AiKind,
  id: string,
  permission: "hiring.view" | "hiring.manage",
) {
  if (kind === "jd") return (await loadRequisition(actor, id, permission))?.subject ?? null;
  if (kind === "fit") return (await loadCandidate(actor, id, permission))?.subject ?? null;
  return (await loadInterview(actor, id, permission))?.subject ?? null;
}

/** May this (already scope-checked) reader see the judgment on this record? */
async function judgmentVisible(actor: HiringActor, kind: AiKind, id: string): Promise<boolean> {
  if (kind === "jd") return true;
  const where =
    kind === "fit"
      ? { candidateId: id, panelists: { some: { userId: actor.userId } } }
      : { id, panelists: { some: { userId: actor.userId } } };
  const panels = await prisma.hiringInterview.findMany({ where, select: { id: true }, take: 50 });
  if (panels.length === 0) return true;
  const mode = await panelAiMode();
  const submitted = await prisma.hiringScorecard.count({
    where: {
      interviewId: { in: panels.map((p) => p.id) },
      panelistId: actor.userId,
      submitted: true,
    },
  });
  return canReveal(mode, submitted >= panels.length);
}

export async function latestInsight(actor: HiringActor, kind: AiKind, entityId: string) {
  const subject = await subjectFor(actor, kind, entityId, "hiring.view");
  if (!subject) throw NOT_FOUND();
  if (!can(actor, "hiring.manage", subject) && !(await judgmentVisible(actor, kind, entityId))) {
    return { insight: null, hidden: true };
  }
  const row = await prisma.hiringAiInsight.findFirst({
    where: { entityType: ENTITY[kind], entityId, kind },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, model: true, output: true, createdAt: true },
  });
  return { insight: row ? view(row) : null, hidden: false };
}

async function applyResult(kind: AiKind, entityId: string, json: unknown) {
  if (kind === "fit" && json && !isRawOnly(json)) {
    const f = fitFields(json as FitJson);
    await prisma.hiringCandidate.update({
      where: { id: entityId },
      data: {
        ...(f.overall !== null ? { overallScore: f.overall } : {}),
        ...(f.rationale !== null ? { aiRationale: f.rationale } : {}),
        ...(f.recommendation !== null ? { aiWhyNot: f.recommendation } : {}),
        ...(f.scores ? { fitScores: f.scores as Prisma.InputJsonValue } : {}),
      },
      select: { id: true },
    });
  }
  if (kind === "transcript" && json && !isRawOnly(json)) {
    await prisma.hiringInterview.update({
      where: { id: entityId },
      data: { aiAnalysis: json as Prisma.InputJsonValue },
      select: { id: true },
    });
  }
}

export async function runInsight(
  actor: HiringActor,
  kind: AiKind,
  entityId: string,
  transcript?: string,
) {
  const subject = await subjectFor(actor, kind, entityId, "hiring.manage");
  if (!subject) throw NOT_FOUND();
  let built;
  try {
    built = await buildPrompt(kind, entityId, transcript);
  } catch (e) {
    if (e instanceof SkillInputError) throw new HiringRuleError(e.message, 400);
    throw e;
  }
  let result;
  try {
    result = await aiComplete({ ...built, feature: KIND_FEATURE[kind], userId: actor.userId });
  } catch (e) {
    const { status, message } = aiErrorMessage(e);
    throw new HiringRuleError(
      message,
      status,
      e instanceof AiError ? e.code.toUpperCase() : undefined,
    );
  }
  if (!result) throw aiOff();
  const parsed = extractJson(result.text);
  const json = isRawOnly(parsed) ? null : parsed;
  const row = await prisma.hiringAiInsight.create({
    data: {
      entityType: ENTITY[kind],
      entityId,
      kind,
      model: result.model,
      // Nested under `aiOutput` so the audit scrub (by field name, any depth) redacts it.
      output: {
        aiOutput: { text: result.text, ...(json ? { json: json as Prisma.InputJsonValue } : {}) },
      },
      summary: result.text.replace(/\s+/g, " ").trim().slice(0, 280),
      createdById: actor.userId,
    },
    select: { id: true, kind: true, model: true, output: true, createdAt: true },
  });
  await applyResult(kind, entityId, json);
  return { insight: view(row), jsonParseFailed: json === null };
}

type Row = { id: string; kind: string; model: string | null; output: unknown; createdAt: Date };
function view(r: Row) {
  const o = (r.output as { aiOutput?: { text?: unknown; json?: unknown } } | null)?.aiOutput ?? {};
  return {
    id: r.id,
    kind: r.kind,
    model: r.model,
    createdAt: r.createdAt,
    text: typeof o.text === "string" ? o.text : "",
    json: o.json ?? null,
  };
}

export const aiOff = () =>
  new HiringRuleError(
    "AI isn't set up for Hiring yet. A hiring administrator can connect a provider in Hiring settings.",
    503,
    "AI_NOT_CONFIGURED",
  );
