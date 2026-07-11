# Build-vs-Buy Ledger

**Machine-checked by `.claude/hooks/build-vs-buy-gate.mjs` (ADR-032).** Before a new
capability file is hand-built under `lib/`, the gate requires a decision here whose
`Scope:` glob covers the file. This is the enforcement half of CLAUDE.md's advisory
"Market benchmark before building" + "reuse existing primitives" rules — it converts
them from prose the model skips under load into a hard checkpoint.

Recording an entry is **not a bypass** — it _is_ the gate working: you did the reuse
scan, named what you considered, and chose build-vs-adopt on the record. The ledger
doubles as a durable, reviewable audit trail of every build-vs-buy call.

## How to add an entry

When the gate denies a new `lib/` file, do the scan, then append an entry:

1. **Check for an existing primitive** — `docs/REPO-MAP.md`, `lib/`, `components/shared/`.
2. **Check the vetted recipes** — the `/scale-up` recipe table (uploads, cron, jobs,
   realtime, PDF, …) and `docs/recipes.md`.
3. **Web-search for a library / open-source fit** — and weigh it against the Ask-before
   ">50 KB runtime dep needs an ADR or /scale-up recipe" rule.
4. Append the decision below. The `Scope:` line is what the gate matches (comma-separated
   globs; `*` = one path segment, `**` = any depth).

### Entry template

```
### YYYY-MM-DD — <capability>
Scope: lib/<area>/**
Considered: <option A — note>, <option B — note>, <library/open-source — note>.
Decision: <build | adopt | build-thin-wrapper-around-X> because <reason>. See <blueprint/ADR>.
```

---

## Decisions

### 2026-07-10 — PDF export (seed example)

