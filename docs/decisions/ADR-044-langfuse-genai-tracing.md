# ADR-044 — Langfuse LLM tracing by reusing the OTel backbone (GenAI semconv, no new dep)

**Status:** Accepted (enterprise pivot, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-040 (OpenTelemetry backbone + swappable OTLP backend), ADR-036 (Claude-native AI runtime, `lib/ai/*`).
**Related:** ADR-042 (AI-Quality pillar / evals).

## Context

WS-5 shipped the Claude-native AI runtime (`lib/ai/*`, ADR-036). LLM calls are
the most expensive, most failure-prone, and least observable operation in the
app: latency, token cost, and finish reasons are invisible without generation-level
tracing. The enterprise pivot's LLM-observability bar points at **Langfuse** —
traces, generations, cost, and eval scoring for LLM apps.

The naive path is to add the **Langfuse SDK** (`langfuse` / an OpenTelemetry
instrumentation package) and instrument `runAgent` against it directly. But WS-4
(ADR-040) already stood up an **OpenTelemetry backbone**: `withSpan` over
`@opentelemetry/api`, exporting **OTLP** to a swappable backend, a silent no-op
until `OTEL_EXPORTER_OTLP_ENDPOINT` is set. And **Langfuse ingests OTLP** and
renders spans carrying the OpenTelemetry **GenAI semantic-convention** attributes
(`gen_ai.*`) as LLM generations. So the tracing we need is achievable with **zero
new dependencies** by decorating the spans we already emit.

## Decision drivers

- **No new runtime dep** — the Ask-before rule gates a >50 KB runtime dep behind
  an ADR/recipe; a second SDK also means a second telemetry path to keep coherent
  with the OTel one (the exact "two paths" negative ADR-040 called out).
- **Instrument-once / swap-backend** — the ADR-040 invariant: the sink is a
  config choice, never an app-code diff. Tracing must not break that.
- **No vendor lock-in** — the same spans must land in Langfuse, SigNoz, a
  Collector, or a managed APM by re-pointing OTLP, with no code change.
- **PII floor (SECURITY.md §1)** — prompt/completion text is Restricted; the
  default trace must carry metadata only, never content.

## Considered options

### Option 1 — Reuse the OTel backbone, emit GenAI semconv attributes (chosen)

Add `lib/ai/tracing.ts`: `withAiSpan(name, opts, fn)` wraps `lib/observability`'s
`withSpan` and sets the OTel GenAI attributes — `gen_ai.system`,
`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
`gen_ai.response.finish_reasons` — reading token usage + finish reason off the
final message a `runAgent` run resolves to. A fork points
`OTEL_EXPORTER_OTLP_ENDPOINT` at **Langfuse's OTLP endpoint** and the spans render
as generations.

- **Good:** zero new deps; one telemetry path; instrument-once/swap-backend
  preserved (Langfuse is just another OTLP sink); no-op-safe when OTel is off
  (inherited from `withSpan`); vendor-neutral (`gen_ai.*` is a standard, not a
  Langfuse-proprietary shape).
- **Bad:** GenAI semconv is still evolving; some Langfuse-native niceties (nested
  observation types, prompt-management linkage) that a first-party SDK surfaces
  are not modeled by generic OTLP spans.

### Option 2 — Adopt the Langfuse SDK / OTel instrumentation package

Add `langfuse` (or its OTel exporter) and instrument `runAgent` against it.

- **Good:** first-party generation/trace/score model; prompt-management + eval
  linkage out of the box.
- **Bad:** a new runtime dep (Ask-before ADR anyway); a **second telemetry path**
  parallel to the OTel backbone — the coherence cost ADR-040 explicitly warned
  about; couples app code to one vendor, breaking the swap-backend invariant.

### Option 3 — No LLM tracing

- **Good:** nothing to build.
- **Bad:** token cost, latency, and finish reasons stay invisible on the app's
  most expensive operation — fails the LLM-observability bar.

## Decision

Adopt **Option 1**: implement LLM tracing by **reusing the WS-4 OTel backbone**
and emitting **GenAI-semantic-convention** span attributes from `lib/ai/tracing.ts`.
**Langfuse is consumed as an OTLP sink, not as an SDK** — a fork enables it by
pointing `OTEL_EXPORTER_OTLP_ENDPOINT` at Langfuse's OTLP endpoint (with the
Langfuse auth header a fork sets via `OTEL_EXPORTER_OTLP_HEADERS`), zero app-code
change. The deciding drivers are **no new dep** and **instrument-once/swap-backend**:
Option 2's second telemetry path and vendor coupling are precisely the costs
ADR-040 was built to avoid.

Trace content defaults to **metadata only**. Prompt/completion **text is never a
span attribute by default**; optional content capture is gated behind
`AI_TRACE_CONTENT` (default OFF) for a trusted debug session against a private
sink — the SECURITY.md §1 Restricted-data floor holds in the default posture.

## Consequences

### Positive

- Langfuse LLM observability with **zero new dependencies** and **one** telemetry
  path; the ADR-040 swap-backend invariant is preserved (Langfuse ↔ SigNoz ↔
  Collector is a config re-point).
- `withAiSpan` is no-op-safe when OTel is off (inherited from `withSpan`), so
  callers never branch on whether tracing is configured.
- Emitting the vendor-neutral `gen_ai.*` semconv means the same spans work in any
  OTLP-native LLM backend, not just Langfuse.

### Negative

- GenAI semconv is evolving; attribute names may shift and need a follow-up.
- Generic OTLP spans don't model every Langfuse-native construct (prompt linkage,
  nested observation typing) a first-party SDK would.

### Mitigations

- The attribute keys are centralized in `GEN_AI_ATTR` in one file, so a semconv
  update is a single-file change.
- If a tenant standardizes on deep Langfuse-native features, Option 2 remains
  available as an additive `/scale-up` step — this ADR does not preclude it.

## What is verifiable now vs infra-dependent

- **Verifiable now (no infra):** `withAiSpan` sets the correct `gen_ai.*`
  attributes and is a no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset; the
  PII default (no content unless `AI_TRACE_CONTENT`) holds. Covered by unit
  behavior against the OTel no-op tracer.
- **Infra-dependent (not testable in CI):** that spans actually **render as
  generations in Langfuse** requires a live Langfuse OTLP endpoint + credentials —
  a fork-time deploy verification, not a `/ship` gate.

## Related

- ADR-040 — OpenTelemetry backbone + swappable OTLP backend (the backbone reused).
- ADR-036 — Claude-native AI runtime (`lib/ai/*`) whose calls are traced.
- ADR-042 — AI-Quality pillar / evals (the quality half; tracing is the ops half).
- `docs/blueprints/enterprise-ws5-tracing.md` — the requirements contract.
