import { IPIP_FACETS_BY_DOMAIN } from "./ipip-facets";
import {
  llmDraftResponseSchema,
  type DraftRoleProfileInput,
  type LlmDraftResponse,
} from "./validations/roleProfile";
import { narrativeResponseSchema, type NarrativeResponse } from "./validations/result";

/**
 * The bounded LLM seam (ARCHITECTURE §4/§10). The platform uses AI in exactly two
 * places; this module owns AI Role 1 -- role-profile *drafting* (human-approved).
 * It NEVER scores, computes percentiles, or makes a hire/no-hire call (that is the
 * deterministic Python service + the human, respectively).
 *
 *   LLM_ENDPOINT_URL    OpenAI-compatible base, e.g. https://litellm.rihal.dev/v1
 *   LLM_ENDPOINT_TOKEN  Bearer token for the gateway
 *   LLM_MODEL           model id (default "gpt-oss-120b")
 *
 * RUNTIME-CONFIG SEAM: all optional. `isLlmConfigured()` gates the feature; with
 * the endpoint unset, drafting is unavailable and the wizard falls back to manual
 * authoring -- everything else works. The endpoint is a self-hosted, OpenAI-
 * compatible gateway (Tariq's LiteLLM proxy); we NEVER hardcode a provider or call
 * a public API (data sovereignty, ARCHITECTURE §10).
 *
 * SERVER-ONLY: reads a secret token from the environment -- import only from route
 * handlers / services, never a client component.
 */

/** Thrown when drafting cannot be obtained or the response fails the schema. */
export class LlmError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

/** Whether the bounded LLM endpoint is wired up (URL present). */
export function isLlmConfigured(): boolean {
  return Boolean(process.env.LLM_ENDPOINT_URL);
}

// The same 32-char floor lib/env.ts declares for LLM_ENDPOINT_TOKEN, enforced at the
// point of use. We do NOT import the eager `env` object here: this dormant seam (and
// its unit tests) must load without the full app env (DATABASE_URL/AUTH_SECRET) being
// valid, so the contract is checked locally instead (senior-review T-14).
const LLM_TOKEN_MIN_LEN = 32;

const DEFAULT_TIMEOUT_MS = 30_000; // drafting is a heavier call than scoring

// The reference the prompt SUPPLIES so the model maps/structures rather than
// inventing competencies from its own opinion (ARCHITECTURE §4 constraint). O*NET
// work styles + the 30 IPIP facets it may map onto + the trait→performance crib.
const ONET_WORK_STYLES = [
  "Achievement/Effort",
  "Persistence",
  "Initiative",
  "Leadership",
  "Cooperation",
  "Concern for Others",
  "Social Orientation",
  "Self-Control",
  "Stress Tolerance",
  "Adaptability/Flexibility",
  "Dependability",
  "Attention to Detail",
  "Integrity",
  "Independence",
  "Innovation",
  "Analytical Thinking",
] as const;

function facetReference(): string {
  return Object.entries(IPIP_FACETS_BY_DOMAIN)
    .map(([domain, facets]) => `- ${domain}: ${facets.join(", ")}`)
    .join("\n");
}

function buildMessages(input: DraftRoleProfileInput): Array<{ role: string; content: string }> {
  const system = [
    "You are an I/O psychology assistant that STRUCTURES a role's target competency profile.",
    "You DO NOT invent competencies from opinion: you map the provided job description onto the",
    "reference vocabularies below and cite a source for every competency.",
    "",
    "O*NET work styles you may reference (use the importance the JD implies, 0-100):",
    ONET_WORK_STYLES.map((w) => `- ${w}`).join("\n"),
    "",
    "The ONLY facet machine-names you may put in `facets` (IPIP-NEO, grouped by OCEAN domain):",
    facetReference(),
    "",
    "Rules:",
    "- Map 4-7 competencies, each operationalized by 1-3 of the facets above (exact machine-names).",
    "- `direction`: HIGH (target at/above percentile), LOW (at/below, e.g. low-Neuroticism facets), or MODERATE.",
    "- `targetPercentile`: integer 1-99. `weight`: positive number (relative importance).",
    "- `sourceCitation`: the O*NET work style and/or a Big Five finding (e.g. 'O*NET Persistence; Barrick & Mount 1991: Conscientiousness predicts job performance').",
    "- Return ONLY a JSON object: {\"competencies\":[{name,onetRef,importance,weight,direction,targetPercentile,sourceCitation,facets:[...]}]}.",
    "- No prose, no markdown fences.",
  ].join("\n");

  // PROMPT-INJECTION NOTE (senior-review LOW): jdSourceText + roleTitle are admin-
  // supplied free text injected into the user turn. A crafted JD could try to steer
  // the model, but the CONTAINMENT is the strict llmDraftResponseSchema applied to
  // the output (a draft must still be valid competencies) PLUS the mandatory human
  // approval before any profile goes ACTIVE — the model never auto-publishes. Do not
  // widen this surface (e.g. never feed raw JD text into the AI Role 2 narration,
  // which must stay bound to computed numbers only).
  const user = [
    `Role family: ${input.roleFamilyKey}`,
    `Role title: ${input.roleTitle}`,
    "Job description:",
    input.jdSourceText,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// Tolerate a model that wraps JSON in ```json fences despite instructions.
function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : content).trim();
}

/**
 * AI Role 1: draft a target competency profile from a JD. Returns an UNSAVED,
 * schema-validated draft for the wizard -- nothing is persisted or approved here
 * (the human reviews and approves downstream, ARCHITECTURE §4). Throws LlmError on
 * misconfiguration, transport failure, timeout, a non-2xx, or an off-contract
 * payload (the caller then offers manual authoring + retry, UI-SPEC D.3).
 */
