# C07 — AI & Agent Application Stack

> Exhaustive 4-lens top-10 benchmark. Methodology: `docs/research/v2/METHODOLOGY.md`. This is the **largest net-new gap** in the repo — the fixed stack ships **no** AI layer at all (no LLM SDK, no vector store, no agent runtime). Everything here is `ADOPT (net-new)` unless noted.
>
> **Binding pivot context:** Enterprise-only; **deploy-per-tenant** (NO in-app row-level multi-tenancy — this reshapes "per-tenant metering" into per-deployment metering); **Docker-first**, self-hosted dockerized **Postgres 17** default (Neon optional); **Claude-first** (default Opus 4.8 / Sonnet 5 / Haiku 4.5); TS-native Next 16.2.9 App Router + RSC; agent runtime = **research decides** (verdict below).
>
> Lens tags: `BT` battle-tested · `HS` highest-star/popular · `ENT` enterprise-grade · `OSS` best permissive/self-hostable. Star counts are point-in-time (as-of 2026-07, cross-checked against 2026 sources — see Sources).
>
> **Current-events catches up front (these move defaults):** Langfuse → **acquired by ClickHouse** (Jan 2026, capabilities intact, still MIT/self-host) · Promptfoo → **acquired by OpenAI** (Mar 9 2026, core stays MIT/model-agnostic) · Voyage AI → **owned by MongoDB** (acq. Feb 2025; Voyage 4 shipped Jan 2026, `voyage-4-nano` open-weights) · Mastra → 1.0 (Jan 2026) + **$22M Series A** (Apr 2026), **no SOC 2 yet** as of Mar 2026 · LiteLLM → standalone `liteLLM-proxy` repo **deprecated**, folded into main repo.

---

## LLM provider SDK — `@anthropic-ai/sdk` native vs Vercel AI SDK vs LiteLLM vs LangChain-core

**One line:** How the app talks to Claude. NET-NEW — none in the stack. A Claude-first shop's default is the **native Anthropic SDK**; the question is what abstraction (if any) sits above it for the streaming-UI seam.

| #   | Candidate                                             | Lens   | Stars (2026-07)                            | License                      | Maturity                                   | Why it ranks                                                                                                                                                          |
| --- | ----------------------------------------------------- | ------ | ------------------------------------------ | ---------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`@anthropic-ai/sdk`** (native)                      | BT ENT | ~4k                                        | MIT                          | GA, Stainless-gen, same-day feature parity | First-class Claude: adaptive thinking, effort, **Tool Runner** (`betaZodTool`+`toolRunner`), Managed Agents, prompt caching, streaming helpers. Zero abstraction tax. |
| 2   | **Vercel AI SDK** (`ai` v6 + `@ai-sdk/anthropic` 4.x) | HS BT  | 23.7k                                      | Apache-2.0                   | GA, v6 (2026); 20M+ weekly dl              | TS-native streaming-by-default; `useChat`/`streamText`; 25+ providers; v6 added Agent abstraction, Workflows, MCP. The web-UI streaming layer.                        |
| 3   | **LiteLLM** (SDK + proxy)                             | BT OSS | ~mid-20k                                   | MIT (ent. features separate) | GA; ubiquitous AI gateway                  | OpenAI-shaped facade over 100+ models; cost tracking, load-balance, key mgmt. Python-first; proxy is the value, not the TS SDK.                                       |
| 4   | **LangChain-core** (JS)                               | HS     | ~big (9× AI SDK on stars, ⅕ the downloads) | MIT                          | GA, v1                                     | Broadest integration surface; heavy abstractions, Python idioms in TS. Downloads lag AI SDK 5× — stars ≠ prod use.                                                    |
| 5   | Anthropic Vertex/Bedrock SDKs                         | ENT    | —                                          | MIT                          | GA                                         | `AnthropicVertex`/`AnthropicBedrockMantle` — only if a tenant demands GCP/AWS-native billing. Not the default.                                                        |

**Head-to-head:** Native `@anthropic-ai/sdk` is the correct source-of-truth for a Claude-first, single-provider shop — it exposes every Anthropic feature the day it ships (Tool Runner, Managed Agents, effort, task budgets, compaction) with no lowest-common-denominator flattening. The Vercel AI SDK is **not a competitor** to it; it's a complement — a TS-native _streaming-and-UI_ layer (`streamText` + `useChat` + SSE stream protocol) that the native SDK doesn't provide, at the cost of a thin provider abstraction. LiteLLM and LangChain-core exist to abstract _away_ from a single provider — exactly what a Claude-first shop does **not** want as a default; LiteLLM's real value is its **proxy/gateway** (cost + key governance), not its SDK, and it's Python-centric.

**Recommendation:** `ADOPT (net-new)` — **native `@anthropic-ai/sdk` as the source of truth** for all server-side model calls (services + route handlers), **plus** `ai` + `@ai-sdk/anthropic` **as the client streaming-UI seam only** (`useChat`, `streamText`→SSE). Do **not** route model calls through LiteLLM/LangChain by default. Keep LiteLLM in the back pocket as a _gateway_ option (C10/C14 cross-ref) if multi-provider governance is ever required. **Fit 5/5.** ADR: new "AI provider SDK" ADR pinning native SDK + AI-SDK-for-UI; both >50KB so they clear the Ask-before dep gate via ADR.

---

## Agent / tool-runner framework — the BUILD-VS-BUY centerpiece

**One line:** The loop that lets Claude call tools until done. NET-NEW. The core decision of this category: hand-build a thin wrapper on Anthropic's native Tool Runner, or adopt a framework.

