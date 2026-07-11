Scope: lib/ai/tracing.ts

# Blueprint — Enterprise WS-5: GenAI tracing over the OTel backbone

> Governs `lib/ai/tracing.ts` — LLM tracing for the WS-5 AI runtime built by
> REUSING the WS-4 OpenTelemetry backbone (ADR-040), emitting OpenTelemetry
> GenAI-semantic-convention attributes so a fork gets Langfuse (or any OTLP LLM
> backend) with **no new dependency**. Decision of record: **ADR-044**.
> Build-vs-buy recorded in `docs/build-vs-buy-ledger.md` (2026-07-11 — GenAI
> tracing over OTel). This file is the requirements contract `/qa`/`/uat` trace
> against.

## Problem & outcome

LLM calls (`lib/ai`, ADR-036) are the app's most expensive and least observable
operation — latency, token cost, and finish reasons are invisible without
generation-level tracing. WS-4 already ships an OTel backbone (`withSpan`, OTLP,
no-op until `OTEL_EXPORTER_OTLP_ENDPOINT` is set). Langfuse ingests OTLP and
renders `gen_ai.*`-attributed spans as generations. **Outcome:** a `withAiSpan`
helper that decorates the spans we already emit with GenAI-semconv metadata, so
pointing OTLP at Langfuse yields LLM traces with zero app-code change — and never
leaks prompt/completion text.

## Market scan

- **Langfuse SDK** — first-party generation/trace/score model, prompt linkage.
  Rejected as the default: a new runtime dep + a second telemetry path parallel
  to OTel (the coherence cost ADR-040 warned of) + vendor coupling. Remains an
  additive `/scale-up` option (ADR-044 Option 2).
- **OpenLLMetry / OTel GenAI semconv** — the vendor-neutral `gen_ai.*` attribute
  standard Langfuse/SigNoz/Collectors all key off. **Chosen surface** — emitted
  by hand (a handful of `setAttribute` calls), so no instrumentation dep either.
- **Raw `withSpan` with ad-hoc attributes** — works but drifts from the semconv,
  so backends wouldn't recognize generations. Rejected in favor of the standard.

## User stories

- As an **operator debugging cost**, I see token counts + finish reason per LLM
  call in my trace backend, so I can spot a runaway loop or an oversized prompt.
- As an **SRE**, I point `OTEL_EXPORTER_OTLP_ENDPOINT` at Langfuse and the same
  spans render as generations — no code change, matching the ADR-040 swap-backend
  seam.
- As a **security owner**, I trust that prompt/completion **text never leaves in a
  span** by default (Restricted, SECURITY.md §1); content capture is opt-in.

## Happy path

`withAiSpan("ai.summarize", { model, maxTokens }, () => runAgent({ messages, tools }))`
→ span opens with `gen_ai.system` / `gen_ai.request.model` set → `runAgent`
resolves to the final message → `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`,
`gen_ai.response.model` read off it → span ends OK. With OTLP pointed at Langfuse,
this is a generation row; with OTLP unset, it is a zero-overhead no-op.

## Worst path

- **OTel off** → `withSpan` is a no-op; `withAiSpan` adds a closure call, nothing
  exported, no throw.
- **`runAgent` throws** → `withSpan` records the exception, marks the span ERROR,
  re-throws unchanged (instrumentation never swallows failures).
- **Partial/absent metadata** (streaming, a compat gateway with no `usage`) →
  each response attribute is set only when present; no crash on a missing field.
- **Someone tries to trace prompt text** → blocked by default: content is set
  only through `recordAiContent`, itself a no-op unless `AI_TRACE_CONTENT` is on.

## Architecture sketch

`lib/ai/tracing.ts` (new; covered by the `lib/ai/**` build-vs-buy ledger entry):

- `withAiSpan(name, opts, fn)` → wraps `withSpan`; sets request attrs before `fn`,
  response attrs from `fn`'s result after.
- `setAiRequestAttributes` / `setAiResponseAttributes` — the metadata mappers
  (duck-typed `AiResultLike`, never SDK-coupled).
- `GEN_AI_ATTR` — the semconv key registry (one place to track a semconv update).
- `aiTraceContentEnabled()` + `recordAiContent()` — the OFF-by-default content gate.
  No new dep. No Prisma, no auth surface, no route. Reuses `../observability`.

## Tier & gates

Tier: inherits repo tier. Security floor: metadata-only by default (no PII in
spans); `AI_TRACE_CONTENT` gates the only content path, default OFF. No new
runtime dep (ADR-044). Emits vendor-neutral `gen_ai.*` — no lock-in.

## Open questions (resolved)

- **New Langfuse dep?** No — reuse OTel + GenAI semconv (ADR-044).
- **Log prompt/completion?** No by default — metadata only; content behind
  `AI_TRACE_CONTENT` (OFF).
- **New env var for the endpoint?** No — reuse `OTEL_EXPORTER_OTLP_ENDPOINT`
  (+ a fork's `OTEL_EXPORTER_OTLP_HEADERS` for Langfuse auth).

## What is verifiable now vs infra-dependent

- **Now:** correct `gen_ai.*` attributes set; no-op when OTel off; content
  suppressed unless `AI_TRACE_CONTENT` on.
- **Infra-dependent:** spans rendering as Langfuse generations needs a live
  Langfuse OTLP endpoint + credentials — a fork-time deploy check, not a `/ship`
  gate.
