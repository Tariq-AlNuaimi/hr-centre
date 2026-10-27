import { prisma } from "@/lib/prisma";
import { decideAiBudget, estimateSpend, startOfUtcDay } from "./budget";
import { getAiConfig, getAiLimits, type AiConfig } from "./config";
import { assertEgressAllowed } from "./egress";
import { redactPromptPii } from "./redact";

/**
 * The hiring AI engine — a plain `fetch` to the configured provider (Anthropic
 * Messages or any OpenAI-compatible /chat/completions, e.g. LiteLLM). No SDK
 * (`no-direct-anthropic-sdk`), one chokepoint: every hiring AI call passes the
 * egress check (with DNS), the kill-switch and daily caps, optional PII
 * redaction, a deadline, `redirect: "manual"`, and is metered to
 * `hiring_ai_usage`. "Not configured" is `null` (the route answers 503 with a
 * sentence); every other failure is a typed `AiError` with a secret-free message.
 */

export type AiErrorCode =
  | "kill_switch"
  | "budget_exceeded"
  | "timeout"
  | "auth"
  | "rate_limited"
  | "upstream"
  | "network"
  | "egress";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export type AiRequest = {
  prompt: string;
  system?: string;
  maxTokens?: number;
  pdfBase64?: string;
  /** Assessment paths set this: emails, phones and the names below never leave. */
  redactPii?: boolean;
  piiNames?: string[];
  feature: string;
  userId?: string | null;
  /** Only the admin connection test: it must work while capped. Egress is never skipped. */
  skipBudget?: boolean;
};

export type AiResult = { text: string; model: string; tokensIn: number; tokensOut: number };

export function aiErrorMessage(e: unknown): { status: number; message: string } {
  if (!(e instanceof AiError))
    return { status: 502, message: "The AI request failed. Please try again." };
  const map: Record<AiErrorCode, [number, string]> = {
    kill_switch: [503, "AI is switched off by an administrator."],
    budget_exceeded: [
      429,
      "Today's AI usage limit has been reached. It resets at midnight UTC, or an administrator can raise it in Hiring settings.",
    ],
    timeout: [504, "The AI provider did not respond in time. Please try again."],
    auth: [502, "The AI provider rejected the configured API key. Check it in Hiring settings."],
    rate_limited: [429, "The AI provider is rate-limiting requests. Please retry in a moment."],
    upstream: [
      502,
      `The AI provider returned an error${e.status ? ` (HTTP ${e.status})` : ""}. Please try again.`,
    ],
    network: [502, "Could not reach the AI provider. Check the base URL in Hiring settings."],
    egress: [502, "The AI base URL is not allowed (it must be a public https address)."],
  };
  const [status, message] = map[e.code];
  return { status, message };
}

function classify(status: number): AiError {
  if (status === 401 || status === 403)
    return new AiError("auth", "provider rejected the key", status);
  if (status === 429) return new AiError("rate_limited", "provider rate limit", status);
  return new AiError("upstream", "provider error", status);
}

async function assertBudget(): Promise<void> {
  const limits = await getAiLimits();
  let used = { tokensIn: 0, tokensOut: 0 };
  try {
    const agg = await prisma.hiringAiUsage.aggregate({
      _sum: { tokensIn: true, tokensOut: true },
      where: { createdAt: { gte: startOfUtcDay() } },
    });
    used = { tokensIn: agg._sum.tokensIn ?? 0, tokensOut: agg._sum.tokensOut ?? 0 };
  } catch {
    // A metering read blip must not take AI down; the cap re-engages on the next read.
  }
  const verdict = decideAiBudget({
    killSwitch: limits.killSwitch,
    todayTokens: used.tokensIn + used.tokensOut,
    todaySpend: estimateSpend(
      used.tokensIn,
      used.tokensOut,
      limits.pricePer1kIn || null,
      limits.pricePer1kOut || null,
    ),
    dailyTokenCap: limits.dailyTokenCap,
    dailySpendCap: limits.dailySpendCap,
  });
  if (!verdict.allowed) throw new AiError(verdict.code, verdict.reason);
}

