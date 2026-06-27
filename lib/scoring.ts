import {
  scoreRequestSchema,
  scoreResponseSchema,
  type ScoreRequestInput,
  type ScoreResponse,
} from "./validations/scoring";

/**
 * Server-side client for the deterministic IPIP-NEO-120 scoring microservice
 * (services/scoring). The scorer is a SEPARATE process (Python/`five-factor-e`)
 * reached over HTTP via an env var -- there is no Vercel lock-in and no
 * psychometric logic in this codebase. Scoring is deterministic code, never the
 * LLM (ARCHITECTURE §6/§12.2).
 *
 *   SCORING_SERVICE_URL    base URL, e.g. https://scoring.internal or http://localhost:8000
 *   SCORING_SERVICE_TOKEN  optional Bearer token (must match the service's)
 *
 * SERVER-ONLY: reads a secret token from the environment, so it must only be
 * imported from server components, route handlers, or services -- never a client
 * component (the `no-prisma-in-client` boundary applies here in spirit).
 */

/** Thrown when scoring cannot be obtained or the response fails validation. */
export class ScoringError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ScoringError";
    this.status = status;
  }
}

/** Whether the scoring service is wired up (URL present). */
export function isScoringConfigured(): boolean {
  return Boolean(process.env.SCORING_SERVICE_URL);
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Score a completed 120-item questionnaire. Validates the request before
 * sending and the response after receiving (the service is across a trust
 * boundary). Throws ScoringError on misconfiguration, transport failure,
 * timeout, a non-2xx response, or a response that doesn't match the contract.
 */
export async function requestScoring(
  input: ScoreRequestInput,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ScoreResponse> {
  const baseUrl = process.env.SCORING_SERVICE_URL;
  if (!baseUrl) {
    throw new ScoringError("SCORING_SERVICE_URL is not configured");
  }

  // Validate + apply defaults (sex/age) before crossing the boundary.
  const body = scoreRequestSchema.parse(input);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = process.env.SCORING_SERVICE_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Bound the call so a hung scorer can't pin a request handler. Compose the
  // caller's signal (if any) with our timeout.
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/score`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "network error";
    throw new ScoringError(`scoring service unreachable: ${reason}`);
  }

  if (!res.ok) {
    // The service returns { error } on failure; surface it without leaking bodies.
    const detail = await res
      .json()
      .then((b: { error?: string }) => b?.error)
      .catch(() => undefined);
    throw new ScoringError(
      `scoring service returned ${res.status}${detail ? `: ${detail}` : ""}`,
      res.status
    );
  }

  const json = await res.json().catch(() => null);
  const parsed = scoreResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ScoringError("scoring service returned an unexpected payload");
  }
  return parsed.data;
}