| #   | Candidate                                                                            | Lens      | Stars (2026-07)          | License                            | TS-native / Next-16 RSC         | Anthropic-first                     | Why it ranks                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------ | --------- | ------------------------ | ---------------------------------- | ------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Anthropic native Tool Runner** (`client.beta.messages.toolRunner` + `betaZodTool`) | BT ENT    | (in `@anthropic-ai/sdk`) | MIT                                | ✅ / ✅                         | ✅✅ native                         | Per-turn hooks (approval, interception, retries, `cache_control`), streaming, compaction. **You write only tool fns.** No framework lock-in. |
| 2   | **Anthropic Managed Agents** (CMA)                                                   | ENT       | (API)                    | commercial API (β)                 | ✅ / n/a (hosted)               | ✅✅ native                         | Anthropic hosts loop **and** per-session sandbox; versioned agents, scheduled deployments, vaults, memory stores. The "buy" hosted option.   |
| 3   | **Mastra**                                                                           | HS OSS    | ~22k+                    | Apache-2.0 (Elastic-ish? MIT core) | ✅✅ / ✅ serverless-first      | ⚪ provider-agnostic (Claude works) | Batteries-included TS: workflows, memory gateway, Studio, `@mastra/deployer-vercel`. Prod: Brex, Sanity, WorkOS. **No SOC 2 yet.**           |
| 4   | **LangGraph (JS)**                                                                   | HS BT ENT | ~25k                     | MIT                                | ⚪ / ❌ (Platform ≠ serverless) | ⚪                                  | Graph/stateful orchestration; Uber/Klarna/JPMorgan. TS trails Python 4-8 wks; awkward in Next codebase.                                      |
| 5   | **OpenAI Agents SDK**                                                                | HS        | ~19k                     | MIT                                | ⚪ / ⚪                         | ❌ OpenAI-shaped                    | Lightweight handoffs+guardrails; hosted-tool bias toward OpenAI. Off-thesis for Claude-first.                                                |
| 6   | **Pydantic-AI**                                                                      | HS        | ~15k                     | MIT                                | ❌ Python                       | ⚪                                  | Type-safe, testable; excellent — but Python. No fit for a Next 16 TS repo.                                                                   |
| 7   | **Inngest AgentKit**                                                                 | OSS       | (part of Inngest)        | Apache-2.0                         | ✅ / ✅                         | ⚪                                  | Multi-agent networks + router over Inngest's durable steps. Strong if you already adopt Inngest (C14).                                       |
| 8   | **LlamaIndex.TS**                                                                    | BT        | large                    | MIT                                | ✅ / ⚪                         | ⚪                                  | RAG-first agents; heavier than needed for tool-loop; better as retrieval lib.                                                                |
| 9   | **CrewAI**                                                                           | HS        | large                    | MIT                                | ❌ Python                       | ⚪                                  | Role-based multi-agent; Python, opinionated. Off-stack.                                                                                      |
| 10  | **VoltAgent / Agno**                                                                 | OSS       | rising / large           | MIT                                | ✅ TS / ❌ Py                   | ⚪                                  | VoltAgent = newer TS observability-first agent fw; Agno = fast Python. Neither beats native+Mastra on our axes.                              |

**Scorecard (our axes, ✅/⚪/❌):**

| Framework          | TS-native | Next-16 RSC fit | Anthropic-first | Enterprise-ready               | Lock-in (lower=better) |
| ------------------ | --------- | --------------- | --------------- | ------------------------------ | ---------------------- |
| Native Tool Runner | ✅        | ✅              | ✅✅            | ✅ (self-run)                  | **none**               |
| Managed Agents     | ✅        | hosted          | ✅✅            | ✅✅ (vaults, versioning, SLA) | Anthropic API          |
| Mastra             | ✅✅      | ✅              | ⚪              | ⚪ (no SOC2 yet)               | medium                 |
| LangGraph JS       | ⚪        | ❌              | ⚪              | ✅✅                           | medium-high            |
| OpenAI Agents SDK  | ⚪        | ⚪              | ❌              | ⚪                             | med (OpenAI)           |
| Inngest AgentKit   | ✅        | ✅              | ⚪              | ✅                             | med (Inngest)          |

**Head-to-head:** For a Claude-first, TS-native, Next-16-RSC, deploy-per-tenant enterprise repo the real contest is **native Tool Runner vs Mastra vs Managed Agents** — LangGraph/OpenAI-SDK/Pydantic/CrewAI are either Python, OpenAI-shaped, or serverless-hostile. The native Tool Runner already automates the request→execute→loop cycle with per-turn hooks that cover the "I need control" cases (approval gates, error interception, result modification for prompt-cache, retries) — it is a thin helper over `POST /v1/messages`, adds **zero** new runtime dependency beyond the SDK we're already adopting, and inherits every Claude feature natively. Mastra is the strongest _framework_ answer and genuinely batteries-included (durable workflows, persistent memory, Studio devtools), but it's a large dependency + medium lock-in + **no SOC 2 as of Mar 2026** — a real gate for an enterprise-only rail — and most prototype agents don't need its workflow engine. Managed Agents is the "buy" that wins when you want Anthropic to _host_ the loop and a per-session sandbox (scheduled/long-running/file-mount agents) — it's the simplest option for those, and its scheduled deployments + vaults + memory stores are enterprise-grade, but it's a hosted commercial API (β) that runs off your Docker-first infra.

**BUILD-VS-BUY VERDICT → BUILD (thin wrapper on the native Tool Runner), with a two-tier escalation.** Record in `docs/build-vs-buy-ledger.md` before creating `lib/ai/agent-runtime.ts`.

