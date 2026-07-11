# ADR-036 — AI / agent stack: build a thin Claude-native runtime, don't buy a framework

**Status:** Accepted (enterprise pivot, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-022 (model-tier routing + agent memory); ADR-020 (senior-code-reviewer LLM-as-judge pattern, mirrored here by the ai-eval gate).

## Context

The AI layer is the single largest net-new gap in the stack: the template
currently ships **none** of it — no provider wrapper, no agent loop, no RAG, no
eval harness. Everything else in the enterprise pivot (Docker, structured DB,
pgvector) is a hardening of something already present; the AI stack is greenfield.

The enterprise pivot is **Claude-first** — the source of truth is
`docs/research/v2/enterprise-benchmark-v2.html`, category **C07** (AI / agent
stack) reinforced by the architects' read in **C15**. That framing matters: a
Claude-first template does not need the model-agnostic abstraction layer that
justifies most agent frameworks, and paying for one imports churn we'd never amortize.

The deeper asymmetry: the harness gates **code** thoroughly — the gate-trio
(build-vs-buy → blueprint → complexity), the eleven ESLint rules, `/ship`,
`/code-review`, the senior-code-reviewer — but **nothing gates model outputs**.
An AI endpoint today would ship un-evaluated: no regression suite over prompts,
no judge on answer quality, no adjudication artifact when quality regresses. The
AI stack has to arrive with its governance already attached, or it violates the
template's own "gates, not vibes" contract on day one.

## Decision drivers

- **Claude-first** — one provider, first-class; no model-agnostic tax.
- **Avoid agent-framework lock-in + churn** — Mastra / LangGraph move fast and
  break APIs; a template inherits that maintenance whether it uses the surface or not.
- **Gate model outputs the way code is gated** — outputs get a judge + an eval
  suite + an adjudication artifact, mirroring how code gets `/ship` + reviewers.
- **Smallest net-new maintained surface** — every line we own is a line a fork
  inherits and we patch forever; prefer the vendor's native primitive.
- **RSC / SSE streaming UI seam** — the front end needs a clean server-component
  → streamed-token path without dragging a runtime into the client.

## Considered options

### Option 1 — Build a thin (~100-line) wrapper on Anthropic's native Tool Runner (chosen)

A `lib/ai/` provider built directly on `@anthropic-ai/sdk`, using the beta
`messages.tool_runner` agentic loop for tool-calling rather than a hand-rolled
or framework loop. Hosted / scheduled execution rides **Anthropic Managed
Agents**, so long-running or cron-triggered agent work does not need our own
orchestration substrate. The **Vercel AI SDK is used ONLY as the streaming-UI
seam** (RSC → SSE token streaming), never as the runtime or the tool loop.
Frameworks (Mastra / LangGraph) are **explicitly deferred**, not adopted.

RAG rides **pgvector**, tied to the `pgvector/pgvector:pg18` image (ADR-035), so
retrieval reuses the mandatory structured DB rather than adding a vector store.
Embeddings are **pluggable** (Voyage / Cohere, P1) behind the `lib/ai/` seam.
Evals use **Langfuse** (tracing, self-hosted) + **Promptfoo** (the eval suite).

- Good: minimal maintained surface; Claude-native; no framework lock-in; RAG and
  streaming reuse primitives the stack already commits to.
- Bad: we own the wrapper — the ~100 lines, and tracking the `tool_runner` beta.

### Option 2 — Adopt an agent framework (Mastra / LangGraph)

- Good: batteries included — loops, memory, tool registries, integrations out of the box.
- Bad: heavy dependency and lock-in; high churn against fast-moving APIs; the
  bulk of the surface goes unused in a Claude-first template, so we'd maintain
  compatibility with features we never call.

### Option 3 — Vercel AI SDK as the runtime

- Good: excellent streaming DX; already the front-end idiom for token UIs.
- Bad: not built for server-side tool-loops, evals, or output governance; using
  it as the runtime would fork our logic across two abstractions. Keep it strictly
  as the UI streaming seam (its actual strength).

## Decision

Adopt **Option 1**. The deciding drivers are **Claude-first** (no model-agnostic
tax to pay), **gate model outputs** (governance ships with the layer), and
**least net-new surface** (own ~100 lines on native primitives, not a framework).
`lib/ai/` wraps `@anthropic-ai/sdk`'s `messages.tool_runner`; Managed Agents host
scheduled/long-running work; the Vercel AI SDK is the RSC→SSE streaming seam only;
Mastra / LangGraph are deferred. RAG uses pgvector (ADR-035); embeddings are
pluggable (P1). Tracing = Langfuse; eval suite = Promptfoo.

**AI-output governance (the gate-trio becomes a gate-quartet).** Model outputs
get the same treatment code gets — this is the non-negotiable half of the decision:

1. **An `ai-eval` agent** — an LLM-as-judge over model outputs, mirroring the
   `senior-code-reviewer` pattern from ADR-020: judge + eval suite (Promptfoo) +
   an adjudication artifact in `docs/findings-register.md`. This is the fourth
   gate alongside build-vs-buy → blueprint → complexity.
2. **An AI-eval `/ship` gate** — on AI forks, the Promptfoo suite runs and the
   `ai-eval` judge scores outputs; a regression goes **RED** unless waived via an
   adjudicated findings-register line (the ADR-025 ack pattern). Non-AI forks skip
   it entirely (no AI endpoints → no gate).
3. **A `/scaffold-ai-endpoint` generator** — emits an AI route with its eval
   fixtures, tracing, and blueprint stub wired in, so an AI endpoint cannot be
   born ungated (parallels `/scaffold-entity`).
4. **A conditional 6th pillar — AI-Quality** — groundedness / no-hallucination /
   refusal-correctness / output-safety, kept **inert on non-AI forks** and **NOT
   folded into High-Quality**. Keeping it separate means a fork with no AI surface
   carries zero AI ceremony, while an AI fork gets a first-class, independently
   adjudicated gate rather than a footnote under an existing pillar.

Model-tier routing (which Claude tier serves which call) follows **ADR-022** — no
new routing policy; the AI layer consumes the existing haiku/sonnet/opus table.

## Consequences

### Positive
- Claude-native from day one; no framework compatibility layer to maintain.
- Model outputs are gated the same way code is — quality regressions block `/ship`,
  with a committed adjudication trail, closing the "code is gated, outputs aren't" gap.
- RAG and streaming reuse committed primitives (pgvector image; Vercel AI SDK for UI),
  so the net-new surface is genuinely ~100 lines plus the eval wiring.
- Non-AI forks pay nothing: the 6th pillar and the AI-eval gate stay inert.

### Negative
- We own the wrapper and track a **beta** API (`messages.tool_runner`) — churn risk
  sits with us, not a vendor's framework.
- Two eval tools (Langfuse + Promptfoo) plus Managed Agents add operational moving
  parts on AI forks (self-hosted tracing, an eval suite to keep green).
- Embeddings deferred to P1 means the first RAG cut is not yet provider-flexible.

### Mitigations
- The wrapper is deliberately thin and seam-shaped: if `tool_runner` graduates or
  breaks, the blast radius is `lib/ai/`, not scattered call sites.
- The AI-eval gate is fork-conditional — the tooling cost lands only where AI ships.
- pgvector + the pluggable embedding seam let RAG start today and swap the embedder
  later without touching call sites.

## Alternatives considered
1. **Agent framework (Mastra / LangGraph).** Rejected — lock-in + churn for a
   surface a Claude-first template mostly never calls.
2. **Vercel AI SDK as the runtime.** Rejected as runtime — not built for
   server-side tool-loops / evals / governance; retained only as the UI streaming seam.

## Migration triggers
- Revisit if multi-step orchestration outgrows the Tool Runner loop (durable
  branching workflows, human-in-the-loop checkpoints) → reconsider a framework then, not now.
- Revisit if non-Anthropic models become a hard requirement → introduce a cascade
  router behind `lib/ai/` (P2), not a rewrite.

## Related
- ADR-020 — senior-code-reviewer LLM-as-judge pattern (mirrored by the ai-eval gate).
- ADR-022 — model-tier routing + agent memory (the routing this layer consumes).
- ADR-025 — tiered gate + ack/register escape pattern (how the AI-eval gate waives).
- ADR-035 — `pgvector/pgvector:pg18` image (the RAG substrate).
- `docs/research/v2/07-ai-agent-stack.md` — the category C07 research.
- `docs/research/v2/15-architects-ai-era.md` — the architects' C15 read.