async function record(
  req: AiRequest,
  model: string,
  tokensIn: number,
  tokensOut: number,
  latencyMs: number,
) {
  try {
    await prisma.hiringAiUsage.create({
      data: {
        feature: req.feature,
        model,
        tokensIn,
        tokensOut,
        latencyMs: Math.max(0, Math.round(latencyMs)),
        userId: req.userId ?? null,
      },
      select: { id: true },
    });
  } catch {
    // Metering never breaks an answer.
  }
}

const trimSlash = (u: string) => u.replace(/\/+$/, "");

function buildRequest(
  cfg: AiConfig,
  apiKey: string,
  req: AiRequest,
): { url: string; init: RequestInit } {
  const maxTokens = req.maxTokens ?? 3000;
  if (cfg.provider === "anthropic") {
    const b = trimSlash(cfg.baseUrl);
    const content: unknown[] = [];
    if (req.pdfBase64)
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: req.pdfBase64 },
      });
    content.push({ type: "text", text: req.prompt });
    return {
      url: b.endsWith("/v1/messages") ? b : `${b}/v1/messages`,
      init: {
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          ...(req.system ? { system: req.system } : {}),
          messages: [{ role: "user", content }],
        }),
      },
    };
  }
  const b = trimSlash(cfg.baseUrl);
  const user = req.pdfBase64
    ? [
        {
          type: "file",
          file: {
            filename: "document.pdf",
            file_data: `data:application/pdf;base64,${req.pdfBase64}`,
          },
        },
        { type: "text", text: req.prompt },
      ]
    : req.prompt;
  const messages = [
    ...(req.system ? [{ role: "system", content: req.system }] : []),
    { role: "user", content: user },
  ];
  return {
    url: b.endsWith("/chat/completions") ? b : `${b}/chat/completions`,
    init: {
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages }),
    },
  };
}

function readReply(cfg: AiConfig, data: Record<string, unknown>): AiResult {
  if (cfg.provider === "anthropic") {
    const blocks = (data.content as { text?: string }[] | undefined) ?? [];
    const u = (data.usage as { input_tokens?: number; output_tokens?: number } | undefined) ?? {};
    return {
      text: blocks.map((b) => b.text ?? "").join(""),
      model: cfg.model,
      tokensIn: u.input_tokens ?? 0,
      tokensOut: u.output_tokens ?? 0,
    };
  }
  const choices = (data.choices as { message?: { content?: string } }[] | undefined) ?? [];
  const u =
    (data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ?? {};
  return {
    text: choices[0]?.message?.content ?? "",
    model: cfg.model,
    tokensIn: u.prompt_tokens ?? 0,
    tokensOut: u.completion_tokens ?? 0,
  };
}

/** One completion, or null when AI is not configured. */
export async function aiComplete(req: AiRequest): Promise<AiResult | null> {
  const cfg = await getAiConfig();
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) return null;
  try {
    await assertEgressAllowed(cfg.baseUrl);
  } catch {
    throw new AiError("egress", "egress blocked");
  }
  if (!req.skipBudget) await assertBudget();
  const eff: AiRequest = req.redactPii
    ? {
        ...req,
        prompt: redactPromptPii(req.prompt, req.piiNames),
        system: req.system ? redactPromptPii(req.system, req.piiNames) : undefined,
      }
    : req;
  const { timeoutMs } = await getAiLimits();
  const { url, init } = buildRequest(cfg, cfg.apiKey, eff);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
    });
    if (!res.ok) throw classify(res.status);
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data) throw new AiError("upstream", "non-JSON reply");
    const result = readReply(cfg, data);
    await record(req, cfg.model, result.tokensIn, result.tokensOut, Date.now() - started);
    return result;
  } catch (e) {
    if (controller.signal.aborted) throw new AiError("timeout", "timed out");
    if (e instanceof AiError) throw e;
    throw new AiError("network", "unreachable");
  } finally {
    clearTimeout(timer);
  }
}
