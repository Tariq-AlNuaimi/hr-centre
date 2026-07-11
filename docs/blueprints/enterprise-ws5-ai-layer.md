# Blueprint — Enterprise WS-5: Claude-native AI runtime skeleton

Scope: lib/ai/**

> Governs the WS-5 AI-layer skeleton. It adds NO new `app/api/**/route.ts` or `app/**/page.tsx`
> (skeleton-only — operator decision, session 15), so the `blueprint-gate.mjs` hook (ADR-033)
> does not fire; this file is the requirements contract `/qa`/`/uat` trace against, and it
> refines AC-6.1 of `docs/blueprints/enterprise-p0-baseline.md` (whose `Scope:` already covers
> `lib/ai/**`). Build-vs-buy is recorded in `docs/build-vs-buy-ledger.md` (2026-07-11 — AI
> runtime, Claude-native). Decision of record: **ADR-036**.

## Problem & outcome
The AI layer is the single largest net-new gap in the stack (ADR-036): the template ships **no**
provider wrapper, no agent loop, no RAG, no evals. This increment lands the **provider seam +
thin native Tool-Runner wrapper** — the smallest maintained surface that a later increment
(`/scaffold-ai-endpoint`, the ai-eval gate, the AI-Quality pillar, pgvector RAG, embeddings)
builds on. Per ADR-036 the runtime is **Claude-native** (`@anthropic-ai/sdk`'s beta
`messages.tool_runner`); frameworks (Mastra/LangGraph) are deferred; the Vercel AI SDK is reserved
for the RSC/SSE streaming-UI seam only and is NOT pulled in here.

**Endpoint-agnostic by operator decision (session 15).** The operator runs a self-hosted LLM
reachable via an API key and wants to **switch freely** between it and Anthropic's hosted API.
The provider seam is therefore pure deploy-time config: a configurable base URL, API key, and
auth-header style. The code stays Anthropic-wire-native (ADR-036) — a self-hosted endpoint is
supported when it speaks the Anthropic wire format (e.g. a LiteLLM/gateway proxy in
Anthropic-compat mode) or is fronted by such a gateway. A purely OpenAI-compatible backend is out
of scope this phase and maps to ADR-036's P2 cascade-router migration trigger.

When this ships, a developer can `import { getAiClient, runAgent } from "@/lib/ai"` and get a
typed, tested, endpoint-agnostic Claude client + agentic tool-loop — with the whole layer a
**silent no-op when unconfigured** (no `AI_API_KEY` → `isAiConfigured()` is false and the factory
throws a clear, actionable error rather than half-initializing), mirroring how observability
(ADR-040) and email (`lib/email.ts`) degrade.

## Users & stories (EARS; worst path mandatory)
- **US1** — As a **developer**, I want a typed Claude client factory, so that AI code shares one
  configured, endpoint-agnostic provider instead of newing up SDK clients ad hoc.
  - **AC-1.1** — WHEN `lib/ai` is imported and `AI_API_KEY` is set THE SYSTEM SHALL expose
    `getAiClient()` returning a configured `@anthropic-ai/sdk` client whose `baseURL` and
    auth-header style come from env (`AI_BASE_URL`, `AI_AUTH_STYLE`), defaulting to Anthropic's
    hosted API with `x-api-key`.
  - **AC-1.2 (worst)** — WHEN `AI_API_KEY` is unset THE SYSTEM SHALL report `isAiConfigured()`
    false and `getAiClient()` SHALL throw a single, actionable error naming the missing var —
    never construct a client that would 401 at call time or leak a partial config.
- **US2** — As a **developer**, I want a thin native Tool-Runner wrapper, so that I get the
  Anthropic agentic loop (ADR-036) without hand-rolling it or importing a framework.
  - **AC-2.1** — WHEN `runAgent(params)` is called THE SYSTEM SHALL delegate to
    `client.beta.messages.toolRunner`, injecting the default model (`AI_MODEL`) and a default
    `max_tokens` only when the caller omits them, and SHALL return the native runner unchanged
    (awaitable for the final message; iterable for per-turn hooks) so no Tool-Runner capability
    is hidden behind the seam.
  - **AC-2.2 (worst)** — WHEN `runAgent` is called with the AI layer unconfigured THE SYSTEM
    SHALL throw the same actionable "not configured" error before any network attempt.
- **US3** — As an **operator**, I want the endpoint to be deploy-time config, so that I can point
  the same build at Anthropic-hosted or my self-hosted LLM without a code change.
  - **AC-3.1** — WHEN `AI_AUTH_STYLE` is `x-api-key` (default) THE SYSTEM SHALL pass `AI_API_KEY`
    as the SDK `apiKey` (sent as `x-api-key`); WHEN it is `bearer` THE SYSTEM SHALL pass it as the
    SDK `authToken` (sent as `Authorization: Bearer`). `AI_BASE_URL`, when set, SHALL be validated
    as an absolute http(s) URL with a host (same rule as `OTEL_EXPORTER_OTLP_ENDPOINT`) so a
    scheme-less typo fails loud at boot rather than silently targeting nowhere.

## Scenarios (Given/When/Then)
- **US1-happy** — Given `AI_API_KEY` set and no other AI vars, When `getAiClient()`, Then a client
  is returned whose `baseURL` is Anthropic's default and whose model default is `claude-opus-4-8`.
- **US1-worst** — Given `AI_API_KEY` unset, When `getAiClient()`, Then it throws
  `AiNotConfiguredError` naming `AI_API_KEY`; `isAiConfigured()` is false; nothing is constructed.
- **US2-happy** — Given a configured layer, When `runAgent({ messages, tools })`, Then it calls
  `toolRunner` with `model=AI_MODEL` and a default `max_tokens`, returning the runner (a later
  increment `await`s it for the final message).
- **US2-worst** — Given an unconfigured layer, When `runAgent(...)`, Then it throws
  `AiNotConfiguredError` before any SDK/network call.
- **US3-happy** — Given `AI_BASE_URL=https://gateway.internal/anthropic` + `AI_AUTH_STYLE=bearer`,
  When `getAiClient()`, Then the client targets that base URL and sends `Authorization: Bearer`.
- **US3-worst** — Given `AI_BASE_URL=gateway:4000` (scheme-less), When env is parsed at boot, Then
  validation rejects it with a clear message — no silent misroute.

## Architecture sketch
- `lib/ai/config.ts` — the runtime gate + typed config reader. `isAiConfigured()` and
  `aiConfig()` read from `lib/env` (server-only; the AI layer never runs on the Edge). Single
  source of truth for "is AI on and how".
- `lib/ai/provider.ts` — `getAiClient()` factory constructing `new Anthropic({ apiKey|authToken,
  baseURL })` from the config; `AiNotConfiguredError`. Endpoint-agnostic (AC-1.1/3.1).
- `lib/ai/tool-runner.ts` — `runAgent(params)`: thin pass-through to
  `client.beta.messages.toolRunner` with model/max_tokens defaults injected (AC-2.1). Typed via
  `Parameters<>`/`ReturnType<>` off the SDK method so it tracks the beta API without restating it.
- `lib/ai/index.ts` — barrel export (`getAiClient`, `runAgent`, `isAiConfigured`, `aiConfig`,
  `AiNotConfiguredError`, `AI_DEFAULT_MAX_TOKENS`).
- `lib/env.ts` + `.env.example` — the `AI_*` env contract.
- `tests/contracts/ai.test.ts` — node:test contract suite (the repo's runner; not Jest).

Model-tier routing follows **ADR-022** — `AI_MODEL` is the default tier; per-call overrides pass
through `runAgent`. No new routing policy here.

```mermaid
flowchart LR
  caller["RSC / API route / service"] -->|import| idx["lib/ai (barrel)"]
  idx --> cfg["config.ts — isAiConfigured / aiConfig (reads lib/env)"]
  idx --> prov["provider.ts — getAiClient()"]
  idx --> tr["tool-runner.ts — runAgent()"]
  prov -->|new Anthropic({apiKey|authToken, baseURL})| sdk["@anthropic-ai/sdk"]
  tr -->|beta.messages.toolRunner| sdk
  sdk -.->|AI_BASE_URL unset| hosted["Anthropic hosted API"]
  sdk -.->|AI_BASE_URL set| selfhost["self-hosted LLM / Anthropic-compat gateway"]
```

## The five pillars
- **Speed** — zero cost when unconfigured (factory short-circuits); no client constructed at import.
- **Secure** — `AI_API_KEY` is Restricted, never logged; the factory never leaks a partial config;
  env validation fails loud on a bad `AI_BASE_URL`.
- **Maintainable** — thin wrapper over a vetted SDK (ADR-036 + ledger); no framework lock-in; the
  Tool-Runner surface is passed through, not re-implemented; typed off the SDK method.
- **Scalable** — stateless factory; per-call model override supports ADR-022 tier routing; the seam
  is where a P2 cascade router / OpenAI-compat provider slots in without touching call sites.
- **High-Quality** — honest "not configured" failure (mirrors OTel no-op + email `{sent:false}`);
  contract tests cover the gate, the defaults, the auth-style wiring, and both worst paths;
  `/ship` green + `/code-review` + `senior-code-reviewer` before done.

## Tier
`shared` (enterprise pivot). Skeleton-only; no live route, so no auth-wrapper/zod surface this
phase — those arrive with `/scaffold-ai-endpoint` in a follow-on WS-5 increment.

## Explicitly deferred (follow-on WS-5 increments — ADR-036)
- `/scaffold-ai-endpoint` generator (AI route + eval fixtures + tracing + blueprint stub).
- `ai-eval` agent + the AI-eval `/ship` gate (Promptfoo suite; LLM-as-judge; ADR-020 pattern).
- The conditional 6th **AI-Quality** pillar (inert on non-AI forks).
- pgvector RAG substrate (ADR-035 `pgvector/pgvector:pg18`) + pluggable embeddings (Voyage/Cohere).
- Langfuse tracing wiring.
- An OpenAI-compatible provider path / cascade router (ADR-036 P2 migration trigger).

## Open questions (resolved via AskUserQuestion 2026-07-11)
- [x] Self-hosted endpoint wire format / how to switch? → **Maximum switchability**: configurable
  `AI_BASE_URL` + `AI_API_KEY`, code stays Anthropic-wire-native (ADR-036); OpenAI-only backends
  sit behind a gateway (deploy-time) or map to the P2 cascade-router trigger.
- [x] Auth header? → **Env-switchable** `AI_AUTH_STYLE` (`x-api-key` default | `bearer`).
- [x] lib/ai scope this phase? → **Skeleton only** (provider + tool-runner + tests); everything in
  "Explicitly deferred" above lands in follow-on increments (operator decision, session 15).
