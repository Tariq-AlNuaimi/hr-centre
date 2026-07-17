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

### 2026-07-11 — Excel export (exceljs → SheetJS track)

Scope: lib/export.ts, lib/export/**
Considered: exceljs (current, stalled), SheetJS/xlsx (community-CDN distribution caveat), write-excel-file (small).
Decision: build-thin-wrapper; track migration off stalled exceljs. See ADR-051.

### 2026-07-11 — OpenAPI contract seam

Scope: lib/openapi/**
Considered: zod-openapi (chosen — reuses existing zod), @asteasolutions/zod-to-openapi, hand-written spec, tRPC.
Decision: adopt zod-openapi + Scalar + Schemathesis (thin generation layer). See ADR-052 + blueprint.

### 2026-07-11 — Docs site

Scope: lib/docs/**
Considered: Fumadocs (chosen — RSC-native, in-app), Nextra, Astro Starlight, Mintlify (SaaS), plain markdown.
Decision: adopt Fumadocs (mounts in the existing Next app — one image). See ADR-053 + blueprint.

### 2026-07-11 — Background job queue

Scope: lib/queue/**, lib/jobs/**
Considered: pg-boss (chosen — Postgres-backed, no new infra), BullMQ (needs Redis/Valkey), Inngest/Trigger.dev (SaaS), Temporal (heavy).
Decision: adopt pg-boss — reuses the existing Postgres, no extra service for v1. See PHASE-2-BACKLOG WS-3.

### 2026-07-11 — OpenTelemetry SDK

Scope: lib/otel/**, lib/observability/**, instrumentation.ts
Considered: @opentelemetry/sdk-node + @vercel/otel (chosen), Sentry-only, none.
Decision: adopt the OTel sdk-node set behind lib/otel — instrument-once, swap backend (SigNoz/GlitchTip). See ADR-040 / PHASE-2-BACKLOG WS-4.

### 2026-07-11 — Seed data factories

Scope: prisma/factories.ts, lib/factories/**
Considered: @faker-js/faker (chosen, dev-dep), hand-written seeds (current), snaplet (shut down), neosync (archived).
Decision: adopt @faker-js/faker for FK-valid seed graphs (dev-dep only). See 20-remaining-sweep.md.

### 2026-07-17 — Token/spend observability (ccusage) — V2-106

Scope: package.json (npm run tokens)
Considered: **ccusage** (chosen — reads the local `~/.claude/projects/**/*.jsonl` Claude Code
logs, per-session/model/daily spend + cost tables, zero runtime dep — run via `npx -y
ccusage@latest session`, no install), building an in-repo log-analyzer (would re-implement
ccusage's JSONL parsing + model price table + cost math, ongoing upkeep as the log schema and
prices move — no unique-to-us value), leaning on `docs/token-policy.md` prose + the observe-only
`routing-report` receipts alone (guidance/tier-adherence only, no actual $ spend accounting —
they answer "did recon run on haiku", not "what did this program cost").
Decision: **adopt ccusage as a dev-tool, invoked via `npx` (no dependency added to package.json's
deps/devDeps)** — smallest maintained surface for real per-session spend, and it feeds ADR-054's
"budget line" trigger (once the operator sets a budget, the `routing-report` receipt promotes
from observe-only to a soft `/ship` gate). Dev-tool run via npx ⇒ no runtime dep ⇒ no ADR
required; this ledger entry is the adjudication. This entry is informational for the gate (ADR-032
matches only `lib/` files; the command lives in `package.json`). See ADR-054 (routing-adherence /
budget-line trigger); `docs/token-policy.md`.
<!-- Verified 2026-07-17: `npm run tokens` (npx -y ccusage@latest session) produced a real
     per-session/model spend report from this container's local Claude Code logs (egress to the
     npm registry was available). On an egress-blocked machine the npx fetch fails — run ccusage
     on a machine with npm-registry egress (it only needs the local `~/.claude` logs to read); the
     wrapper command is unchanged and correct. -->

Scope: package.json (playwright-bdd — dev-dependency), scripts/bdd-coverage.mjs
Considered: **playwright-bdd** (chosen as the Gherkin executor — turns `.feature` files into
Playwright tests on the EXISTING @playwright/test runner from ADR-008, so fixtures/tracing are
reused, not a second stack; dev-only, no runtime/bundle cost), **@cucumber/cucumber** (a full
separate BDD runner — would duplicate the Playwright runner and its fixtures/tracing; heavier, two
stacks), **plain Playwright specs + a tag-lint** (no Gherkin — a tagged empty test passes, so no
"unimplemented scenario = red"; weaker than the exit criterion). For the TRACEABILITY GATE itself
(story↔scenario↔step coverage math), build-in-repo won: `scripts/bdd-coverage.mjs` is dependency-
free, parses blueprint USn + `.feature` @tags + step defs, and is unit-tested — the coverage
verdict must be ours, not a black box.
Decision: **adopt playwright-bdd as the Gherkin EXECUTOR (dev-dependency) and BUILD
`scripts/bdd-coverage.mjs` as the owned traceability GATE** (ADR-058, Accepted 2026-07-17 — operator
signed off; playwright-bdd installed + executor wired). Phased: the owned
checker + `tests/features/` layout ship now with NO dependency (the checker needs none); the
playwright-bdd install + the enforced `/ship --full` flip await the operator's ADR-058 sign-off and
V2-401 (`/ship --full`, Phase 4). Dev-dependency ⇒ ADR-058 records the adoption; this ledger entry
is the build-vs-buy adjudication. Informational for the ADR-032 hook (it matches only `lib/` files;
these live in `scripts/` + `package.json`). See ADR-058, ADR-008; `scripts/bdd-coverage.mjs`.
