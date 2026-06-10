// Vibe Inspector — AI analysis layer (ADR-016).
//
// Per-dimension judgement of a captured site against the BRD. Provider-agnostic:
//   • ANTHROPIC          → Anthropic SDK, vision (screenshot) + structured outputs.
//   • OPENAI_COMPATIBLE  → any /chat/completions endpoint (self-hosted LiteLLM,
//                          OpenAI, Gemini-compat) via fetch, JSON-object mode,
//                          text-only (so text models like gpt-oss-120b work).
// Both return JSON validated at runtime with the zod schemas below; the provider
// is resolved from Settings (DB) with an env fallback. See lib/testing/ai-config.ts.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { TestDimension } from "@/generated/prisma/client";
import { DIMENSION_META } from "./dimensions";
import type { CaptureResult } from "./capture";
import { resolveAiConfig, type ResolvedAiConfig } from "./ai-config";
import { redactSecret } from "@/lib/secret-box";

// -- Runtime validation schemas (zod 3) --

const findingSchema = z.object({
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  title: z.string(),
  detail: z.string(),
  recommendation: z.string(),
  evidence: z.string(),
});

const dimensionSchema = z.object({
  score: z.number(),
  status: z.enum(["PASS", "WARN", "FAIL"]),
  summary: z.string(),
  findings: z.array(findingSchema),
});

const coverageSchema = z.object({
  score: z.number(),
  status: z.enum(["PASS", "WARN", "FAIL"]),
  summary: z.string(),
  requirements: z.array(
    z.object({
      requirement: z.string(),
      status: z.enum(["MET", "PARTIAL", "MISSING"]),
      evidence: z.string(),
    })
  ),
  findings: z.array(findingSchema),
});

export type DimensionAnalysis = z.infer<typeof dimensionSchema>;
export type CoverageAnalysis = z.infer<typeof coverageSchema>;
export type Finding = z.infer<typeof findingSchema>;

// -- Tolerant normalization --
// OpenAI-compatible providers (and smaller models) don't enforce the schema, so
// their JSON can be wrapped, miss fields, or use near-miss types. Coerce it into a
// schema-valid object before zod validates — so a usable result is produced rather
// than the whole dimension failing on a missing key.

function asObj(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
}

// Unwrap a single wrapper layer like {"analysis": {...}} / {"result": {...}}.
function unwrap(raw: unknown): Record<string, unknown> {
  const o = asObj(raw);
  const hasOwn = (k: string) => Object.prototype.hasOwnProperty.call(o, k);
  if (hasOwn("score") || hasOwn("status") || hasOwn("findings") || hasOwn("requirements")) return o;
  for (const v of Object.values(o)) {
    const inner = asObj(v);
    if ("score" in inner || "findings" in inner || "requirements" in inner) return inner;
  }
  return o;
}

const STATUS_SCORE: Record<"PASS" | "WARN" | "FAIL", number> = { PASS: 85, WARN: 60, FAIL: 35 };

function coerceStatus(s: unknown): "PASS" | "WARN" | "FAIL" {
  const u = String(s ?? "").toUpperCase();
  return u === "PASS" || u === "WARN" || u === "FAIL" ? u : "WARN";
}

function coerceScore(v: unknown, status: "PASS" | "WARN" | "FAIL"): number {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  return STATUS_SCORE[status];
}

function normalizeFinding(f: unknown): Finding {
  const o = asObj(f);
  const sev = String(o.severity ?? "MEDIUM").toUpperCase();
  const allowed = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  return {
    severity: (allowed.includes(sev) ? sev : "MEDIUM") as Finding["severity"],
    title: String(o.title ?? o.name ?? "Finding").slice(0, 500),
    detail: String(o.detail ?? o.description ?? o.message ?? ""),
    recommendation: String(o.recommendation ?? o.fix ?? ""),
    evidence: String(o.evidence ?? ""),
  };
}

function normalizeDimension(raw: unknown): DimensionAnalysis {
  const o = unwrap(raw);
  const status = coerceStatus(o.status);
  return {
    score: coerceScore(o.score, status),
    status,
    summary: String(o.summary ?? o.summaryText ?? ""),
    findings: Array.isArray(o.findings) ? o.findings.map(normalizeFinding) : [],
  };
}

