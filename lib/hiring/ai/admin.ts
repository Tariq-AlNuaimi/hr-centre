import { prisma } from "@/lib/prisma";
import {
  budgetEnvelopeSchema,
  DEFAULT_SCORING_WEIGHTS,
  scoringWeightsSchema,
  type AiLimitsInput,
  type AiProviderInput,
  type GeneralSettingsInput,
} from "@/lib/validations/hiring/ai";
import { COO_THRESHOLD_OMR } from "../approval-chain";
import { loadApprovalConfig } from "../approval-config";
import { asPanelAiMode } from "../interview-rules";
import { sealSecretSetting } from "../comp-crypto";
import { readSettings, writeSetting } from "../settings";
import { startOfUtcDay, estimateSpend } from "./budget";
import { getAiLimits, publicAiConfig } from "./config";
import { aiComplete, aiErrorMessage } from "./engine";

/**
 * Hiring → Settings → AI (Interview Hub `/api/settings/ai*`). Hiring admins
 * only (the routes check). The key is sealed before it reaches the settings
 * store and written as `{ apiKey }`, so its audit row is scrubbed; it is never
 * returned — the screen learns only whether one is set and from where.
 */

export async function saveAiProvider(input: AiProviderInput) {
  await writeSetting("ai.provider", input.provider);
  await writeSetting("ai.baseUrl", input.baseUrl);
  await writeSetting("ai.model", input.model);
  if (input.pdfVision !== undefined) await writeSetting("ai.pdfVision", input.pdfVision);
  if (input.clearKey) await writeSetting("ai.apiKey", { apiKey: "" });
  else if (input.apiKey)
    await writeSetting("ai.apiKey", { apiKey: sealSecretSetting("ai.apiKey", input.apiKey) });
}

export async function saveAiLimits(input: AiLimitsInput) {
  await writeSetting("ai.killSwitch", input.killSwitch);
  await writeSetting("ai.dailyTokenCap", input.dailyTokenCap);
  await writeSetting("ai.dailySpendCap", input.dailySpendCap);
  await writeSetting("ai.timeoutMs", input.timeoutMs);
  await writeSetting("ai.pricePer1kIn", input.pricePer1kIn);
  await writeSetting("ai.pricePer1kOut", input.pricePer1kOut);
}

const USAGE_DAYS = 14;

/** Today's totals against the caps, and the last 14 days by feature (bounded group-by). */
export async function aiUsage() {
  const since = new Date(startOfUtcDay().getTime() - (USAGE_DAYS - 1) * 86_400_000);
  const [limits, today, byFeature] = await Promise.all([
    getAiLimits(),
    prisma.hiringAiUsage.aggregate({
      _sum: { tokensIn: true, tokensOut: true },
      _count: { _all: true },
      where: { createdAt: { gte: startOfUtcDay() } },
    }),
    prisma.hiringAiUsage.groupBy({
      by: ["feature"],
      where: { createdAt: { gte: since } },
      _sum: { tokensIn: true, tokensOut: true },
      _count: { _all: true },
      _avg: { latencyMs: true },
      orderBy: { feature: "asc" },
      take: 50,
    }),
  ]);
  const tin = today._sum.tokensIn ?? 0;
  const tout = today._sum.tokensOut ?? 0;
  return {
    limits,
    today: {
      calls: today._count._all,
      tokens: tin + tout,
      spend: estimateSpend(tin, tout, limits.pricePer1kIn || null, limits.pricePer1kOut || null),
    },
    days: USAGE_DAYS,
    byFeature: byFeature.map((f) => ({
      feature: f.feature,
      calls: f._count._all,
      tokens: (f._sum.tokensIn ?? 0) + (f._sum.tokensOut ?? 0),
      avgLatencyMs: Math.round(f._avg.latencyMs ?? 0),
    })),
  };
}

/** A few tokens to prove the provider answers. Skips the caps (admin diagnostic), never the egress check. */
export async function testAiConnection(userId: string) {
  const cfg = await publicAiConfig();
  if (!cfg.configured)
    return { ok: false, message: "Set a base URL, a model and an API key first." };
  const started = Date.now();
  try {
    const r = await aiComplete({
      prompt: "Reply with the single word: ok",
      maxTokens: 5,
      feature: "Connection test",
      userId,
      skipBudget: true,
    });
    if (!r) return { ok: false, message: "AI is not configured." };
    return { ok: true, message: `Connected to ${r.model} in ${Date.now() - started} ms.` };
  } catch (e) {
    return { ok: false, message: aiErrorMessage(e).message };
  }
}

/** The non-AI sections of Hiring settings, plus the companies they are keyed by. */
export async function generalSettings() {
  const [s, entities] = await Promise.all([
    readSettings(["ai.scoringWeights", "panel.aiMode", "budget.envelope", "approvals.config"]),
    prisma.orgEntity.findMany({
      orderBy: { code: "asc" },
      select: { code: true, name: true },
      take: 50,
    }),
  ]);
  const weights = scoringWeightsSchema.safeParse(s.get("ai.scoringWeights"));
  const budget = budgetEnvelopeSchema.safeParse(s.get("budget.envelope"));
  const approvals = await loadApprovalConfig();
  return {
    entities,
    weights: weights.success ? weights.data : DEFAULT_SCORING_WEIGHTS,
    panelAiMode: asPanelAiMode(s.get("panel.aiMode")),
    budget: budget.success ? budget.data : { entities: {} },
    approvals: approvals ?? { chains: {}, cooThreshold: COO_THRESHOLD_OMR },
  };
}

export async function saveGeneral(input: GeneralSettingsInput) {
  if (input.section === "weights") return writeSetting("ai.scoringWeights", input.value);
  if (input.section === "panel") return writeSetting("panel.aiMode", input.value.mode);
  if (input.section === "budget") return writeSetting("budget.envelope", input.value);
  return writeSetting("approvals.config", input.value);
}
