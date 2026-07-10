# AI & Agent Application Stack — Enterprise Pivot Benchmark (Axis 2)

> **Domain:** the AI runtime the template has zero primitives for today. Decision-grade market benchmark for a new `lib/ai/*` layer.
> **As-of:** 2026-07. Versions, star counts, and adoption claims verified via web search (cited inline `[n]`); do not treat as durable — re-verify at build time.
> **Fixed stack it must compose with:** Next.js 16 (App Router, RSC, Node-runtime middleware, SSE), Prisma 7 + PostgreSQL 17 (dockerized, self-hosted default), Auth.js v5, zod, TypeScript 5. Anthropic-first (`@anthropic-ai/sdk`), enterprise-only, **deploy-per-tenant** (ADR-011 kept — no in-app row-level tenancy), self-hosted dockerized Postgres the default (`pgvector` near-free).

## Summary

This benchmark resolves the largest gap in the enterprise pivot (Axis 2 of `docs/enterprise-pivot-analysis.md`): the repo is a CRUD/RBAC/audit web-app template with **no AI runtime** — the `claude-api` skill is guidance, not shipped code. The headline call, and the one operator decision explicitly deferred to research (agent runtime = "RESEARCH DECIDES"), is **BUILD a thin wrapper on the Anthropic SDK's native tool-runner, do NOT adopt an agent framework** for the v1 baseline. The native `@anthropic-ai/sdk` `client.beta.messages.toolRunner()` gives a production agent loop (retries, streaming, `AbortSignal` cancellation, zod-typed tools) for zero extra dependencies and zero framework lock-in, which is exactly what an Anthropic-first, deploy-per-tenant, RSC-native shop should want [1][2][7]. Everything else in the layer is chosen to stay inside the dockerized box: **pgvector** on the existing Postgres for vectors [8][9], **Voyage AI** for embeddings (Anthropic's own recommended provider — Anthropic ships no first-party embedding endpoint) [10], **native SSE streaming** from a Node-runtime route (Vercel AI SDK kept as an option, not a baseline dep) [4][5], **Langfuse** (self-hostable, MIT) for evals + observability + prompt registry + cost metering as one substrate [6][11], and **Trigger.dev** over Inngest for agent background execution because Inngest's orchestration engine **cannot be self-hosted** — a hard conflict with the docker-first, deploy-per-tenant brief [12][13]. Net new deps for v1 are small and Anthropic-aligned; the heavier frameworks are logged as KEEP-AS-OPTION for when a genuine multi-step graph workflow appears.

Map to the pivot: this is the "new `lib/ai/*` layer + ADRs" bullet of Axis 2. Each capability below yields either a v1 primitive or a deferred/optional entry, and the seed-list verdicts table (§4) is written to drop straight into a build-vs-buy ledger + ADR set.

---

## 1. LLM provider SDK layer

The base client: `@anthropic-ai/sdk` (latest `0.110.0` as of 2026-07 [1]). It ships streaming (`.stream()` → `MessageStream`), automatic retries with backoff, per-request timeouts, and `AbortSignal` cancellation natively. The question is whether to add an abstraction (Vercel AI SDK) on top or stay native.

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit 1-5 | Notes |
|---|---|---|---|---|---|---|---|
| Provider SDK / client | `@anthropic-ai/sdk` (native) | Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) | `@anthropic-ai/sdk` (native) + Bedrock/Vertex SDK variants for regulated hosting | `@anthropic-ai/sdk` (MIT) | **`@anthropic-ai/sdk` native, thin `lib/ai/client.ts` wrapper** | 5 | SDK v0.110.0, 2026-07 [1]. Vercel AI SDK `ai` ~23.7K stars, 11.5M weekly downloads Apr-2026 [4]. Native = Anthropic-first, no provider-abstraction tax, direct access to betas (tool-runner, prompt caching, Managed Agents). |

**Recommendation:** stay native. A single `lib/ai/client.ts` constructs the client (base URL, key from env, default `maxRetries`, timeout, default model = `claude-sonnet-5`), so callers never touch config. Add the abstraction only if a second provider becomes a real requirement — this is a Claude-first shop, so YAGNI applies. Bedrock/Vertex SDK variants (`@anthropic-ai/bedrock-sdk`, `@anthropic-ai/vertex-sdk`) are a drop-in swap for regulated per-tenant deploys that mandate cloud-native model hosting [15].