- **Tier 1 (default, BUILD):** a ~100-line `lib/ai/` wrapper around `client.beta.messages.toolRunner` + `betaZodTool`. Tools are zod-schema'd (reuses the stack's existing zod), gated with the runner's per-turn approval hook, audited through the existing audit extension. This is the `/scaffold-agent` target. Covers the overwhelming majority of internal-tool agents.
- **Tier 2 (BUY, hosted):** **Managed Agents (CMA)** for agents that must run on a **schedule** ("nightly triage"), run **long-horizon** with a workspace, or need Anthropic-hosted sandbox/file-mounts. No loop code to own. Cross-ref C14 background execution.
- **Do NOT adopt a framework (Mastra/LangGraph) in v1.** Re-open the decision (→ **Mastra**) only if/when **durable multi-step workflows + cross-session memory** become a core, repeated requirement AND Mastra ships SOC 2 — at which point pair Mastra with Inngest (C14). Until then a framework is over-buy against the Maintainable pillar.

**Fit 5/5** for native Tool Runner. ADR: "Agent runtime — build thin wrapper on Anthropic Tool Runner; Managed Agents for hosted/scheduled; defer frameworks" (Ask-before: touches `lib/`, new capability → build-vs-buy ledger entry + ADR both required).

---

## Streaming to client in Next 16 (RSC + SSE / streamText / Server Actions)

**One line:** How token-by-token output reaches the browser. NET-NEW; must fit RSC + Node-runtime middleware.

| #   | Pattern                                                                             | Lens  | Maturity | Why it ranks                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------- | ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Route Handler + AI SDK `streamText` → `toUIMessageStreamResponse()` + `useChat`** | BT HS | GA       | The default chat seam. Server holds the Claude connection, SSE to client, zod-validate payload at the boundary, `AbortController` on unmount.                                              |
| 2   | **RSC + `<Suspense>` for AI _reads_**                                               | BT    | GA       | Non-interactive AI output (summaries, classifications) rendered server-side, streamed as HTML — no client SDK in the bundle, keys never leave server. Matches the stack's RSC-read pillar. |
| 3   | **Server Action returning a stream (AI SDK `createStreamableValue`/RSC)**           | BT    | GA       | Good for one-shot streamed values inside an existing form/action flow; avoids a bespoke API route.                                                                                         |
| 4   | **Native `@anthropic-ai/sdk` `.stream()` in a Route Handler, hand-rolled SSE**      | BT    | GA       | Zero-abstraction when you don't want the AI-SDK UI layer; you own the SSE framing + `ReadableStream`.                                                                                      |
| 5   | Raw WebSocket / Pusher                                                              | ⚪    | GA       | Only for bidirectional/multi-user realtime — over-engineered for single-user token streaming (C14 realtime).                                                                               |

**Head-to-head:** For **interactive chat**, AI SDK `streamText` + `useChat` is the least code and handles reconnection, tool-call streaming, and the stream protocol — pair it with `@ai-sdk/anthropic`. For **non-interactive AI output** (the common internal-tool case: "summarize this record"), RSC + Suspense is strictly better — no client JS, no exposed key, integrates with the stack's server-first reads and cuts perceived latency. Route Handlers run on the Node runtime (matching `middleware.ts`); keep edge runtime opt-in only. Every streaming entrypoint still gets the auth wrapper + zod at the boundary (Secure pillar) and an `AbortController` to prevent runaway billing (Scalable pillar).

**Recommendation:** `ADOPT (net-new)` — **RSC+Suspense for reads, AI SDK `streamText`→SSE Route Handler + `useChat` for chat.** This is the `/scaffold-ai-endpoint` output shape. **Fit 5/5.** ADR impact: none beyond the LLM-SDK ADR.

---

## Vector store (AI lens) — pgvector vs Qdrant vs Pinecone vs Weaviate vs Milvus

**One line:** Where embeddings live for RAG. Pivot pre-selected **pgvector on the dockerized Postgres 17**; this lens validates and bounds that.

| #   | Candidate    | Lens       | Stars (2026-07) | License                 | Why it ranks                                                                                                                                                                                                                  |
| --- | ------------ | ---------- | --------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **pgvector** | BT OSS ENT | ~15k+           | PostgreSQL (permissive) | Runs _inside_ Postgres 17 — no extra service, no sync layer, transactional with your data. HNSW matches Qdrant at 99% recall on equal compute (Supabase bench). Handles ~2M vectors untuned. **The pivot's choice, correct.** |
| 2   | **Qdrant**   | BT OSS HS  | ~25k+           | Apache-2.0              | Rust, custom HNSW; fastest self-hosted (p99 ~2ms, ~850 QPS @1M). Dockerizes cleanly. The escape hatch when pgvector plateaus.                                                                                                 |
| 3   | **Pinecone** | BT ENT     | (managed)       | commercial SaaS         | Zero-ops, sub-20ms p95 @5M+; but 3–8× the cost and it's a **hosted** dependency — against Docker-first self-host pivot.                                                                                                       |
| 4   | **Weaviate** | OSS ENT    | ~14k            | BSD-3                   | Hybrid search + modules built-in; heavier to operate than pgvector, another service to run.                                                                                                                                   |
| 5   | **Milvus**   | OSS ENT    | ~large          | Apache-2.0              | Billion-scale, GPU indexes; massive operational surface — over-scaled for internal-tool prototypes.                                                                                                                           |

**Head-to-head:** For a self-hosted, Docker-first, deploy-per-tenant enterprise rail, running the vector index **inside the same Postgres 17 you already ship** is the decisive Maintainable+Scalable win — one container, one backup story, transactional consistency with the relational rows, and it clears the accuracy/latency bar to low-single-digit-million vectors per tenant (which per-tenant deploys rarely exceed). Qdrant is genuinely faster at high QPS/large N and is the right _migration target_ — not the default. Pinecone/Weaviate/Milvus each reintroduce a separate managed or self-run service the pivot deliberately avoids.