export async function draftRoleProfile(
  input: DraftRoleProfileInput,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<LlmDraftResponse> {
  const baseUrl = process.env.LLM_ENDPOINT_URL;
  if (!baseUrl) {
    throw new LlmError("LLM_ENDPOINT_URL is not configured");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.LLM_ENDPOINT_TOKEN;
  if (token) {
    // Enforce the token-strength floor on the actual request path (not only the
    // env schema, which isn't parsed unless another route imports it).
    if (token.length < LLM_TOKEN_MIN_LEN) {
      throw new LlmError(
        `LLM_ENDPOINT_TOKEN must be at least ${LLM_TOKEN_MIN_LEN} characters`
      );
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "gpt-oss-120b",
        messages: buildMessages(input),
        temperature: 0.2, // low: structure, don't improvise (ARCHITECTURE §4)
      }),
      signal,
      cache: "no-store",
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "network error";
    throw new LlmError(`LLM endpoint unreachable: ${reason}`);
  }

  if (!res.ok) {
    throw new LlmError(`LLM endpoint returned ${res.status}`, res.status);
  }

  const json = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmError("LLM endpoint returned an empty completion");
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(extractJson(content));
  } catch {
    throw new LlmError("LLM returned non-JSON content");
  }

  const parsed = llmDraftResponseSchema.safeParse(candidate);
  if (!parsed.success) {
    // Off-contract (bad facet, out-of-range band, etc.) -- treat as a soft failure
    // so the wizard offers manual authoring rather than persisting garbage.
    throw new LlmError("LLM draft did not match the required schema");
  }
  return parsed.data;
}

// ===========================================================================
// AI Role 2 — narrative summary of an ALREADY-computed result (ARCHITECTURE §4).
// ===========================================================================

/**
 * The numbers-only input for the result narrative. By construction it carries NO
 * candidate PII (no name/email) and NO free text (no JD) — only the deterministic,
 * already-computed figures (Phase-6 blueprint). This is the containment that keeps
 * AI Role 2 from introducing any judgement not present in the numbers.
 */
export type ResultNarrativeInput = {
  roleTitle: string;
  fitScore: number;
  competencies: Array<{
    name: string;
    score: number;
    band: "PASS" | "PARTIAL" | "BELOW";
    targetPercentile: number;
    direction: "HIGH" | "MODERATE" | "LOW";
  }>;
  domains: Array<{ domain: string; percentile: number }>;
  sjtOverall: number | null;
};

function buildNarrativeMessages(
  input: ResultNarrativeInput
): Array<{ role: string; content: string }> {
  const system = [
    "You write a SHORT, plain-language summary of an already-computed candidate",
    "assessment result for a hiring manager. The numbers were computed by a",
    "deterministic scoring engine — your ONLY job is to restate them in prose.",
    "",
    "HARD CONSTRAINTS (a violation makes the summary unusable):",
    "- Use ONLY the numbers provided. Introduce NO judgement, trait, or fact not in them.",
    "- Do NOT make a hire / no-hire / advance / reject recommendation. The human decides.",
    "- Do NOT invent percentiles, competencies, or causes. No speculation about the person.",
    "- Neutral, professional tone. 2–4 sentences. Name a few clear strengths (PASS) and",
    "  any below-target areas (BELOW), framed as fit to THIS role's documented requirements.",
    "- Return ONLY a JSON object: {\"narrative\":\"...\"}. No prose outside it, no markdown fences.",
  ].join("\n");

  // Numbers only — note there is deliberately NO candidate name/email and NO JD here.
  const user = JSON.stringify({
    roleTitle: input.roleTitle,
    fitScore: input.fitScore,
    competencies: input.competencies,
    domainPercentiles: input.domains,
    sjtJudgementScore: input.sjtOverall,
  });

  return [
    { role: "system", content: system },
    { role: "user", content: `Computed result (numbers only):\n${user}` },
  ];
}

/**
 * AI Role 2: write a numbers-bound narrative of a computed result. Returns a
 * schema-validated `{ narrative }` (the caller caches it on Result). Throws
 * LlmError on misconfiguration, transport failure, timeout, a non-2xx, or an
 * off-contract payload — the caller then renders the numbers WITHOUT a narrative
 * (never a broken panel; UI-SPEC D.7 §6). Dormant + graceful when the LLM is
 * unconfigured (gate on isLlmConfigured() before calling).
 */
export async function draftResultNarrative(
  input: ResultNarrativeInput,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<NarrativeResponse> {
  const baseUrl = process.env.LLM_ENDPOINT_URL;
  if (!baseUrl) {
    throw new LlmError("LLM_ENDPOINT_URL is not configured");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.LLM_ENDPOINT_TOKEN;
  if (token) {
    if (token.length < LLM_TOKEN_MIN_LEN) {
      throw new LlmError(`LLM_ENDPOINT_TOKEN must be at least ${LLM_TOKEN_MIN_LEN} characters`);
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "gpt-oss-120b",
        messages: buildNarrativeMessages(input),
        temperature: 0.1, // lowest: restate, never improvise (ARCHITECTURE §4)
      }),
      signal,
      cache: "no-store",
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "network error";
    throw new LlmError(`LLM endpoint unreachable: ${reason}`);
  }

  if (!res.ok) {
    throw new LlmError(`LLM endpoint returned ${res.status}`, res.status);
  }

  const json = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmError("LLM endpoint returned an empty completion");
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(extractJson(content));
  } catch {
    throw new LlmError("LLM returned non-JSON content");
  }

  const parsed = narrativeResponseSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new LlmError("LLM narrative did not match the required schema");
  }
  return parsed.data;
}