function normalizeCoverage(raw: unknown): CoverageAnalysis {
  const o = unwrap(raw);
  const status = coerceStatus(o.status);
  const requirements = (Array.isArray(o.requirements) ? o.requirements : [])
    .map((r) => {
      const x = asObj(r);
      const st = String(x.status ?? "MISSING").toUpperCase();
      return {
        requirement: String(x.requirement ?? x.text ?? x.name ?? ""),
        status: (["MET", "PARTIAL", "MISSING"].includes(st) ? st : "MISSING") as
          | "MET"
          | "PARTIAL"
          | "MISSING",
        evidence: String(x.evidence ?? ""),
      };
    })
    .filter((r) => r.requirement);
  // Derive the score from coverage when the model didn't give a usable number.
  let score = coerceScore(o.score, status);
  if (!Number.isFinite(Number(o.score)) && requirements.length > 0) {
    const met =
      requirements.filter((r) => r.status === "MET").length +
      0.5 * requirements.filter((r) => r.status === "PARTIAL").length;
    score = Math.round((100 * met) / requirements.length);
  }
  return {
    score,
    status,
    summary: String(o.summary ?? ""),
    requirements,
    findings: Array.isArray(o.findings) ? o.findings.map(normalizeFinding) : [],
  };
}

// -- JSON schema (Anthropic structured outputs) + a text shape hint (OpenAI path) --

const findingJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] },
    title: { type: "string" },
    detail: { type: "string" },
    recommendation: { type: "string" },
    evidence: { type: "string" },
  },
  required: ["severity", "title", "detail", "recommendation", "evidence"],
};

const dimensionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    status: { type: "string", enum: ["PASS", "WARN", "FAIL"] },
    summary: { type: "string" },
    findings: { type: "array", items: findingJsonSchema },
  },
  required: ["score", "status", "summary", "findings"],
};

const coverageJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "number" },
    status: { type: "string", enum: ["PASS", "WARN", "FAIL"] },
    summary: { type: "string" },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          requirement: { type: "string" },
          status: { type: "string", enum: ["MET", "PARTIAL", "MISSING"] },
          evidence: { type: "string" },
        },
        required: ["requirement", "status", "evidence"],
      },
    },
    findings: { type: "array", items: findingJsonSchema },
  },
  required: ["score", "status", "summary", "requirements", "findings"],
};

const FINDING_SHAPE =
  `{"severity":"CRITICAL|HIGH|MEDIUM|LOW|INFO","title":string,"detail":string,` +
  `"recommendation":string,"evidence":string}`;
const DIMENSION_SHAPE_HINT =
  `Output ONLY a single JSON object — no markdown, no code fences, no wrapper key, no commentary. ` +
  `Exactly these top-level keys: {"score":<number 0-100>,"status":"PASS"|"WARN"|"FAIL",` +
  `"summary":<string>,"findings":[${FINDING_SHAPE}]}. "score" is REQUIRED. Use "" for ` +
  `recommendation/evidence when not applicable; use [] when there are no findings.`;
const COVERAGE_SHAPE_HINT =
  `Output ONLY a single JSON object — no markdown, no code fences, no wrapper key, no commentary. ` +
  `Exactly these top-level keys: {"score":<number 0-100>,"status":"PASS"|"WARN"|"FAIL",` +
  `"summary":<string>,"requirements":[{"requirement":<string>,"status":"MET"|"PARTIAL"|"MISSING",` +
  `"evidence":<string>}],"findings":[${FINDING_SHAPE}]}. "score" is REQUIRED.`;

const SYSTEM = `You are a senior QA + design + security reviewer evaluating a live website.
Be specific, evidence-backed, and honest — cite what you actually observe in the screenshot,
text, links, console errors, or headers. Never invent passing results. Score 0-100 where
90-100 is excellent, 70-89 good, 50-69 needs work, below 50 is failing. Set status FAIL when
there are critical/high problems, WARN for medium gaps, PASS only when genuinely solid.
Keep findings actionable; use "" for recommendation/evidence when none applies.`;

function captureContext(capture: CaptureResult): string {
  return [
    `URL: ${capture.finalUrl}`,
    `Title: ${capture.title || "(none)"}`,
    `HTTP status: ${capture.status ?? "unknown"} | HTTPS: ${capture.isHttps}`,
    `Controls: ${capture.buttonsCount} buttons, ${capture.formsCount} forms, ${capture.inputsCount} inputs`,
    `Security headers present: ${Object.keys(capture.securityHeaders).join(", ") || "NONE"}`,
    `Console errors (${capture.consoleErrors.length}): ${
      capture.consoleErrors.slice(0, 15).join(" | ") || "none"
    }`,
    `Links (${capture.links.length}): ${capture.links.slice(0, 40).join(", ")}`,
    ``,
    `Visible text (truncated):`,
    capture.visibleText.slice(0, 8000),
  ].join("\n");
}

