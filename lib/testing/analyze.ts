// Vibe Inspector — Claude analysis layer (ADR-015).
//
// Per-dimension judgement of a captured site against the BRD, using the Anthropic
// SDK with vision (the screenshot) + structured outputs (a JSON schema on
// output_config.format) so each dimension returns a typed { score, status,
// findings }. BRD coverage additionally returns a per-requirement traceability list.
// The model's JSON is validated at runtime with the zod schemas below.
//
// Gated by ANTHROPIC_API_KEY. When unset, analysis throws a clear error so the run
// is recorded as FAILED.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { TestDimension } from "@/generated/prisma/client";
import { DIMENSION_META } from "./dimensions";
import type { CaptureResult } from "./capture";

const DEFAULT_MODEL = "claude-opus-4-8";

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "Analysis engine not configured. Set ANTHROPIC_API_KEY (see .env.example / ADR-015) to run a test."
    );
  }
  return new Anthropic();
}

// -- Runtime validation schemas (zod 3) --

const findingSchema = z.object({
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
  title: z.string(),
  detail: z.string(),
  // Empty string when not applicable (keeps the schema strict & simple).
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

// -- JSON schemas sent to the API (structured outputs; all-required + closed objects) --

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

const SYSTEM = `You are a senior QA + design + security reviewer evaluating a live website.
Be specific, evidence-backed, and honest — cite what you actually observe in the screenshot,
text, links, console errors, or headers. Never invent passing results. Score 0-100 where
90-100 is excellent, 70-89 good, 50-69 needs work, below 50 is failing. Set status FAIL when
there are critical/high problems, WARN for medium gaps, PASS only when genuinely solid.
Keep findings actionable; use "" for recommendation/evidence when none applies.`;

/** Shared capture context block (everything except the BRD-coverage specifics). */
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

function imageBlock(capture: CaptureResult): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: capture.screenshotMediaType,
      data: capture.screenshotBase64,
    },
  };
}

// Pull the model's JSON out of the response text blocks (skips thinking blocks).
function extractJson(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function runAnalysis(
  prompt: string,
  capture: CaptureResult,
  schema: Record<string, unknown>,
  schemaName: string
): Promise<unknown> {
  const client = getClient();
  // 16000 stays under the SDK's non-streaming HTTP timeout while leaving ample room
  // for adaptive thinking + a full coverage list, so the JSON isn't truncated.
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, imageBlock(capture)] }],
    output_config: { format: { type: "json_schema", schema } },
  });
  if (response.stop_reason === "max_tokens") {
    // The structured JSON was cut off — surface it clearly rather than letting
    // JSON.parse throw an opaque SyntaxError.
    throw new Error(`Analysis output truncated (max_tokens) for ${schemaName}`);
  }
  const text = extractJson(response);
  if (!text) throw new Error(`Analysis returned no output for ${schemaName}`);
  return JSON.parse(text);
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
    ``,
    `The attached screenshot is the rendered page. Produce the structured analysis.`,
  ].join("\n");

  const raw = await runAnalysis(prompt, capture, dimensionJsonSchema, "dimension_analysis");
  return dimensionSchema.parse(raw);
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
    ``,
    `The attached screenshot is the rendered page. Produce the structured coverage analysis.`,
  ].join("\n");

  const raw = await runAnalysis(prompt, capture, coverageJsonSchema, "brd_coverage");
  return coverageSchema.parse(raw);
}