**Recommendation:** `ADOPT (net-new) → pgvector` (`KEEP` the pivot decision). Ship it as a Prisma-adjacent extension on the dockerized Postgres; `ADD-AS-OPTION` Qdrant in the `/scale-up` recipe table as the "measured reason to migrate" (>~2–5M vectors/tenant or p99-latency SLA). **Fit 5/5.** Cross-ref C02 (data layer). ADR: "Vector store = pgvector; Qdrant escape hatch."

---

## Embeddings + retrieval (chunking, hybrid search, reranking)

**One line:** Turning text → vectors and getting the right chunks back. NET-NEW.

| #   | Candidate                                             | Lens   | Notes (2026-07)                                                                                                     | License/host      | Why it ranks                                                                                                 |
| --- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | **Voyage 4** (`voyage-4`, `-large`, `-lite`, `-nano`) | BT ENT | Launched Jan 2026, MoE; top retrieval accuracy. **Owned by MongoDB.** `voyage-4-nano` open-weights (self-hostable). | API (+ open nano) | Best-in-class accuracy; Anthropic's own recommended embedding partner historically.                          |
| 2   | **Cohere Embed v4**                                   | BT ENT | 128K context (largest), multilingual/multimodal, native binary quantization.                                        | API               | Best for long-doc / multilingual / storage-at-scale.                                                         |
| 3   | **OpenAI `text-embedding-3-small/large`**             | BT HS  | $0.02/M (small) — cheapest; pair with aggressive chunking + good reranker.                                          | API               | Ship-fast, low-cost default; slightly behind on raw quality.                                                 |
| 4   | **Cohere Rerank 4 Pro** (reranker)                    | BT ENT | ELO 1629 on Agentset leaderboard (Feb 2026) — beats Voyage rerank-2.5 (1544).                                       | API               | The precision layer; best commercial cross-encoder head-to-head (Zerank-2 1638 leads but newer/less proven). |
| 5   | **Voyage rerank-2.5** (reranker)                      | BT     | Strong, single-vendor with embeddings.                                                                              | API               | Convenient if you standardize on Voyage.                                                                     |
| 6   | **BGE / Jina open rerankers**                         | OSS    | Self-hostable cross-encoders; Dockerable.                                                                           | Apache-2.0        | Air-gap / no-egress tenants.                                                                                 |

**Retrieval recipe (the standard 2026 pipeline):** chunk (semantic/recursive, ~512–1024 tok, overlap) → **hybrid**: pgvector dense (top-50) **+** Postgres `tsvector`/BM25 lexical (top-50) → **Reciprocal Rank Fusion** to top-100 → **cross-encoder rerank** to top-10. Note: reranking helps when recall is high/precision low, and _hurts_ when recall is low — so eval before shipping (→ evals item).

**Head-to-head:** Voyage 4 is the accuracy leader and its `voyage-4-nano` open-weights variant is the one embedding model here that can run **self-hosted/air-gapped** — a real enterprise + Docker-first advantage — though the flagship is a MongoDB-owned API. Cohere wins reranking head-to-head (4 Pro > Voyage 2.5) and on long-context/multilingual embeddings. OpenAI embeddings are the cheap default but you pay it back in reranking. For hybrid, the stack **already has Postgres full-text search** — BM25 is free, no new service.

**Recommendation:** `ADOPT (net-new)` — **Voyage `voyage-4` embeddings (default) with `voyage-4-nano` self-hosted for no-egress tenants; Cohere Rerank 4 Pro as the reranker; hybrid = pgvector dense + Postgres `tsvector` BM25 + RRF.** Wrap all three behind a `lib/ai/retrieval.ts` provider seam so a tenant can swap to open BGE reranker. **Fit 4/5** (external API egress is the only friction; nano + open reranker close it). ADR: "Embeddings/reranker providers + hybrid-retrieval recipe."

---

## Evals + LLM-as-judge — Braintrust vs Langfuse vs Arize Phoenix vs Promptfoo vs Openllmetry vs DeepEval

**One line:** Scoring prompt/agent quality before + after ship. NET-NEW; needs to fit `/ship` gates + Docker self-host.

| #   | Candidate                   | Lens       | Notes (2026-07)                                                                                                                         | License/host            | Why it ranks                                                                             |
| --- | --------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| 1   | **Langfuse**                | OSS ENT BT | **Acquired by ClickHouse Jan 2026** (capabilities intact). Tracing + prompt mgmt + evals in one; genuinely free self-host, no per-seat. | MIT, self-host (Docker) | Best OSS fit for Docker-first self-host; also covers prompt mgmt item → consolidation.   |
| 2   | **Promptfoo**               | OSS BT     | **Acquired by OpenAI Mar 9 2026**, core stays MIT/model-agnostic. CLI+YAML, 40+ red-team plugins, MIT, zero cloud.                      | MIT                     | The CI red-team + eval gate — runs in `/ship`, fails builds on injection/PII/regression. |
| 3   | **Braintrust**              | ENT BT     | Eval-integrated observability, deploy-blocking; generous free tier (1M spans).                                                          | commercial SaaS         | Best managed "eval as first-class"; but SaaS, off Docker-first.                          |
| 4   | **Arize Phoenix**           | OSS ENT    | **OTEL-native** from the ground up; needs Postgres+K8s to self-host.                                                                    | Elastic-2.0/Apache      | Strongest if OpenTelemetry standard is a hard req (C10 cross-ref).                       |
| 5   | **DeepEval**                | OSS HS     | 50+ metrics, **pytest** integration, agent evals, OSS core.                                                                             | Apache-2.0              | Best metric-gate library — but Python (fits eval CI, not the TS app).                    |
| 6   | **OpenLLMetry** (Traceloop) | OSS        | OTEL GenAI instrumentation SDK; feeds any OTEL backend.                                                                                 | Apache-2.0              | Instrumentation layer, not an eval product — pairs with Phoenix/Langfuse.                |