---

## 2. Agent / tool-calling orchestration — the BUILD-VS-BUY centerpiece

The decision the operator deferred to research. Candidates: the Anthropic SDK's own tool-runner and Managed Agents vs. TS agent frameworks.

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit 1-5 | Notes |
|---|---|---|---|---|---|---|---|
| Agent loop / tool-calling | Anthropic SDK `beta.messages.toolRunner()` | Vercel AI SDK agents / Mastra | Anthropic **Managed Agents** (self-hosted sandboxes) | Mastra (Apache/Elastic) | **Native `toolRunner` + thin `lib/ai/agent.ts`** | 5 | `toolRunner` + `betaZodTool` (zod-schema tools), streaming runner returns `BetaMessageStream`, `AbortSignal` cancel via `BetaToolRunContext` [2][7]. Zero deps, Anthropic-first, composes with RSC. |
| Framework alt (graph/workflow) | LangGraph (Python-first) | **Mastra** ~21–22K stars, 300K weekly dl; prod at Replit/PayPal/Sanity/Brex [3] | Mastra (self-host) | Mastra | **KEEP-AS-OPTION** for real multi-step graphs | 3 | LangGraph JS ~8K stars, trails Python 4–8 wks/release, Python idioms in a Next codebase [3]. Mastra TS-native but brings its own state stores/runtime + lock-in. |
| Managed / hosted loop | Anthropic Managed Agents (public beta 2026-04-08) | — | **Managed Agents + self-hosted sandbox** | — | **ADOPT-LATER** (code-exec / computer-use agents) | 4 | Anthropic runs the loop (session log + harness + sandbox); self-hosted sandboxes keep tool execution/egress in your infra while orchestration stays Anthropic-side [14][16]. Hosted-orchestration dependency — not the self-contained-container default, but the right escape hatch for sandboxed-code agents. |

### 3 — BUILD-VS-BUY VERDICT: agent runtime (resolves operator decision #2)

**Verdict: BUILD a thin wrapper on the native Anthropic tool-runner. Do NOT adopt an agent framework for v1.** (`RESEARCH-DECIDES → own-thin-wrapper`.)

Ledger-entry framing (`docs/build-vs-buy-ledger.md`):

> **Scope:** `lib/ai/agent.ts`, `lib/ai/tools/**`
> **Considered:** (a) own thin wrapper on `@anthropic-ai/sdk` `beta.messages.toolRunner()`; (b) Mastra; (c) LangGraph JS; (d) Vercel AI SDK agents; (e) Anthropic Managed Agents.
> **Decision: BUILD (a).** The native tool-runner already *is* the agent loop — it calls Claude, routes tool calls to zod-typed handlers (`betaZodTool`), streams intermediate messages, and supports `AbortSignal` cancellation, with the SDK's built-in retries/timeouts underneath [2][7]. It adds **zero dependencies**, is Anthropic-first by construction, and drops cleanly into a Node-runtime API route or Server Action (RSC-compatible). A framework (Mastra/LangGraph) buys graph orchestration, agent networks, and a dev playground we do not need for deploy-per-tenant single-tenant tools, at the cost of a large dependency, its own state/persistence model, and lock-in — a poor trade against the Maintainable pillar and "prefer native." **Reject frameworks as a baseline; keep Mastra as KEEP-AS-OPTION** for the first genuine multi-step, branching, human-in-the-loop workflow (that is a `/scale-up` recipe, not core). **Managed Agents is ADOPT-LATER**, specifically for agents that must execute untrusted code or do computer-use, where its self-hosted-sandbox model (execution in our infra, orchestration Anthropic-side) is the cleanest enterprise answer [16].
> **ADR impact:** new ADR "Agent runtime = native tool-runner wrapper"; supersedes the "build vs adopt" open question in ADR-032's scope.

Why this is the right call for *this* stack specifically:
- **TS-native:** the SDK + zod tools are first-class TypeScript; no Python bridge, no codegen.
- **Next-16-RSC fit:** the loop runs server-side in a route/Server Action; streaming maps to SSE (see §3-streaming). No client bundle bloat.
- **Anthropic-first:** direct access to prompt caching, extended thinking, and the tool-runner betas the frameworks wrap late.
- **Enterprise readiness:** the audit/zod/auth-wrapper invariants apply unchanged because tool handlers are just typed server functions behind `withAuth`; no framework-owned execution path to re-secure.
- **Lock-in:** none beyond the Anthropic API we are already committed to.

