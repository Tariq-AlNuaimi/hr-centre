---
globs: lib/ai/**, app/api/ai/**, tests/ai-evals/**
title: AI endpoints — AI-Quality pillar, lib/ai barrel
---

# AI-endpoint rules

Loaded when you touch `lib/ai/**`, `app/api/ai/**`, or AI eval fixtures. **INERT** on any fork
with no `lib/ai` usage / no `AI_API_KEY` — no findings, no `/ship` effect.

## Conditional 6th pillar — AI-Quality (ADR-042)

Forks that ship AI endpoints add a sixth pillar: **AI-Quality** (defined in `docs/uat-rubric.md`).
It governs AI routes only. It is a gate like the five: an automatable slice (the `/ai-eval` gate,
ADR-036 — dormant until `AI_API_KEY` + fixtures land — plus the ESLint rules below) and a blocking
checklist `/qa`/`/uat` affirm on every AI surface:

- eval pass-rate (the `/ai-eval` gate scores `tests/ai-evals/*.eval.ts` fixtures);
- prompt-injection resistance at the boundary;
- honest AI failure states — **503 when unconfigured, no hallucinated success**;
- RAG grounding/citation;
- bounded cost/tokens;
- **no Restricted/PII in prompts or logs**.

An unfixed AI-Quality concern is a wave-off in `docs/findings-register.md`, adjudicated like any
other pillar. Adds no new `/ship` phase — enforcement is the existing (dormant) `/ai-eval` gate +
ESLint rules, so a non-AI fork's green is untouched.

## Hard rule (AI)

- **`no-direct-anthropic-sdk`** — `@anthropic-ai/sdk` may only be imported inside `lib/ai/**`;
  model access everywhere else goes through the `@/lib/ai` barrel (never `new Anthropic`) so the
  `isAiConfigured()` gate, endpoint-agnostic client, default model/max_tokens, and GenAI tracing
  can't be bypassed — the AI-Quality pillar's automatable slice (ADR-042).

Scaffold a complete AI endpoint with `/scaffold-ai-endpoint` (config-guarded, auth-wrapped,
rate-limited, zod-validated, traced route + eval fixtures + blueprint stub, ADR-036).