**Head-to-head:** For this stack the split is **Langfuse (observability + prompt mgmt + eval store, self-hosted via Docker) + Promptfoo (CI eval/red-team gate)**. Langfuse is the only pick that is simultaneously OSS, self-hostable in the Docker-first world, free without per-seat pricing, and _also_ solves prompt management — one fewer tool. Promptfoo is the CI complement: YAML-configured, MIT, runs headless in `/ship` as an adversarial + quality gate (the OpenAI acquisition kept it MIT/model-agnostic, so no lock-in risk). Braintrust is the best managed experience but is SaaS (off-thesis). Phoenix wins only if OTEL is mandated (defer to C10). DeepEval/OpenLLMetry are Python/instrumentation pieces, not primary. **LLM-as-judge:** run the judge on **Claude (Sonnet 5 or Haiku 4.5 for cost)** via the native SDK, scored inside Langfuse/Promptfoo.

**Recommendation:** `ADOPT (net-new)` — **Langfuse (self-hosted, Docker) as the eval+trace store; Promptfoo as the `/ship` CI eval/red-team gate; Claude-as-judge (Sonnet 5) via native SDK.** `ADD-AS-OPTION` Braintrust for teams wanting managed. **Fit 5/5** (both Dockerize). ADR: "Evals = Langfuse + Promptfoo; Claude-as-judge." Cross-ref C10 (observability), C12 (testing/QA gates).

---

## Prompt / version management

**One line:** Versioning prompts as deployable artifacts, not string literals. NET-NEW.

| #   | Candidate                                       | Lens    | Notes                                                                                                             | Why it ranks                                           |
| --- | ----------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | **Langfuse Prompt Management**                  | OSS ENT | Named prompts, linear versions, `production` label, SDK fetch-by-label. **Same platform as evals** → consolidate. | MIT self-host; no extra tool.                          |
| 2   | **Git-native (prompts as `.ts`/`.md` in repo)** | OSS BT  | Prompts committed as typed modules, reviewed via PR, shipped with the deploy. Zero infra.                         | Matches the repo's "push = deploy" + code-review gate. |
| 3   | **Agenta**                                      | OSS     | Git-like branching, parallel variants, commit history.                                                            | Heavier; only if non-devs edit prompts.                |
| 4   | **PromptLayer**                                 | ENT     | Playground + version control, dev-team workflow.                                                                  | SaaS.                                                  |
| 5   | **Latitude**                                    | OSS     | Open-source prompt-eng + agent platform.                                                                          | Overlaps Langfuse; pick one.                           |

**Head-to-head:** Two viable models. **Git-native** (prompts as version-controlled typed modules) is the _most maintainable_ for a repo whose whole ethos is "push = deploy" + `/code-review` — prompts travel with the code, get reviewed, and can't drift from the deployed version; no runtime fetch, no extra service. **Langfuse prompt management** adds runtime hot-swap (promote a version without a redeploy) + non-dev editing + links each prompt to its eval scores — valuable once prompts are iterated by stakeholders. Since Langfuse is already adopted for evals, enabling its prompt registry is near-free.

**Recommendation:** `ADOPT (net-new)` — **Git-native prompts as the default (typed `lib/ai/prompts/*.ts`, reviewed, deployed with code); Langfuse prompt registry as the ADD-AS-OPTION** for hot-swap / non-dev iteration once evals are in. **Fit 5/5.** ADR: folds into the evals ADR.

---

## Guardrails / safety — Guardrails-AI vs NeMo vs LLM-Guard vs Anthropic-native + zod

**One line:** Validating/sanitizing inputs and outputs. NET-NEW; the Secure pillar's AI extension.