---

## 3. Streaming to the client in Next 16

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit 1-5 | Notes |
|---|---|---|---|---|---|---|---|
| LLM → browser streaming | Native SSE from a Node-runtime route (`ReadableStream` from `sdk.messages.stream()`) | Vercel AI SDK `streamText` + `useChat`/`toUIMessageStreamResponse` [4][5] | Native SSE (full control of headers, auth wrapper, backpressure) | Native SSE | **Native SSE route + thin `lib/ai/stream.ts`; Vercel AI SDK KEEP-AS-OPTION for rich client chat UX** | 4 | `streamText`+`useChat` is the most popular DX and reduces perceived latency 40–60% via RSC/Suspense patterns [5], but pulls in `ai` + `@ai-sdk/anthropic` and its UI-message protocol. Native SSE keeps the auth wrapper, zod boundary, and per-tenant cost hook on the exact path we already secure. |

**Correct pattern for our stack:** an API route (`app/api/ai/**/route.ts`) wrapped in `withAuth`/`withRateLimit`, running on the **Node runtime** (middleware and Prisma already require it here), returning a `ReadableStream` of SSE `data:` frames sourced from the SDK's `MessageStream` events. RSC renders the initial shell and non-streamed reads; the streamed tokens come over the SSE route consumed by a small client component. This keeps streaming on the same rail as every other route (auth wrapper → zod → service → SDK) and lets the per-tenant cost meter (§10) tap the stream's terminal `message_delta` usage totals. Reserve Vercel AI SDK for a screen that genuinely needs `useChat`'s message-state machine; do not make it the baseline dependency. Do **not** stream from a Server Action for the primary chat path — Server Actions are fine for fire-and-forget/short generations, but SSE routes give cleaner cancellation and reconnection.

---

## 4. Vector store

Given self-hosted dockerized Postgres 17 is the default, the vector store should live in the box unless scale forces otherwise.

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit 1-5 | Notes |
|---|---|---|---|---|---|---|---|
| Vector store | **pgvector** (HNSW) | pgvector (ships in most managed PG) | Qdrant (best filtered search, self-host) / pgvectorscale | pgvector / Qdrant | **pgvector on the existing Postgres; pgvectorscale as the in-place upgrade at scale** | 5 | pgvector "good enough for the vast majority" under ~10M vectors, one backup/credential/ops story [9]. pgvectorscale (DiskANN + Statistical Binary Quantization): 471 QPS @99% recall on 50M vectors, 11.4× Qdrant, competitive w/ Pinecone, self-host ~$835/mo vs Pinecone ~$3,241/mo [8]. Qdrant p50 4ms, best filtering, if a dedicated store is ever justified [8]. Pinecone rejected — managed SaaS breaks the self-contained-container model. |

**Recommendation:** `pgvector` extension on the dockerized Postgres, HNSW index, one migration to add the extension + `vector` columns. It reuses the existing Prisma/Postgres backup, connection-pooling, and audit story — a direct Maintainable-pillar win. When a tenant's corpus crosses ~10M vectors or HNSW RAM pressure bites, upgrade **in place** to `pgvectorscale` (same Postgres, DiskANN index) rather than bolting on a second datastore [8]. Qdrant is the KEEP-AS-OPTION only if best-in-class filtered search at very high scale becomes a hard requirement.

---