Scope: lib/pdf/**
Considered: pdfkit (in-process; intentionally absent from lib/export.ts — fragile in
serverless per ADR-006), @react-pdf/renderer (heavy, >50 KB, own layout engine),
Stirling-PDF self-hosted sidecar (MIT core, REST API — adopted as a /scale-up recipe).
Decision: build a thin `lib/pdf/` HTTP client that POSTs to the Stirling-PDF sidecar
behind an internal-auth shared secret; no in-process PDF engine. Fills the deliberate
PDF-export gap without embedding a fragile serverless dependency. See ADR-032; a full
`docs/blueprints/pdf-export.md` is written when the recipe is actually built.
<!-- This seed entry is illustrative — lib/pdf/ is not yet built. Remove or supersede
     it when the real PDF recipe lands. It exists so the gate has a worked example and
     so `Scope: lib/pdf/**` demonstrates the match format. -->

### 2026-07-11 — AI runtime (Claude-native)

Scope: lib/ai/**
Considered: Mastra / LangGraph (full agent frameworks — heavy deps, lock-in, high churn;
most features unused for a Claude-first template), Vercel AI SDK as the runtime (great
streaming DX but not built for server-side tool-loops / evals / governance), building a
thin wrapper on Anthropic's native Tool Runner (`@anthropic-ai/sdk` beta `messages.tool_runner`).
Decision: **build a thin (~100-line) provider + tool-runner wrapper** in `lib/ai/` on the
native Anthropic Tool Runner; use the Vercel AI SDK ONLY as the RSC/SSE streaming-UI seam;
defer frameworks. Smallest maintained surface, Claude-first, no framework lock-in. See
ADR-036; blueprint `docs/blueprints/enterprise-p0-baseline.md` (WS-5).

### 2026-07-11 — Authorization policy seam

Scope: lib/authz/**
Considered: Cerbos (self-host PDP — the deferred default engine, P2), OpenFGA (ReBAC —
deferred hatch, P2), Oso OSS (deprecated 2025 — rejected), a hand-built in-repo seam.
Decision: **build a minimal `authorize(session, action, resource)` seam** over the existing
3-role enum (no external engine in v1); it becomes the single integration point a future
Cerbos/OpenFGA adoption plugs into, and pairs with a `no-inline-role-check` ESLint rule.
Adopting an engine is a later, ADR-recorded departure. See ADR-037.

### 2026-07-11 — Observability client (OpenTelemetry)

Scope: lib/observability/**, lib/otel/**
Considered: Sentry SaaS SDK only (ADR-002 — lock-in), Grafana Faro / LGTM client (AGPL
redistribution concern), the vendor-neutral OpenTelemetry SDK (`@vercel/otel` + OTLP).
Decision: **adopt OpenTelemetry** as the instrument-once client (thin helpers in
`lib/observability/`, wired from root `instrumentation.ts`), exporting OTLP to a swappable
Collector → SigNoz backend; not a hand-built tracer. See ADR-040; blueprint WS-4.

### 2026-07-11 — Distributed rate limiter (Valkey)

Scope: lib/rate-limit/**, lib/valkey.ts
Considered: keep the in-memory token bucket (correctness bug under >1 replica — SECURITY.md
T-01), `@upstash/ratelimit` (SaaS/Upstash-oriented; the old swap note), `rate-limiter-flexible`
backed by **Valkey** (Redis fork, BSD — Redis itself relicensed off OSS). Decision: **adopt
`rate-limiter-flexible` on Valkey** for the shared-state limiter, with the existing in-memory
limiter kept as the single-container fallback; thin `lib/valkey.ts` client. Replaces the
per-instance bucket that load-balancing bypasses. See ADR-035 (self-host topology); blueprint WS-3.

### 2026-07-11 — AI endpoint scaffolder (`/scaffold-ai-endpoint`)

Scope: scripts/scaffold-ai-endpoint.mjs
Considered: Plop / Hygen / Yeoman (generic code-generators — a new dep + template DSL to learn,
and none know this repo's `lib/ai` barrel, auth wrappers, or Five-Pillars floor), hand-writing
each AI route per fork (the drift this gate exists to stop), **extending the existing in-repo
`scripts/scaffold-entity.mjs` generator pattern** (same `parseArgs` + inline-template + idempotency
mechanics, zero new deps). Decision: **build** — mirror our own scaffold rail so a generated AI
endpoint bakes in the exact wiring (`isAiConfigured()` 503 guard, `withRateLimit` outside auth,
zod boundary, `withSpan` trace, `lib/ai` import) that a generic generator could not enforce. This
entry is informational (the gate matches only `lib/` files; the generator lives in `scripts/`).
See ADR-036; blueprint `docs/blueprints/enterprise-ws5-followon.md`.

### 2026-07-11 — Background job queue (pg-boss) — P1, entry ahead of build

Scope: lib/queue/**
Considered: Inngest (SaaS/hosted — a /scale-up recipe), BullMQ (needs Redis/Valkey +
workers), **pg-boss** (Postgres-backed queue — no new datastore, rides the mandatory DB).
Decision: **adopt pg-boss** when a fork needs durable background jobs — reuses the existing
Postgres, no new infrastructure. Deferred to P1; entry recorded now so the gate is ready.
See ADR-014 (/scale-up recipe library); blueprint WS-4/WS-5 follow-on.

### 2026-07-11 — AI eval runner + gate (`ai-eval`, LLM-as-judge)

Scope: scripts/ai-eval.mjs
Considered: Promptfoo (YAML-config eval framework — a new dep + config DSL that doesn't know
this repo's auth-wrapped routes, the `lib/ai` barrel, or the `{ data: { text } }` response
shape), keploy (record/replay API testing — built for deterministic API mocks, not
LLM-as-judge quality scoring), a hand-run per-fork eval script (rots + drifts, no gate),
**building a thin (~200-line) runner** on the existing `lib/ai` (`runAgent` as the judge) +
tsx's programmatic loader + `fetch`. Decision: **build** — the runner reuses the shipped model
seam and the scaffold's fixture contract with zero new deps, and its LLM-judge is one
`runAgent` call; a config-DSL framework buys less than it costs here. Re-evaluate Promptfoo at
P2 if eval needs outgrow the in-house judge (ADR-036 migration trigger). This entry is
informational (the ADR-032 gate matches only `lib/` files; the runner lives in `scripts/`).
See ADR-036; blueprint `docs/blueprints/enterprise-ws5-ai-eval.md`.

### 2026-07-11 — Embeddings + pgvector RAG seam

Scope: lib/ai/embeddings.ts, lib/ai/rag.ts
Considered: Voyage/Cohere Node SDKs (each >50KB — the Ask-before dep line — for what
is a two-field REST POST), a dedicated vector DB (Pinecone/Weaviate/Qdrant — new
infrastructure to run), a RAG framework (LangChain/LlamaIndex — heavy, opinionated
chunking + store abstractions a seam doesn't need), vs. **building a thin
fetch()-based embeddings seam + a raw pgvector table on the existing Neon Postgres**.
Decision: **build the thin seam** — dep-free, endpoint-configurable providers (same
wire-native / endpoint-is-config stance as the Claude provider, ADR-036), and
pgvector rides the mandatory Postgres (no new datastore — the same reasoning that
put the queue on pg-boss and the rate limiter on Postgres/Valkey). Silent no-op
until EMBEDDINGS_API_KEY is set. Files land under the existing `Scope: lib/ai/**`
AI-runtime ledger entry; this entry is the explicit embeddings/RAG adjudication.
See ADR-043; blueprint docs/blueprints/enterprise-ws5-rag.md.

### 2026-07-11 — GenAI tracing over the OTel backbone

Scope: lib/ai/tracing.ts
Considered: Langfuse SDK / its OTel exporter (first-party generation+score model, prompt linkage — but a new runtime dep + a SECOND telemetry path parallel to the OTel backbone, the coherence cost ADR-040 warned of, + vendor coupling that breaks the swap-backend invariant), the OpenTelemetry GenAI semantic convention `gen_ai.*` (vendor-neutral attribute standard that Langfuse/SigNoz/Collectors all ingest via OTLP — emitted by hand as a few setAttribute calls, so NO instrumentation dep either), raw withSpan with ad-hoc attribute names (works but drifts from semconv so backends wouldn't recognize generations).
Decision: build-thin-wrapper-around-the-WS4-OTel-backbone (withAiSpan over lib/observability withSpan, emitting gen_ai.* semconv) because Langfuse ingests OTLP, so reusing OTEL_EXPORTER_OTLP_ENDPOINT yields Langfuse (or any OTLP LLM backend) with ZERO new dependency and ONE telemetry path — preserving the ADR-040 instrument-once/swap-backend invariant. See ADR-044 / docs/blueprints/enterprise-ws5-tracing.md.

### 2026-07-11 — Enterprise SSO + SCIM identity seam (Ory Polis)

Scope: lib/sso/**
Considered: **Ory Polis / BoxyHQ SAML Jackson** (Apache-2.0 sidecar — bridges any
tenant's SAML into a standard OIDC endpoint Auth.js already consumes AND speaks
SCIM 2.0 in the SAME service — one container, both NET-NEW rows); Keycloak /
Authentik / Zitadel (full self-hosted IdPs — a whole identity microservice suite,
heavy for the deploy-per-tenant single-IdP shape; documented as BYO-IdP); Better
Auth native SAML+OIDC+SCIM plugins (in-app, but only reachable by rewriting off
Auth.js — the tracked P1 migration, not this phase); WorkOS / Clerk / Auth0
(managed B2B SSO — SaaS + per-connection "SSO tax", value muted by deploy-per-tenant
and contradicts the self-host pivot); the `@boxyhq/saml` NextAuth provider package
(turnkey but a runtime dep on the Ask-before surface + couples us to its Auth.js-v5
support); **building SCIM in-house** (the 2026 consensus is buy/adopt — SCIM is
harder than SSO: PATCH quirks, few OSS scaffolds).
Decision: **adopt Ory Polis as an opt-in compose sidecar (OSS boxyhq/jackson image,
Apache-2.0) + build a thin dep-free app-side seam under lib/sso/**: a config-driven
GENERIC OIDC provider in lib/auth.ts (issuer = Polis .well-known — zero new runtime
dep, mirrors the Entra OIDC wiring / ADR-024) and a small SCIM provisioning handler
(withInternalAuth + optional BoxyHQ HMAC) that maps directory events onto the
existing User model reusing the soft-delete + audit invariants, VIEWER-default
least privilege. Polis owns the protocol complexity; the app just consumes OIDC +
a provisioning webhook — the smallest maintained surface, fully OSS/self-hostable,
silent no-op until POLIS__/SCIM__ env is set. See ADR-045;
blueprint docs/blueprints/enterprise-ws6-identity.md.