| #   | Candidate                    | Lens    | Notes                                                                                                                                                           | Host                  | Why it ranks                                                                                                    |
| --- | ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | **Anthropic-native + zod**   | BT ENT  | `stop_reason: "refusal"` handling + safety classifiers built into Claude; **zod at the boundary** validates every tool input/output (already the stack's rule). | in-SDK + existing zod | The floor, free, no new dep. Handle refusals, validate structured outputs with `output_config.format` (strict). |
| 2   | **LLM Guard** (Protect AI)   | OSS     | Middleware scanner chain: PII, prompt-injection, toxicity, secrets — prompts **and** responses.                                                                 | Apache-2.0, self-host | Best OSS I/O sanitizer; Dockerizes; the PII/injection layer over the native floor.                              |
| 3   | **Guardrails AI**            | OSS     | Composable validator hub, PII redaction.                                                                                                                        | freemium              | Good validators; freemium model + Python.                                                                       |
| 4   | **NeMo Guardrails** (NVIDIA) | OSS ENT | Colang conversation rails, topical guardrails; 100–300ms latency.                                                                                               | Apache-2.0            | Only when you need _conversational_ topic/flow rails (chatbots), not I/O validation.                            |
| 5   | **Llama Guard 3**            | OSS     | Content-safety classifier model.                                                                                                                                | open weights          | Self-hosted content classifier; complements, not replaces.                                                      |

**Head-to-head:** These are complementary abstractions for different jobs, not competitors. For a Claude-first shop the **native layer does most of the work**: Claude's own safety classifiers + `refusal` handling cover harmful-content, and **zod-at-the-boundary (already mandated by the stack)** guarantees structured I/O — that's the Secure pillar's floor at zero new dependency. Add **LLM Guard** as the self-hosted middleware for the enterprise concerns Claude doesn't own: **PII detection/redaction, prompt-injection scanning, secret-leak scanning** on both prompt and response — it Dockerizes and fits self-host. NeMo's Colang conversation rails are over-engineered for internal tools (reserve for a genuine chatbot). Guardrails-AI's freemium + Python is a worse fit than LLM Guard.

**Recommendation:** `ADOPT (net-new)` — **Anthropic-native (refusal handling + strict structured outputs) + zod boundary validation as the required floor; LLM Guard (self-hosted) as the PII/injection/secret scanner** wired into `lib/ai/` I/O. This dovetails with the existing `no-restricted-export-column` / audit-scrub rules. **Fit 5/5.** ADR: "AI guardrails = native + zod floor, LLM Guard for PII/injection." Cross-ref SECURITY.md threat model.

---

## Agent background execution — Inngest vs Trigger.dev vs BullMQ vs Temporal

**One line:** Running long/durable agent jobs off the request path. NET-NEW; the stack's `/scale-up` already names **Inngest** for jobs.

| #   | Candidate                                            | Lens      | Stars (2026-07) | License             | Why it ranks                                                                                                                                                                        |
| --- | ---------------------------------------------------- | --------- | --------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Inngest**                                          | BT HS OSS | large           | Apache-2.0 (+ SaaS) | Event-driven durable steps; **every LLM call is naturally a step** (no determinism constraint). Ships **AgentKit**. Minutes-to-first-function. Already the `/scale-up` recipe.      |
| 2   | **Trigger.dev** v3/v4                                | BT OSS    | large           | Apache-2.0          | TS-native durable tasks, compute-second pricing (favors long AI jobs), self-hostable.                                                                                               |
| 3   | **Temporal**                                         | BT ENT    | large           | MIT                 | Strongest polyglot + mission-critical durability; but LLM non-determinism fights its deterministic-workflow model; heavy ceremony. OpenAI-Agents-SDK integration GA (Py, Mar 2026). |
| 4   | **BullMQ**                                           | BT OSS    | large           | MIT                 | Redis-backed queue; simplest/cheapest, but you build durability/retries/observability yourself.                                                                                     |
| 5   | **Restate**                                          | OSS       | rising          | BSL/MIT             | Newer durable-execution; promising, less proven.                                                                                                                                    |
| 6   | **Anthropic Managed Agents — scheduled deployments** | ENT       | (API)           | commercial β        | Cron-fired sessions with per-run records — the _hosted_ alternative to running your own scheduler (agent-runtime Tier 2).                                                           |

**Head-to-head:** Inngest is the best fit for TS-native durable **agent** execution: it was architected around steps, so an LLM call (inherently non-deterministic) is just a step with no determinism requirement — the exact opposite of Temporal, whose deterministic-workflow model requires you to shove every LLM call into a non-deterministic "activity" with heavier ceremony. Inngest also ships AgentKit (multi-agent networks + router) and it's **already in the repo's `/scale-up` recipe table**, so adopting it is consistent, not net-new architecture. Trigger.dev is a close TS-native second (better pricing model for very long jobs). Temporal wins only for polyglot, mission-critical, ultra-long workflows — over-scaled here. BullMQ is the floor if you just need a Redis queue. **For scheduled/hosted agents specifically**, Managed Agents' scheduled deployments are the zero-infra option (no scheduler to run) — pair the two: Inngest for self-hosted durable jobs, CMA for hosted-scheduled.

**Recommendation:** `ADOPT (net-new) → Inngest` (`KEEP` the `/scale-up` recipe; promote it to the agent-runtime background tier). **ADD-AS-OPTION** Trigger.dev (self-host durable tasks) and **Managed Agents scheduled deployments** (hosted cron agents). **Fit 5/5** (Inngest Dockerizes / has a dev server). ADR: "Background agent execution = Inngest; CMA for hosted-scheduled." Cross-ref C14 (jobs/cron).

---

## Per-tenant cost / token metering

**One line:** Attributing token spend + enforcing ceilings. NET-NEW — **reshaped by the deploy-per-tenant pivot: there is no in-app tenant dimension, so "per-tenant" = per-deployment.**

| #   | Candidate                                                        | Lens    | Notes                                                                                                                                                                                           | Why it ranks                                                             |
| --- | ---------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | **Thin token-meter wrapper → Postgres + Langfuse cost tracking** | OSS BT  | Every model call already goes through `lib/ai/`; record `usage.{input,output,cache_*}_tokens` per call, roll up in Postgres, cost dashboards in Langfuse. **Per-deployment = per-tenant here.** | Build-thin; reuses adopted Langfuse; no new service.                     |
| 2   | **Helicone**                                                     | OSS ENT | Proxy/gateway with cost tracking + per-tenant tagging; self-hostable.                                                                                                                           | If you want a drop-in gateway (adds a hop).                              |
| 3   | **OpenMeter**                                                    | OSS ENT | Usage-event ingestion + pricing → metering reports; for **usage-based billing** of AI to customers.                                                                                             | Only if AI usage is _billed_ to end customers.                           |
| 4   | **LiteLLM proxy**                                                | OSS     | Gateway with built-in cost tracking + budgets/key quotas.                                                                                                                                       | The gateway option if multi-provider governance ever lands (C07 item 1). |
| 5   | **OTEL GenAI semantic conventions**                              | OSS     | Vendor-neutral instrumentation substrate; feeds any backend.                                                                                                                                    | The portable foundation under all of the above (C10).                    |

**Head-to-head:** Because the pivot is **deploy-per-tenant with no row-level multi-tenancy**, the hard problem that metering products solve — attributing spend across tenants inside one app via SDK/gateway tagging — mostly _disappears_: each deployment **is** one tenant, so per-deployment token roll-ups already answer "what does this tenant cost." That makes a **thin build** the right call: since every Claude call already funnels through `lib/ai/`, record the `usage` block (Claude returns exact input/output/cache tokens on every response) to a Postgres table, price it, and surface it in the already-adopted **Langfuse** cost dashboards. A gateway (Helicone/LiteLLM) is only worth its extra hop if you need cross-provider governance; **OpenMeter** is only warranted if you _bill_ customers for AI usage (usage-based pricing) — otherwise it's over-buy.

**Recommendation:** `ADOPT (net-new) → build thin` (Postgres usage table + Langfuse cost tracking, keyed per-deployment). `ADD-AS-OPTION` OpenMeter (only if AI is metered/billed to customers) and Helicone/LiteLLM (only if a gateway is adopted). **Fit 5/5.** Build-vs-buy ledger entry required for the `lib/ai/metering.ts` file. ADR: folds into observability/evals ADR.

---

## What `/scaffold-agent` and `/scaffold-ai-endpoint` should generate

Two new harness skills, mirroring `/scaffold-entity`'s end-to-end wiring. Both must satisfy the enforcement trio (build-vs-buy ledger → blueprint → complexity) and the Five Pillars.

**`/scaffold-ai-endpoint <name> --mode chat|completion|structured`** — a single Claude-backed endpoint:

- `app/api/ai/<name>/route.ts` — Route Handler wrapped in `withAuth`/`withEditorAuth`; **zod-validated request body** at the boundary; native `@anthropic-ai/sdk` call (`model: claude-opus-4-8` default, `thinking: {type:"adaptive"}`, effort selectable).
- **Streaming:** `--mode chat` → AI SDK `streamText`→`toUIMessageStreamResponse()` + a `useChat` client component; `--mode completion` → RSC + `<Suspense>` server read; `--mode structured` → `output_config.format` (strict zod schema) + `messages.parse()`.
- `lib/ai/prompts/<name>.ts` — typed, git-versioned system prompt.
- Guardrails: refusal-handling branch, `AbortController`, LLM-Guard PII scan hook, token-usage recorded to the metering table.
- `lib/validations/<name>.ts` zod schema; Langfuse trace wrapper; a Promptfoo eval stub (`evals/<name>.yaml`) seeded so `/ship` has a gate.
- A `docs/blueprints/<name>.md` stub (blueprint gate) + build-vs-buy ledger line.

**`/scaffold-agent <name> --tools t1,t2 --tier local|hosted`** — a tool-running agent:

- `--tier local` (default, BUILD): `lib/ai/agents/<name>.ts` wrapping `client.beta.messages.toolRunner` + `betaZodTool` tools; each tool's `run()` gated with the approval hook, inputs zod-schema'd, side-effects audited via the existing audit extension. Route Handler entrypoint + streaming per above.
- `--tier hosted` (BUY): generates the **Managed Agents** setup (agent YAML + `ant beta:agents create`) + a session-driver in `lib/ai/agents/<name>.ts`; used for scheduled/long-horizon/sandboxed agents. Optionally an Inngest function for self-hosted background runs.
- Both: tool definitions in `lib/ai/tools/`, Langfuse tracing, per-call token metering, refusal + error handling, a Promptfoo agent-eval stub, blueprint stub, and a build-vs-buy ledger entry (adopting the native runtime, not a framework).
- Emits an ADR stub when the agent touches auth/schema/`lib/` (Ask-before surface).

---

## Category verdict table

| Item                                        | Current                       | Recommendation                                                                                                | Net-new deps to add                            | ADR impact                  | Priority |
| ------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------- | -------- |
| LLM provider SDK                            | none                          | ADOPT: native `@anthropic-ai/sdk` (source of truth) + `ai`/`@ai-sdk/anthropic` (UI streaming)                 | `@anthropic-ai/sdk`, `ai`, `@ai-sdk/anthropic` | New ADR (SDK + dep-gate)    | **P0**   |
| Agent / tool-runner                         | none                          | **BUILD** thin wrapper on native Tool Runner; Managed Agents (BUY) for hosted/scheduled; **defer frameworks** | (SDK only)                                     | New ADR + ledger            | **P0**   |
| Streaming (Next 16)                         | none                          | ADOPT: RSC+Suspense reads; AI SDK `streamText`→SSE + `useChat` chat                                           | (via `ai`)                                     | folds into SDK ADR          | **P0**   |
| Vector store                                | none                          | ADOPT/KEEP: **pgvector** on dockerized PG17; Qdrant escape hatch                                              | `pgvector` ext                                 | New ADR                     | **P0**   |
| Embeddings + retrieval                      | none                          | ADOPT: Voyage `voyage-4` (nano self-host) + Cohere Rerank 4 Pro + hybrid (pgvector+`tsvector`+RRF)            | `voyageai`/`cohere-ai` SDKs                    | New ADR                     | **P1**   |
| Evals + LLM-judge                           | none                          | ADOPT: Langfuse (self-host) + Promptfoo (CI gate) + Claude-as-judge                                           | Langfuse SDK, `promptfoo`                      | New ADR                     | **P1**   |
| Prompt/version mgmt                         | none                          | ADOPT: git-native typed prompts; Langfuse registry optional                                                   | (none / Langfuse)                              | folds into evals ADR        | **P1**   |
| Guardrails / safety                         | none                          | ADOPT: native refusal+strict-output + zod floor; LLM Guard (self-host) PII/injection                          | `llm-guard` (svc)                              | New ADR + SECURITY.md       | **P1**   |
| Background agent exec                       | Inngest in `/scale-up` recipe | ADOPT/KEEP: **Inngest**; Trigger.dev + CMA scheduled as options                                               | `inngest`                                      | New ADR                     | **P1**   |
| Per-tenant cost metering                    | none                          | **BUILD thin**: PG usage table + Langfuse cost; OpenMeter only if billed                                      | (none)                                         | folds into obs ADR + ledger | **P2**   |
| `/scaffold-agent` + `/scaffold-ai-endpoint` | none                          | BUILD: two new harness skills (shapes above)                                                                  | (harness)                                      | —                           | **P1**   |

---

## Sources

1. Speakeasy — Choosing an agent framework (LangChain/LangGraph/CrewAI/PydanticAI/Mastra/Vercel AI SDK): https://www.speakeasy.com/blog/ai-agent-framework-comparison
2. Particula — Mastra vs LangGraph vs Vercel AI SDK, TS agents 2026: https://particula.tech/blog/mastra-vs-langgraph-vs-vercel-ai-sdk-typescript-agents
3. LangChain — Best AI agent frameworks 2026: https://www.langchain.com/resources/ai-agent-frameworks
4. Mastra GitHub: https://github.com/mastra-ai/mastra
5. Mastra $22M Series A (Apr 2026): https://faq.com.tw/en/developer-tools/2026-04-10-mastra-22m-series-a-typescript-agents-en/
6. Decisioncrafters — Mastra 22.3k stars: https://www.decisioncrafters.com/mastra-build-production-ready-ai-agents-in-typescript-with-22-3k-github-stars/
7. open-techstack — LangGraph vs OpenAI Agents SDK vs PydanticAI 2026: https://open-techstack.com/blog/langgraph-vs-openai-agents-sdk-vs-pydanticai-2026/
8. Braintrust — Langfuse alternatives 2026 (ClickHouse acquisition): https://www.braintrust.dev/articles/langfuse-alternatives-2026
9. Latitude — Best LLM observability tools 2026: https://latitude.so/blog/best-llm-observability-tools-agents-latitude-vs-langfuse-langsmith
10. Vecstore — pgvector vs Pinecone vs Qdrant 2026 benchmarks: https://vecstore.app/blog/vector-database-performance-compared
11. Tensoria — Pinecone/Weaviate/Qdrant/pgvector 100M benchmark: https://tensoria.fr/en/blog/vector-database-comparison
12. Kalvium — vector DBs compared (pgvector/Pinecone/Qdrant/Weaviate) 2026: https://www.kalviumlabs.ai/blog/vector-databases-compared-pgvector-pinecone-qdrant-weaviate/
13. index.dev — OpenAI vs Cohere vs Voyage embeddings 2026: https://www.index.dev/skill-vs-skill/ai-openai-embed-vs-cohere-vs-voyage
14. bestaiweb — RAG reranking Cohere 4 Pro vs Voyage 2.5 vs Zerank-2 (2026): https://www.bestaiweb.ai/how-to-add-reranking-to-your-rag-pipeline-with-cohere-rerank-4-pro-voyage-rerank-2-5-and-zerank-2-in-2026/
15. MongoDB — Why MongoDB acquired Voyage AI: https://www.mongodb.com/company/blog/news/redefining-database-ai-why-mongodb-acquired-voyage-ai
16. MongoDB — Voyage 4 models: https://www.mongodb.com/docs/voyageai/models/
17. Braintrust — Best Promptfoo alternatives 2026 (OpenAI acquisition): https://www.braintrust.dev/articles/best-promptfoo-alternatives-2026
18. genai.qa — Promptfoo vs DeepEval 2026: https://genai.qa/blog/promptfoo-vs-deepeval/
19. aisecurityandsafety — NeMo Guardrails vs Guardrails AI 2026: https://aisecurityandsafety.org/en/compare/nemo-guardrails-vs-guardrails-ai/
20. dev.to/agdex_ai — LLM Guard vs NeMo vs Guardrails AI 2026: https://dev.to/agdex_ai/best-ai-agent-security-guardrails-tools-in-2026-llm-guard-vs-nemo-vs-guardrails-ai-5e5d
21. wetheflywheel — Temporal vs Inngest 2026 durable execution: https://wetheflywheel.com/en/comparisons/temporal-vs-inngest/
22. pkgpulse — Inngest vs Trigger.dev v3 vs Restate 2026: https://www.pkgpulse.com/guides/inngest-vs-trigger-dev-v3-vs-restate-2026
23. digitalapplied — Next.js 16 AI integration patterns: https://www.digitalapplied.com/blog/nextjs-16-ai-integration-patterns-guide
24. Vercel AI SDK RSC streaming docs: https://ai-sdk.dev/docs/ai-sdk-rsc/streaming-react-components
25. Vercel — AI SDK 6 announcement: https://vercel.com/blog/ai-sdk-6
26. vercel/ai GitHub: https://github.com/vercel/ai
27. LiteLLM GitHub: https://github.com/BerriAI/litellm
28. metacto — LLM cost attribution per-user/per-tenant: https://www.metacto.com/blogs/llm-cost-attribution-per-user-feature
29. Torii — 7 tools for tracking AI token usage 2026: https://www.toriihq.com/articles/seven-tools-for-tracking-ai-token-usage-across-vendors
30. Langfuse prompt management docs: https://langfuse.com/docs/prompt-management/overview
31. Anthropic Claude Agent SDK (TypeScript) — overview + repo: https://code.claude.com/docs/en/agent-sdk/overview · https://github.com/anthropics/claude-agent-sdk-typescript
32. Claude API skill (bundled, authoritative for Claude SDK/Tool Runner/Managed Agents): models Opus 4.8/Sonnet 5/Haiku 4.5, `toolRunner`+`betaZodTool`, Managed Agents scheduled deployments.