## 5. Embeddings + retrieval primitives

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit 1-5 | Notes |
|---|---|---|---|---|---|---|---|
| Embeddings model | OpenAI `text-embedding-3-large` | OpenAI `text-embedding-3-small` (cheap default) | **Voyage AI `voyage-3-large`** (Anthropic's recommended provider) | open models via Ollama (fully in-box) | **Voyage `voyage-3-large` default; provider-swappable `lib/ai/embed.ts`** | 4 | Anthropic ships **no first-party embedding endpoint** and points to Voyage [10]. voyage-3-large tops MTEB (65.1) w/ a 4–6 pt edge on code/legal; OpenAI 3-large within 0.5 pt and cheaper/general [10]. Voyage is an external API call (accept for quality) — for air-gapped tenants, an Ollama-hosted open model keeps embeddings in-box. |
| Reranking | Cohere `rerank-v3` | Cohere rerank | Cohere `rerank-v3` / Voyage rerank | bge-reranker (self-host) | **Cohere/Voyage rerank as an optional 2nd stage** | 3 | Reranking is the standard fix for pure-vector recall gaps [10]; wire as an opt-in stage, not baseline. |
| Chunking + hybrid search | recursive/semantic chunking + Postgres FTS ∪ pgvector | — | hybrid (BM25/`tsvector` + vector) fused by RRF | in-repo utils | **`lib/ai/retrieval.ts`: chunk + hybrid (pgvector ⊕ Postgres FTS) + optional rerank** | 4 | Hybrid search fixes terminology-driven queries that pure vector misses [10]; Postgres FTS is already in-box, so hybrid is near-free here. |

**Recommendation:** a `lib/ai/retrieval.ts` primitive doing recursive/semantic chunking, dual indexing (pgvector for dense + Postgres `tsvector` FTS for lexical), Reciprocal-Rank-Fusion of the two result sets, and an optional Cohere/Voyage rerank stage. Embeddings via a provider-swappable `lib/ai/embed.ts` defaulting to Voyage. This is the RAG core `/scaffold-ai-endpoint` will lean on.

---

## 6. Evals + LLM-as-judge / observability

Mirror the repo's `senior-code-reviewer` LLM-as-judge pattern, applied to model output.

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit 1-5 | Notes |
|---|---|---|---|---|---|---|---|
| Evals + tracing + judge | Braintrust (eval-first) | **Langfuse** ~28K stars, MIT [6][11] | Langfuse (self-host) / Braintrust (Docker self-host) | **Langfuse** (MIT) | **Langfuse self-hosted** as the one substrate (trace + eval + prompt registry + cost) | 4 | Langfuse: full stack — tracing, prompt versioning + playground, LLM-as-judge, cost tracking [6][11]. Self-host needs Postgres + ClickHouse + Redis + S3 (a real ops footprint) [6]. Braintrust = eval-first experiment framework, commercial, Docker self-host [6]. Arize Phoenix ~8.9K stars, OTEL-native — strongest if OTel is a hard requirement [6]. Promptfoo = CI-config eval harness (lightweight, complementary). |
| CI eval gate | Promptfoo (YAML in CI) | Promptfoo | Promptfoo | Promptfoo | **Promptfoo for the `/ship`-style eval gate** | 4 | Config-driven, no service to run — the automatable AI-eval gate the pivot's L3 section wants; complements Langfuse (offline gate vs. online tracing). |

**Recommendation:** two tiers. (1) **Promptfoo** as the offline, in-CI **eval gate** — a `promptfoo` YAML of golden cases + LLM-as-judge assertions that runs like a test, giving the pivot its "AI-eval gate" without standing up a service. (2) **Langfuse** (self-hosted, MIT) as the online **trace + prompt-registry + cost substrate** for deployed tenants — one tool covers §6/§8/§10. Its Postgres+ClickHouse+Redis+S3 footprint is real, so Langfuse is **ADOPT-LATER / per-tenant opt-in**, not forced into every container; Promptfoo is the v1 baseline (zero infra). Arize Phoenix is the swap if OTel-native tracing becomes mandatory.

---

## 7. Background execution for long-running agents

Agent runs blow past serverless/request timeouts; they need durable background execution. The decisive constraint here is **self-hostability** under the docker-first, deploy-per-tenant brief.

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit 1-5 | Notes |
|---|---|---|---|---|---|---|---|
| Durable background jobs | BullMQ (Redis) | Inngest (cloud) / Trigger.dev | Temporal (correctness-critical) | **Trigger.dev** (Apache 2.0, self-host) / BullMQ (MIT) | **Trigger.dev self-hosted** for agent runs; **BullMQ** for simple Redis queues | 4 | **Inngest orchestration engine CANNOT be self-hosted** — proprietary cloud, only the SDK is OSS [12] — a hard conflict with deploy-per-tenant/docker-first. Trigger.dev v4 GA Aug-2025, Apache 2.0, self-host w/ unlimited runs, warm starts 100–300ms, built for long-running AI work [12][13]. BullMQ = cheap Redis queue but needs a persistent worker + no built-in workflow/timeline [12][13]. Temporal = strongest durability but heavy ops + persistent workers, not serverless [12][13]. |

**Recommendation:** **Trigger.dev (self-hosted, Apache 2.0)** for long-running/agentic background execution — it self-hosts cleanly into the compose stack, gives run timelines/observability that matter for agent debugging, and is purpose-built for AI-heavy long tasks [13]. This **overrides the pivot brief's "Inngest" placeholder**: Inngest is a good product but its un-self-hostable engine disqualifies it for the docker-first default [12]. Redis is already becoming baseline in the pivot (distributed rate limit), so **BullMQ** is the lighter option for plain fan-out queues that don't need workflow orchestration. Temporal is KEEP-AS-OPTION for a tenant with non-negotiable correctness/SLA needs.

---

## 8. Prompt / version management

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit 1-5 | Notes |
|---|---|---|---|---|---|---|---|
| Prompt registry / versioning | In-repo TS modules + git | Langfuse prompt management | Langfuse prompt registry (runtime edits + rollback) | in-repo (git) | **In-repo `lib/ai/prompts/*` (git-versioned) for v1; Langfuse registry ADOPT-LATER** | 4 | Git already gives versioning, diff, review, and rollback for free, and prompts-as-code go through `/ship` + `/code-review` [11]. Langfuse registry adds runtime editing without redeploy + non-dev editors — valuable, but only once non-engineers must edit prompts live. Anthropic prompt caching applies to whichever path (cache the stable system-prompt prefix) [1]. |

**Recommendation:** prompts live in-repo as typed TS (`lib/ai/prompts/`), versioned by git and gated by `/ship` — no new dependency, and it matches the "in-repo vs registry" trade-off honestly: the registry earns its keep only when live, non-deploy prompt edits by non-engineers are a real requirement, at which point Langfuse (already chosen for §6) provides it. Structure prompts so the stable prefix is prompt-cache-friendly.

---

## 9. Guardrails / safety

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit 1-5 | Notes |
|---|---|---|---|---|---|---|---|
| Input/output guardrails | Anthropic-native (system prompts, tool schemas, refusals) + **zod** at the boundary | Guardrails AI (Py + JS, 60+ validators) | NeMo Guardrails (Colang, dialogue control) — Python-only | Guardrails AI (JS-capable) | **Anthropic-native + zod baseline; Guardrails AI validators as opt-in** | 4 | zod already validates every boundary in this repo — extend it to LLM tool inputs/outputs for free (Secure pillar). Guardrails AI supports JS + 60+ validators (toxicity/PII/structured), +50–200ms latency [17]. NeMo is Python-only → poor fit for a TS/Next stack [17]. Add a PII scrub + jailbreak check as a `lib/ai/guardrails.ts` pipeline stage. |

**Recommendation:** the safety floor is **Anthropic-native behavior + zod at the boundary** (already a hard rule here) plus a small `lib/ai/guardrails.ts` doing input PII-scrub / injection heuristics and output schema-validation. This reuses the existing zod-at-the-boundary invariant (Secure pillar) instead of importing a heavy framework. Guardrails AI (JS-capable) is the opt-in upgrade for teams needing its validator hub; NeMo Guardrails is **REJECT** for this stack — Python-only [17].

---

## 10. Per-tenant cost accounting / token metering

Deploy-per-tenant means "per tenant" is often "per deployment," but per-user/per-feature attribution within a tenant still matters for quotas and chargeback.

| Capability | Battle-tested pick | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS | Recommendation (our stack) | Fit 1-5 | Notes |
|---|---|---|---|---|---|---|---|
| Token/cost metering | Helicone (gateway) | Langfuse cost tracking | OpenMeter (metering/billing) / Langfuse | **in-repo meter → Postgres**, OTel GenAI conventions | **In-repo `lib/ai/usage.ts`: record provider token counts to Postgres, tag tenant/user/feature; Langfuse/OpenMeter ADOPT-LATER** | 4 | Best-practice: a thin harness around the SDK records **provider-reported** token counts (never estimated), tags `tenant_id`/`user_id`/`feature`, emits on OTel GenAI semantic conventions [18]. Anthropic `input_tokens` already excludes cache reads/writes [18]. Maintained price tables drift 20–40% if >30 days stale — pull pricing into a versioned table [18]. Reuse the audit-extension pattern to persist usage rows. |

**Recommendation:** a `lib/ai/usage.ts` meter that reads the terminal `usage` block from every completion/stream, writes a usage row (model, input/output/cache tokens, computed cost, `tenant`/`user`/`feature` tags) to Postgres via a Prisma model, and enforces per-tenant/-user ceilings before the call. Emit spans on OTel GenAI conventions so a later swap to Langfuse/OpenMeter needs no re-instrumentation [18]. Keep a versioned price table in-repo (Opus 4.8 $5/$25, Sonnet 5 $2/$10 intro → $3/$15, Haiku 4.5 $1/$5 per 1M in/out as of 2026-07 [19]) and treat >30-day-old pricing as a lint smell.

---

## 11. New scaffold skills the harness needs

Mirror `/scaffold-entity` (Prisma model + zod + API routes + pages + nav + recycling-bin, via `scripts/scaffold-entity.mjs`). Two new generators:

**`/scaffold-ai-endpoint <name>`** — generates a single-shot or streaming AI route:
- `app/api/ai/<name>/route.ts` wrapped in `withAuth` + `withRateLimit` (Node runtime), zod-validated request body, SSE streaming via `lib/ai/stream.ts`.
- `lib/validations/<name>.ts` (zod request/response schemas).
- `lib/ai/prompts/<name>.ts` (typed, git-versioned system/user prompts).
- Per-request cost metering hook (`lib/ai/usage.ts`) + audit entry.
- A Promptfoo golden-case stub in `evals/<name>.yaml`.
- A minimal client component consuming the SSE stream.
- Enforces the **blueprint gate** (a new `app/api/**/route.ts` already requires `docs/blueprints/<feature>.md`) and writes a build-vs-buy ledger note if it adds a new `lib/ai/*` primitive.

**`/scaffold-agent <name>`** — generates a tool-using agent on the native tool-runner:
- `lib/ai/agents/<name>.ts` — `toolRunner()` loop with a system prompt, model default, and max-iteration/`AbortSignal` guards.
- `lib/ai/tools/<name>/*.ts` — zod-typed tool definitions (`betaZodTool`) whose handlers are ordinary server functions behind the auth wrapper (so audit/zod/RBAC invariants hold unchanged).
- Route or Trigger.dev task entry (short agents → SSE route; long agents → background task).
- Guardrails pipeline (`lib/ai/guardrails.ts`) on input/output.
- Cost metering + Langfuse/OTel trace hook; Promptfoo eval stub.
- Blueprint + build-vs-buy + complexity gates applied.

Both should refuse to run without a `Scope:`-covering blueprint (ADR-033) and should register new `lib/ai/*` files in the build-vs-buy ledger (ADR-032), dogfooding the existing gates on the AI layer.

---

## Seed-list verdicts

| Seed item | Verdict | Rationale | ADR impact |
|---|---|---|---|
| `@anthropic-ai/sdk` | **ADOPT-v1** | Native Anthropic-first client; streaming, retries, timeouts, tool-runner, prompt caching built in [1]. Foundation of `lib/ai/*`. | New "AI provider layer" ADR; base dep. |
| tool-runner / Managed Agents vs framework | **RESEARCH-DECIDES → resolved: BUILD native tool-runner** | Native `toolRunner` + `betaZodTool` is the agent loop with zero deps + zero lock-in; frameworks add graph machinery we don't need for deploy-per-tenant tools [2][7]. Mastra = KEEP-AS-OPTION; Managed Agents = ADOPT-LATER (sandboxed-code agents). | New "Agent runtime = native tool-runner" ADR; build-vs-buy ledger entry; resolves ADR-032 open Q. |
| streaming (RSC + SSE) | **ADOPT-v1** | Native SSE from a Node-runtime `withAuth` route keeps auth/zod/cost on the secured path [4][5]. Vercel AI SDK = KEEP-AS-OPTION for rich client chat. | Streaming pattern ADR; `lib/ai/stream.ts`. |
| `pgvector` | **ADOPT-v1** | In-box on dockerized Postgres, one ops story, good < ~10M vectors; pgvectorscale is the in-place upgrade [8][9]. Pinecone rejected (managed SaaS). | Vector-store ADR; Prisma migration for `vector` ext. |
| embeddings + retrieval | **ADOPT-v1** | Voyage (Anthropic-recommended, no first-party endpoint) default; hybrid pgvector⊕FTS + optional rerank [10]. | Retrieval ADR; `lib/ai/embed.ts` + `retrieval.ts`. |
| evals / LLM-as-judge lib | **Promptfoo ADOPT-v1; Langfuse ADOPT-LATER** | Promptfoo = zero-infra CI eval gate (the AI-eval gate the pivot wants); Langfuse (28K★, MIT) = online trace/eval substrate but heavy self-host footprint [6][11]. | AI-eval-gate ADR (L3); Langfuse ADR when online tracing lands. |
| Inngest (agent background execution) | **REJECT → adopt Trigger.dev instead** | Inngest orchestration engine **cannot be self-hosted** — hard conflict with docker-first/deploy-per-tenant [12]. Trigger.dev (Apache 2.0) self-hosts; BullMQ for simple queues [13]. | Background-exec ADR selecting Trigger.dev/BullMQ; overrides brief's Inngest placeholder. |
| prompt / version management | **In-repo ADOPT-v1; registry ADOPT-LATER** | Git gives versioning/review/rollback free; `/ship`-gated prompts-as-code [11]. Langfuse registry only when live non-dev edits needed. | Prompt-management ADR; `lib/ai/prompts/`. |
| guardrails / safety | **ADOPT-v1 (Anthropic-native + zod); Guardrails AI KEEP-AS-OPTION; NeMo REJECT** | Reuse the zod-at-boundary invariant + native refusals; Guardrails AI (JS) opt-in validators; NeMo is Python-only [17]. | Safety ADR; `lib/ai/guardrails.ts`. |
| per-tenant cost accounting | **ADOPT-v1 (in-repo meter)** | Record provider token counts to Postgres, tag tenant/user/feature, OTel GenAI conventions, versioned price table [18][19]. Langfuse/OpenMeter later. | Cost-metering ADR; `lib/ai/usage.ts` + Prisma usage model. |
| `/scaffold-ai-endpoint` | **ADOPT-v1** | Generates secured streaming AI route + zod + prompt + eval + metering; enforces blueprint/build-vs-buy gates. | New skill + `scripts/scaffold-ai-endpoint.mjs`. |
| `/scaffold-agent` | **ADOPT-v1** | Generates native-tool-runner agent + zod tools + guardrails + metering + eval; gate-enforced. | New skill + `scripts/scaffold-agent.mjs`. |

---

## Sequencing — v1 baseline `lib/ai/*` vs later

**v1 baseline (ships in the first "enterprise + dockerized" `lib/ai/*`):**
1. `lib/ai/client.ts` — `@anthropic-ai/sdk` wrapper (models, retries, timeout).
2. `lib/ai/stream.ts` — native SSE streaming helper for Node-runtime routes.
3. `lib/ai/agent.ts` + `lib/ai/tools/**` — native `toolRunner` loop + zod tools.
4. `lib/ai/embed.ts` + `lib/ai/retrieval.ts` — Voyage embeddings + pgvector⊕FTS hybrid; Prisma `vector` migration.
5. `lib/ai/guardrails.ts` — zod + PII/injection pipeline.
6. `lib/ai/usage.ts` + Prisma usage model — per-tenant/-user token metering.
7. `lib/ai/prompts/**` — git-versioned typed prompts.
8. Promptfoo eval gate (`evals/*.yaml`) wired into `/ship`.
9. `/scaffold-ai-endpoint` + `/scaffold-agent` skills.

**Later (KEEP-AS-OPTION / ADOPT-LATER, via `/scale-up` recipes + ADRs):**
- Trigger.dev self-hosted background execution (add when the first long-running agent appears; Redis/BullMQ may precede it since Redis is already becoming baseline).
- Langfuse self-hosted (online tracing/eval/prompt-registry/cost) when a tenant needs live observability or non-dev prompt edits.
- pgvectorscale upgrade at >~10M vectors; Qdrant only if dedicated filtered-search scale demands it.
- Cohere/Voyage reranking stage; Guardrails AI validator hub.
- Anthropic Managed Agents (self-hosted sandbox) for code-exec/computer-use agents.
- Mastra if a genuine multi-step graph/agent-network workflow is required.

**Dependency order:** client → (stream, agent) in parallel → embed/retrieval → guardrails/usage cross-cut all → prompts throughout → eval gate wraps the lot → scaffolds generate against the finished primitives.

---

## Sources

1. `@anthropic-ai/sdk` — npm (v0.110.0, 2026-07). https://www.npmjs.com/package/@anthropic-ai/sdk
2. anthropic-sdk-typescript `helpers.md` (toolRunner, betaZodTool, BetaToolRunner, AbortSignal). https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md
3. Mastra vs LangGraph vs Vercel AI SDK — TypeScript Agents 2026 (Mastra ~21–22K★, 300K weekly dl, Replit/PayPal/Sanity/Brex; LangGraph JS ~8K★). https://particula.tech/blog/mastra-vs-langgraph-vs-vercel-ai-sdk-typescript-agents
4. vercel/ai GitHub (AI SDK ~23.7K★, 11.5M weekly dl, Apr-2026). https://github.com/vercel/ai
5. Next.js 16 AI Integration Patterns / streaming (streamText, RSC+Suspense, 40–60% latency). https://www.digitalapplied.com/blog/nextjs-16-ai-integration-patterns-guide
6. Best LLM Observability Tools 2026 (Langfuse 28K★ MIT; Phoenix 8.9K★ OTEL-native; Braintrust eval-first). https://www.firecrawl.dev/blog/best-llm-observability-tools
7. TypeScript SDK — Claude Platform Docs (tool-runner usage). https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript
8. pgvector vs Pinecone vs Qdrant 2026 Benchmarks (pgvectorscale 471 QPS@99%, 11.4× Qdrant, cost). https://vecstore.app/blog/vector-database-performance-compared
9. pgvector vs Pinecone vs Qdrant vs Weaviate 2026 — production picks (< 10M vectors → pgvector). https://www.kalviumlabs.ai/blog/vector-databases-compared-pgvector-pinecone-qdrant-weaviate/
10. OpenAI vs Cohere vs Voyage embeddings 2026 (Anthropic recommends Voyage; no first-party endpoint; hybrid/rerank). https://www.index.dev/skill-vs-skill/ai-openai-embed-vs-cohere-vs-voyage
11. Token & Cost Tracking / prompt management — Langfuse docs. https://langfuse.com/docs/observability/features/token-and-cost-tracking
12. Inngest vs Trigger.dev vs BullMQ for Next.js 2026 (Inngest engine not self-hostable; Trigger.dev Apache 2.0 self-host). https://www.buildmvpfast.com/blog/inngest-vs-trigger-dev-vs-bullmq-background-jobs-nextjs-2026
13. TypeScript Orchestration: Temporal vs Trigger.dev vs Inngest (Trigger.dev v4 GA Aug-2025, warm starts; Temporal persistent workers). https://medium.com/@matthieumordrel/the-ultimate-guide-to-typescript-orchestration-temporal-vs-trigger-dev-vs-inngest-and-beyond-29e1147c8f2d
14. Scaling Managed Agents — Anthropic Engineering (public beta 2026-04-08; session/harness/sandbox). https://www.anthropic.com/engineering/managed-agents
15. AI SDK Providers: Anthropic / Bedrock + Vertex SDK variants. https://ai-sdk.dev/providers/ai-sdk-providers/anthropic
16. Self-hosted sandboxes — Claude Platform Docs (execution in your infra, orchestration Anthropic-side). https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes
17. Guardrails AI vs NeMo Guardrails 2026 (Guardrails AI Py+JS 60+ validators, 50–200ms; NeMo Python-only Colang). https://is4.ai/blog/our-blog-1/guardrails-ai-vs-nemo-guardrails-comparison-2026-352
18. Per-Tenant LLM Cost Attribution for Multi-Tenant SaaS (provider token counts, OTel GenAI conventions, price-table drift). https://particula.tech/blog/per-tenant-llm-cost-attribution-multi-tenant-saas
19. Anthropic API Pricing July 2026 (Opus 4.8 $5/$25; Sonnet 5 $2/$10 intro → $3/$15; Haiku 4.5 $1/$5). https://www.tldl.io/resources/anthropic-api-pricing