// Tolerant JSON extraction for the OpenAI-compatible path (json_object mode is
// reliable, but some proxies wrap output in prose or ```json fences).
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(fenced.slice(start, end + 1));
    }
    throw new Error("Model did not return valid JSON");
  }
}

async function callAnthropic(
  cfg: ResolvedAiConfig,
  prompt: string,
  capture: CaptureResult,
  jsonSchema: Record<string, unknown>,
  schemaName: string
): Promise<unknown> {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const response = await client.messages.create({
    model: cfg.model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${prompt}\n\nThe attached screenshot is the rendered page; use it for visual judgement.`,
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: capture.screenshotMediaType,
              data: capture.screenshotBase64,
            },
          },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: jsonSchema } },
  });
  if (response.stop_reason === "max_tokens") {
    throw new Error(`Analysis output truncated (max_tokens) for ${schemaName}`);
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error(`Analysis returned no output for ${schemaName}`);
  return JSON.parse(text);
}

async function callOpenAICompatible(
  cfg: ResolvedAiConfig,
  prompt: string
): Promise<unknown> {
  if (!cfg.baseUrl) throw new Error("OpenAI-compatible provider requires a base URL");
  // Text-only (no screenshot) so text models work; the prompt notes the absence.
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content:
            "(No screenshot is available to this provider — judge from the page signals below.)\n\n" +
            prompt,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Some providers echo the Authorization key in error bodies — scrub it.
    throw new Error(`Provider error (${res.status}): ${redactSecret(body, cfg.apiKey).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | { text?: string }[] } }[];
  };
  // content is usually a string, but some OpenAI-compatible shims return an array
  // of content parts — handle both.
  const raw = data.choices?.[0]?.message?.content;
  const content = Array.isArray(raw)
    ? raw.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("")
    : raw;
  if (!content) throw new Error("Provider returned an empty response");
  return parseJsonLoose(content);
}

async function runAnalysis(
  prompt: string,
  capture: CaptureResult,
  jsonSchema: Record<string, unknown>,
  shapeHint: string,
  schemaName: string
): Promise<unknown> {
  const cfg = await resolveAiConfig();
  if (cfg.provider === "ANTHROPIC") {
    return callAnthropic(cfg, prompt, capture, jsonSchema, schemaName);
  }
  // OpenAI-compatible: the schema isn't enforced server-side, so embed the shape.
  return callOpenAICompatible(cfg, `${prompt}\n\n${shapeHint}`);
}

/** Standard per-dimension analysis (DESIGN, FUNCTIONALITY, SECURITY, BENCHMARK). */
export async function analyzeDimension(
  dimension: Exclude<TestDimension, "BRD_COVERAGE">,
  capture: CaptureResult,
  brdText: string
): Promise<DimensionAnalysis> {
  const meta = DIMENSION_META[dimension];
  const prompt = [
    `Evaluate the **${meta.label}** of this website.`,
    `Focus: ${meta.brief}`,
    meta.advisory
      ? `This dimension is ADVISORY — frame findings as judgement, not authoritative facts.`
      : ``,
    ``,
    `--- Business requirements / scope of work ---`,
    brdText.trim() ? brdText.slice(0, 12_000) : "(none provided)",
    ``,
    `--- Captured page signals ---`,
    captureContext(capture),
  ].join("\n");

  const raw = await runAnalysis(prompt, capture, dimensionJsonSchema, DIMENSION_SHAPE_HINT, "dimension_analysis");
  return dimensionSchema.parse(normalizeDimension(raw));
}

/** BRD coverage: extract requirements from the scope and judge each against the page. */
export async function analyzeBrdCoverage(
  capture: CaptureResult,
  brdText: string
): Promise<CoverageAnalysis> {
  const prompt = [
    `Perform **BRD coverage QA**. First extract the discrete, testable requirements from the`,
    `scope below (split compound statements; aim for 5-25 atomic requirements). Then judge each`,
    `against the captured page as MET, PARTIAL, or MISSING with brief evidence. Score = the`,
    `share of requirements satisfactorily met (weight PARTIAL ~0.5). Add findings for the most`,
    `important gaps.`,
    ``,
    `--- Business requirements / scope of work ---`,
    brdText.trim() ? brdText.slice(0, 14_000) : "(none provided — note this and score 0)",
    ``,
    `--- Captured page signals ---`,
    captureContext(capture),
  ].join("\n");

  const raw = await runAnalysis(prompt, capture, coverageJsonSchema, COVERAGE_SHAPE_HINT, "brd_coverage");
  return coverageSchema.parse(normalizeCoverage(raw));
}
