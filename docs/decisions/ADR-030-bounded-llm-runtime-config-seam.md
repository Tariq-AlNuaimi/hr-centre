# ADR-030 — The bounded LLM as a runtime-config seam (two roles, human-gated)

**Status:** Accepted
**Date:** 2026-06-27
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

Phase 3 introduces the platform's first use of an LLM. ARCHITECTURE §4 bounds AI
to **exactly two roles**, and nowhere else:

1. **Role-profile drafting** (Phase 3) — map a JD onto a *provided* O\*NET work-
   styles + Big-Five reference and emit a structured draft competency profile. A
   human (HR) reviews and approves every profile before it can be used.
2. **Result narration** (Phase 6) — restate already-computed numbers in plain
   language; never invent a judgement or a hire/no-hire call.

The AI must **never** score, compute percentiles, or make a decision — that is the
deterministic Python service (ADR-029) and the human, respectively. Two further
constraints are firm: (a) all AI calls go to Tariq's **self-hosted, OpenAI-
compatible** gateway (LiteLLM, `litellm.rihal.dev`, model `gpt-oss-120b`), never a
public API, for data sovereignty; and (b) the operator will wire the endpoint from
app settings *after* the build, so the whole platform must work with the LLM
**unset**.

## Decision

Model the LLM as an **optional runtime-config seam**, mirroring the scoring seam
(ADR-029) rather than a hardwired dependency:

- Three optional env vars in `lib/env.ts`: **`LLM_ENDPOINT_URL`** (OpenAI-
  compatible base), **`LLM_ENDPOINT_TOKEN`** (Bearer, `min(32)`), **`LLM_MODEL`**
  (default `gpt-oss-120b`). No provider is hardcoded; the client appends
  `/chat/completions` to the configured base.
- `lib/llm.ts` owns AI Role 1: `isLlmConfigured()` gates the feature;
  `draftRoleProfile()` builds a low-temperature prompt that **supplies** the O\*NET
  work styles + the 30 IPIP facet machine-names + a trait→performance crib as
  context (so the model *maps and structures*, it does not invent competencies),
  and validates the model's JSON against `llmDraftResponseSchema` — which **reuses
  the same competency schema a human-authored profile is held to**. Off-contract
  output (a bad facet, an out-of-range band) is rejected as an `LlmError`.
- The draft API route (`POST /api/role-profiles/draft`, `withAdminAuth` +
  `withRateLimit`) returns **503** when the seam is unset and **502** on an AI
  failure, so the authoring wizard **falls back to manual authoring** — AI is
  strictly additive, never a hard dependency.
- **Human approval is structural, not advisory:** the draft endpoint returns an
  *unsaved* draft; nothing is persisted or activated without an explicit human
  approve action (records `approvedBy` + `approvedAt`, ARCHITECTURE §4 / UI-SPEC
  D.3 step 5).

## Consequences

### Positive
- The platform is fully functional with no LLM configured — drafting degrades to
  manual, everything else is unaffected. IT enables AI by setting one URL later.
- No public-API egress and no provider lock-in: any OpenAI-compatible gateway
  (LiteLLM now, an OCI-hosted model later) is a connection-string change.
- The AI cannot smuggle an unbounded competency into the model: its output passes
  the identical zod gate as hand-authored data, so a hallucinated facet can never
  reach the DB.

### Negative
- A network hop + a new failure mode on the drafting path (bounded timeout +
  `LlmError` make it fail fast and visibly, never silently).
- Prompt quality (the O\*NET/trait reference embedded in `lib/llm.ts`) is a
  maintenance surface; it lives in code, reviewed like any other.

### Mitigations
- Bounded `AbortSignal.timeout` + zod validation of the completion + a generic
  safe error to the client (no endpoint/body leakage).
- Rate limit OUTSIDE the auth wrapper (the only outbound LLM call; a flood is
  throttled before the work runs).
- `LLM_ENDPOINT_TOKEN` is Restricted, `min(32)`, documented in SECURITY.md §6.

## Alternatives considered
1. **Hardcode a provider SDK (OpenAI/Anthropic) + key** — rejected: violates data
   sovereignty (public egress) and locks the platform to one vendor.
2. **Make AI a hard dependency of authoring** — rejected: the operator wants the
   platform usable before the endpoint is wired, and a defensible profile must be
   hand-authorable regardless of model availability.
3. **Let the LLM return free-form profiles parsed leniently** — rejected: the
   model's output must clear the same constraints as human input, or "AI drafted"
   becomes an unaudited backdoor around the competency contract.
4. **Use `response_format: json_object`** — not relied upon: gateway/model support
   for OpenAI structured-output is uneven; instead the prompt demands raw JSON and
   the client tolerates a ```json fence, then zod is the real gate.

## Migration triggers
- AI Role 2 (result narration, Phase 6) → second function in `lib/llm.ts`, same
  seam, same low-temperature + numbers-bound discipline.
- Move off LiteLLM (e.g. OCI-hosted model) → repoint `LLM_ENDPOINT_URL`; no code
  change.
- Per-tenant model routing or per-call cost controls → push `LLM_MODEL` selection
  into org settings (the env default stays the fallback).

## Related
- ARCHITECTURE §4 (bounded AI), §10 (LLM via LiteLLM, env-driven)
- `lib/llm.ts`, `lib/validations/roleProfile.ts` (`llmDraftResponseSchema`),
  `lib/ipip-facets.ts`
- `app/api/role-profiles/draft/route.ts`
- ADR-029 (deterministic scoring service) — the sibling "separate, env-gated,
  zod-bounded service" seam this mirrors
- `docs/blueprints/phase-3-role-profile-authoring.md`
