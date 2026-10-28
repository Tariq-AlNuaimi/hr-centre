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

### 2026-08-26 - provision-logins (one-off account backfill + demo-cast passwords)

Scope: scripts/provision-logins.mjs

**Capability:** give employees who already exist in a database a login they should have had —
and, separately, set passwords for the five people in `docs/demo/DEMO-CAST.md`.

**Why it exists at all:** ADR-069 made the import and `seed-pms.ts` provision logins, but neither
helps a database seeded BEFORE that behaviour. Production is exactly that case: 37 employees, no
`User` rows.

**Considered:**

- **Re-run `prisma/seed-pms.ts`** (the obvious reuse, and the first thing tried). Rejected: it
  rewrites every employee row and needs `SALARY_ENCRYPTION_KEY` to re-encrypt pay (ADR-067) —
  an enormous blast radius to fix a missing foreign key. This script touches two things,
  `users` rows and `employees.userId`, and nothing else.
- **Create the accounts by hand at `/users/new`.** Reuses a shipped screen and needs no code, and
  it is still the documented path for a handful. Rejected for 37: an afternoon of clicking, one
  typo away from a duplicate-email refusal partway through.
- **`scripts/manual-uat-users.mjs`** — the closest existing tool, and the shape the demo-cast mode
  follows deliberately (credentials from env, never printed, never defaulted). Rejected as-is: it
  provisions one login per `Role` enum value for the UAT harness, not per PMS employee, and it
  refuses to run outside a local/test database — which is the opposite of what is needed here.
- **A migration.** Rejected: this is data backfill for one deployment's history, not a schema
  change, and burying it in `prisma/migrations/` would re-run it as part of every future deploy's
  `migrate deploy`.

**Decision:** build, ~120 lines, no new dependency (Prisma + the app's own `hashPassword`).
Dry-run by default; idempotent; skips leavers and any email that already has an account, live or
soft-deleted.

### 2026-07-18 — AI-pattern primitives (components/shared/ai/\*\*)

Scope: components/shared/ai/**
Considered: **shadcn/ui blocks / a prebuilt "AI chat" kit** (e.g. the shadcn-registry AI blocks,
Vercel `ai-elements`) — they target chat/completion UIs (message list, prompt box, tool calls), not
the Rihal advisory pattern (a human-decides frame over a finding with confidence + citations), so
adopting one means fighting its chat shape and pulling its dep tree; **Tremor** — charts/KPI only, no
AI-advisory surface; **build thin on the shipped shadcn/Tailwind primitives** (chosen) — these are
tiny presentational components (Badge/Card/Button + tokens) encoding MIGRATION.md's shared AI
contract (royal ✦ mark, advisory framing, honest 503/loading states, human decides), reused across
every AI-augmented fork.
Decision: **BUILD `components/shared/ai/`** — `AiAssistPanel`, `AiStreaming`, `ConfidenceChip`,
`CitationLink`, `ResponsibleAiBanner`, `AgentActivity` — thin, on-token, a11y/RTL-safe primitives on
the existing shadcn layer (CommandPalette already exists in `components/layout/`). Zero new runtime
dependency. Standardizes the AI-Quality pillar's UI surface (ADR-042; MIGRATION.md "AI pattern
primitives"). Demoed on `/style-guide`.

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
prices move — no unique-to-us value), leaning on `docs/ARCHITECTURE.md` §7 prose + the observe-only
`routing-report` receipts alone (guidance/tier-adherence only, no actual $ spend accounting —
they answer "did recon run on haiku", not "what did this program cost").
Decision: **adopt ccusage as a dev-tool, invoked via `npx` (no dependency added to package.json's
deps/devDeps)** — smallest maintained surface for real per-session spend, and it feeds ADR-054's
"budget line" trigger (once the operator sets a budget, the `routing-report` receipt promotes
from observe-only to a soft `/ship` gate). Dev-tool run via npx ⇒ no runtime dep ⇒ no ADR
required; this ledger entry is the adjudication. This entry is informational for the gate (ADR-032
matches only `lib/` files; the command lives in `package.json`). See ADR-054 (routing-adherence /
budget-line trigger); `docs/ARCHITECTURE.md` §7.
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

Scope: components/shared/PageShell.tsx, components/shared/StatGrid.tsx, components/shared/FormLayout.tsx
Considered: **build the missing layout primitives in-repo** (chosen — 3 thin, token-scale wrappers:
PageShell/StatGrid/FormLayout), **adopt a shadcn "blocks" layout kit / a headless layout lib**
(rejected — the repo already ships the vetted `components/shared/*` set: EmptyState, DescriptionList,
SectionCard, Toolbar, StatCard, PageHeader, FormField; a third-party layout kit would duplicate them
and drag in its own spacing scale, fighting `app/tokens.css`), **keep hand-rolling grid/spacing
classes per page** (rejected — that is exactly the per-page drift V2-302 exists to stop). The three
new files are pure composition wrappers (no deps) that own spacing/columns on the token scale and use
only RTL-safe logical utilities (`space-y-*`, `gap-*`, `justify-end`, no `ml/mr`/`left/right`).
Decision: **build the 3 genuinely-missing primitives; extend/reuse the 6 that already exist** (V2-302
"extend existing where present"). No dependency added. Informational for the ADR-032 gate (it matches
`lib/**`; these live in `components/shared/**` — which V2-309 brings under the gate). See
`docs/design-recipes.md` (compose-first) + `docs/design-references.md` (archetype anchors).

Scope: eslint-rules/rules/no-arbitrary-className.mjs
Considered: **eslint-plugin-tailwindcss** (installed and evaluated as the off-the-shelf option, then
REMOVED — its `no-arbitrary-value` rule bans ALL `[...]` values bluntly, which would false-positive
on the ~50 legit arbitrary values the repo relies on: `grid-cols-[1fr_auto]`, `w-[calc(...)]`,
`min-h-[44px]` touch targets, `data-[state=open]:` variants, arbitrary colors — with no way to scope
it to just the spacing + type axes; its `no-contradicting-classname` is orthogonal and speculative,
not worth carrying an unused dependency for), **build a scoped local rule** (chosen —
`no-arbitrary-className`, the layout sibling of `no-raw-hex-color`: flags an arbitrary value ONLY on
the utilities the design scale governs — spacing p/m/gap/space and font-size `text-[...px|rem|em]` —
and leaves every other arbitrary value alone), **do nothing / rely on review** (rejected — off-scale
`p-[13px]`/`text-[15px]` is exactly the silent drift V2-304 exists to gate; a vibe, not a gate).
Decision: **BUILD the scoped `no-arbitrary-className` rule in the existing local plugin and add NO
dependency** (wired at `error` on `**/*.{jsx,tsx}`, RuleTester-covered, single-line-disable escape
hatch). eslint-plugin-tailwindcss was uninstalled after evaluation — a scoped in-repo rule is both
more precise (only the spacing/type axes) and lighter (zero devDependency, which knip enforces).
Informational for the ADR-032 hook (it matches `lib/`; this lives in `eslint-rules/`). See CLAUDE.md
"Local ESLint plugin" (now thirteen rules); `eslint-rules/rules/no-arbitrary-className.mjs`.

Scope: eslint-rules/rules/no-literal-jsx-text.mjs
Considered: **eslint-plugin-i18next** (its `no-literal-string` rule is the mature off-the-shelf
option for "flag untranslated JSX literals" — configurable `ignore`/`ignoreAttribute`/
markup-only modes; evaluated as the buy), **eslint-plugin-formatjs** (react-intl-oriented,
assumes the FormatJS `<FormattedMessage>` runtime rather than next-intl's `t()`; wrong runtime),
**build a scoped local rule** (chosen — `no-literal-jsx-text`, sibling of the design-token rules:
flags JSXText with a translatable word + a curated 3-attribute user-facing set placeholder/title/
alt, exempts `aria-*`/`data-*`/code/pre and — at the config layer — dev pages, the context-free root
boundaries, and tests). Decision: **BUILD the local rule, add NO dependency.** Rationale mirrors
V2-304: (1) the repo already owns a 12-rule local ESLint plugin — a 13th rule is the idiomatic home
and stays in-repo for forks; (2) no-literal-string's default surface is broad and its allowlist is
inverted (opt-out attributes) where the house style wants opt-IN (only placeholder/title/alt ever
flagged), so a scoped rule is more precise and lower-false-positive on this exact codebase (which is
already fully next-intl'd — the rule lands at zero product-code violations); (3) knip enforces the
no-dead-dependency floor, so a plugin kept "for later" would fail /ship (the V2-304 lesson).
Informational for the ADR-032 hook (it matches `lib/`; this lives in `eslint-rules/`). See CLAUDE.md
"Local ESLint plugin" (now thirteen rules); `scripts/copy-check.mjs` (the copy-lint half of V2-305).

### 2026-07-17 — Rich-text editor (Tiptap) — deferred, `/adopt` demo (V2-306)

Scope: lib/editor/**
Considered: **Tiptap** (MIT, headless ProseMirror wrapper — the OSS catalog's rich-text default;
composes with the token/theme layer), **Lexical** (MIT, Meta — capable but heavier model, weaker
shadcn-style theming ecosystem), **build on ProseMirror directly** (full control, high maintenance
surface — the drift the gate exists to stop), **keep plain `<textarea>`/shadcn Input** (the current
default, fine until a fork needs formatting). Decision: **adopt Tiptap (MIT) when a fork needs a
rich-text field** — a thin `lib/editor/**` seam (schema + server-side sanitize-on-save behind a zod
allowlist; stored HTML is Restricted-adjacent) behind a `components/shared/RichText*` primitive.
Deferred (nothing installed yet); recorded now so the gate is ready — the "entry ahead of build"
pattern (cf. pg-boss). This entry is the worked demonstration of `/adopt` (V2-306): catalog lookup →
options weighed → ledger + ADR stub, no wasteful install. See ADR-060; docs/oss-catalog.md
(rich-text-editor row).

### 2026-07-17 — Copy-lint checker (scripts/copy-check.mjs) — V2-305

Scope: scripts/copy-check.mjs
Considered: **Vale** (prose linter — a separate binary + a YAML style config; heavyweight for a
source-locale JSON house-style check, and it lints Markdown/prose, not a flat message catalog),
**alex / write-good / textlint** (opinionated inclusive-language / readability linters — wrong target;
they don't express "no trailing period on a label" / "sentence case" / a per-fork terminology map),
**eslint-plugin-i18next** (lints code for untranslated strings — that's the chokepoint half
`no-literal-jsx-text`, not the messages house-style half), **build a dependency-free checker** (chosen).
Decision: **BUILD `scripts/copy-check.mjs`** — a ~150-line pure module (flatten → 3 deterministic
checks: trailing-period / sentence-case with a proper-noun allowlist / a configurable terminology map)
run as the `/ship` `copy` gate; zero dependency, unit-tested, config/waivers in `project.config.json`
`copy`. A prose linter buys less than it costs for a flat-JSON house-style check. Informational for the
ADR-032 hook (lives in `scripts/`; V2-309 brings `scripts/` under the gate). See V2-305; `docs/design-recipes.md` §1e.

### 2026-07-17 — Visual-capture harness (scripts/capture-screens.mjs) — V2-301

Scope: scripts/capture-screens.mjs
Considered: **Storybook + a story-per-state** (a whole component-explorer stack + config to maintain,
and it captures components, not real logged-in routes across the locale/theme matrix), **Chromatic /
Percy** (SaaS visual-testing — external dependency + per-snapshot cost; the capture step should be
free and local), **a raw Playwright script inline in each test** (duplicated login + matrix logic per
feature), **build a thin reusable harness on the EXISTING @playwright/test** (chosen). Decision:
**BUILD `scripts/capture-screens.mjs`** — reuses the already-adopted Playwright runner (ADR-008) to log
in once and screenshot each route across {desktop,mobile}×{light,dark}×locales into
`docs/verification/`; zero new dependency. The visual-regression DIFF tool is a separate, later call
(V2-308). Informational for the ADR-032 hook (lives in `scripts/`). See V2-301; `docs/rules/design.md`.

### 2026-07-17 — Parallel-wave enforcer (scripts/fan-out.mjs) — V2-105

Scope: scripts/fan-out.mjs
Considered: **native in-message subagent dispatch alone** (ADR-057's _recommended_ option — works, but
nothing enforces write-disjoint file-ownership or verifies post-wave scope), **a third-party task-runner
/ orchestration framework** (heavy, none model this repo's file-ownership discipline), **build a thin
enforcement layer OVER native dispatch** (chosen — the operator's ADR-057 verdict was _custom_).
Decision: **BUILD `scripts/fan-out.mjs`** — `check-overlap` (sound segment-by-segment glob-intersection
refusal) + `verify-scope` (every changed file landed in exactly one declared set) around native
dispatch; it does not replace native, it guards it. Zero runtime dependency. Informational for the
ADR-032 hook (lives in `scripts/`). See ADR-057, V2-105.

### 2026-07-17 — Visual regression (scripts/visual-regression.mjs) — V2-308

Scope: scripts/visual-regression.mjs
Considered: **Lost Pixel** (OSS runner — but it owns its OWN capture step + config surface, duplicating
the `scripts/capture-screens.mjs` matrix this repo already produces, and its richer modes lean on a CI/
SaaS platform), **Argos CE** (visual-testing — SaaS-first: uploads snapshots to argos-ci.com, needs
account + egress, wrong for a local/offline QA loop), **Playwright `toHaveScreenshot`** (zero new dep —
but it re-captures inside the test runner rather than diffing the existing capture set, and stores
baselines as opaque per-test snapshots), **build a thin differ on `pixelmatch` + `pngjs`** (chosen).
Decision: **BUILD `scripts/visual-regression.mjs`** on `pixelmatch` + `pngjs` (both small, MIT,
dependency-free pure-JS — what Lost Pixel/Playwright use internally anyway) — it diffs a committed
BASELINE dir against a fresh capture dir (the output `scripts/capture-screens.mjs` already produces),
per-image pixel-diff against a threshold, writes a `*.diff.png` on regression, exits non-zero. Reuses
the capture harness this repo owns instead of a second capture stack; local + offline; wired to `/qa`
/ `uat:full` (NOT warm `/ship`). `pixelmatch`/`pngjs` are dev-dependencies (QA tooling, no runtime
bundle cost). Informational for the ADR-032 hook (lives in `scripts/`; V2-309 gate). See V2-308, V2-301.

### 2026-07-17 — Cognitive-complexity gate (eslint-plugin-sonarjs) — V2-404

Scope: eslint.config.mjs (sonarjs/cognitive-complexity block)
Considered: **ESLint core `complexity`** (built-in, zero dep — but it measures CYCLOMATIC complexity,
a different metric; ADR-034 explicitly named the missing gap as SonarSource **cognitive** complexity,
which weights nesting/breaks the way a reader experiences code, and core ESLint does not implement it),
**a hand-built AST metric** (the `scripts/ship.mjs` ADR-034 check already ships a branch-token proxy on
NEW files — extending it to a full cognitive-complexity walk means re-deriving SonarSource's published
algorithm and maintaining it; the reviewer-caught paper-cuts on the count-in-prose checks are the
cautionary tale for hand-rolled metrics), **eslint-plugin-sonarjs** (chosen — the reference
implementation of the exact metric, MIT, dev-dependency, 9 net packages, 0 vulnerabilities).
Decision: **ADOPT `eslint-plugin-sonarjs`** and enable ONLY `sonarjs/cognitive-complexity` (not the
whole recommended set — scope stays the ADR-034 gap, no new noise) at **error**, scoped to the product
surfaces (`app/**`, `components/**`, `lib/**`, `i18n/**`, `middleware.ts` — NOT `scripts/**`/`tests/**`,
which are harness tooling with legitimately higher orchestration complexity). Threshold **25** =
current product-surface max (22, `lib/openapi/registry.ts`) + headroom; ratchet toward the sonarjs
default of 15 as the max drops via refactors (ADR-034 ratchet convention). Dev-dependency, no runtime
bundle cost. Informational for the ADR-032 hook (config edit, not a new `lib/` file). See V2-404,
ADR-034.

### 2026-07-17 — Ephemeral-DB integration harness (@testcontainers/postgresql) — V2-401

Scope: scripts/test-integration.mjs
Considered: **a hand-rolled `docker run postgres` wrapper** (build — but then this repo owns
port-wait/readiness polling, teardown-on-crash, image pinning, and pgvector provisioning: exactly the
fragile plumbing testcontainers exists to remove; the reviewer paper-cuts on hand-rolled harness code
are the warning), **docker-compose + a fixed dev DB** (`make db-up` already does this for LOCAL dev,
but a shared fixed DB is stateful across runs and not ephemeral-per-run — wrong for a hermetic
integration gate and for CI, and it can't run N isolated suites), **spin nothing / keep the native-
Postgres skip path only** (the Phase-3 workaround — works in THIS container but doesn't provision a DB
in CI, so the integration claim stays a warn), **@testcontainers/postgresql** (chosen — the standard
ephemeral-container harness; a `pgvector/pgvector:pg16` image gives the vector extension out of the
box; dev-dependency, 0 vulnerabilities).
Decision: **ADOPT `@testcontainers/postgresql`** behind `scripts/test-integration.mjs`: if a real
`DATABASE_URL` is already reachable (the native-Postgres path) run the suite against it; else if a
Docker daemon is up, start an ephemeral `pgvector/pgvector:pg16` container, `prisma migrate deploy`
into it, run `tests/integration/*.test.ts`, and tear it down; else print an HONEST skip notice (no
Docker/DB — does not silently pass) and let the DB-guarded tests self-skip. Wired: `test:integration`
→ the runner; `ship:full` (`SHIP_FULL=1`) adds it to `scripts/ship.mjs`'s FULL phase, degrade-to-WARN
when no Docker (mirrors the ADR-030 docker gate), RED when a container IS present and a test fails.
Dev-dependency, no runtime bundle. ADR-061; container-run acceptance "verified where Docker present"
(this build container has no daemon) recorded in `docs/findings-register.md`. See V2-401.

### 2026-07-17 — Mutation testing on the invariant files (@stryker-mutator/core) — V2-405

Scope: stryker.config.json
Considered: **hand-rolled mutation** (flip operators in a script, re-run tests — reinventing a mature
tool's mutator catalog, sandboxing, and reporting badly), **no mutation testing / rely on line
coverage** (coverage proves a line RAN, not that a test would FAIL if the line were wrong — exactly
the false-confidence gap on security invariants like SCRUB_FIELDS and the auth wrappers), **PIT/other
JVM tools** (wrong ecosystem), **@stryker-mutator/core** (chosen — the JS/TS-standard mutation-testing
framework, MIT, dev-dependency; the `command` runner drives this repo's `node --test` contract suite
without a bespoke runner plugin).
Decision: **ADOPT `@stryker-mutator/core`** with the built-in `command` runner pointed at the contract
suite, `mutate` scoped to the THREE security-invariant files — `lib/prisma/audit-extension.ts`
(SCRUB_FIELDS / audit completeness), `lib/api-helpers.ts` (the auth wrappers), `lib/password.ts`
(Argon2id verify + bcrypt upgrade). It answers "would a test actually FAIL if this invariant broke?"
where line coverage can't. **/qa-tier, NOT warm `/ship`** (mutation runs re-execute the suite per
mutant — minutes, not the ~60s warm loop); `npm run test:mutation`. Dev-dependency, no runtime
bundle. Informational for the ADR-032 hook (config file, not a new `lib/` file). See V2-405.

### 2026-07-17 — Local dependency+container security fallbacks (osv-scanner, trivy) — V2-407

Scope: .claude/skills/audit/SKILL.md (osv-scanner + trivy passes)
Considered: **rely on `npm audit` alone** (npm's advisory DB only, npm ecosystem only, no lockfile-
level OSV coverage — misses advisories present in the broader OSV database and can't scan non-npm
manifests a fork adds), **a paid SCA SaaS** (Snyk/Mend — account + egress + cost, wrong for a local/
offline `/audit`), **GitHub Dependabot/Advanced-Security** (dormant on the free plan — the exact gap
`/audit` exists to fill locally), **osv-scanner + trivy binaries** (chosen — Google's OSV scanner and
Aqua's trivy, both OSS Go binaries installed the SAME self-install way as gitleaks/semgrep/trufflehog,
NEVER npm dependencies; osv-scanner reads the lockfile against the OSV DB, trivy scans the image + IaC).
Decision: **ADOPT `osv-scanner` + `trivy` as OPTIONAL `/audit` passes** (trivy was already wired for
the image/config scan; V2-407 adds osv-scanner as a lockfile-vs-OSV pass and documents the Go self-
install for both). Self-install pattern (`go install` / release binary), egress-gated: **NOT RUN
(egress blocked)** or **NOT RUN (optional; install …)** rather than trusting an empty result — a
missing optional scanner never marks a target "incomplete" (only the three CORE scans do). No runtime
or dev dependency added (external binaries). Also **evaluated** `anthropics/claude-code-security-review`
for the dormant CI security slot (noted in SKILL.md — an AI-diff security reviewer, complementary to
the deterministic scanners; deferred to the CI-activation trigger, not wired now). See V2-407.

### 2026-07-17 — Dependency-update bot (Renovate hosted app) — V2-502

Scope: renovate.json5
Considered: **Dependabot** (already configured in `.github/dependabot.yml` — GitHub-native, but its
grouping is coarser, it has no lockfile-maintenance job, and its value is realized once CI gates its
PRs; the repo's CI is dormant on the free plan), **a hand-rolled `npm outdated` cron / script** (re-
implements PR creation, grouping, and scheduling that a mature bot already does), **Renovate hosted
GitHub App** (chosen — config-only, NO npm/runtime dependency; richer `packageRules` grouping +
`lockFileMaintenance`; runs on its own schedule via the hosted app independent of GitHub Actions, so
it works NOW while Actions are dormant, ADR-017's exact intent).
Decision: **ADOPT the Renovate hosted app** via `renovate.json5` (JSON5 so the ADR-017/ADR-056 policy
mapping lives in real comments). It mirrors and extends the Dependabot policy: minor/patch grouped +
continuous (ADR-017 track 1); majors grouped + labeled for the quarterly review, never auto (ADR-017
track 2); the ADR-001-locked majors + the exact-pinned `next` toolchain excluded; and **`next-auth`
pinned OFF entirely** (ADR-056 froze it at `5.0.0-beta.31` — Renovate must not even propose an
in-range bump). Renovate and Dependabot are mutually exclusive (both would open duplicate PRs) — when
the Renovate app is installed it is the active bot; `.github/dependabot.yml` carries a note pointing
here and reactivates only if Renovate is removed. No runtime/dev dependency (hosted app + config).
Informational for the ADR-032 hook (root config, not a new `lib/` file). See V2-502, ADR-017, ADR-056.

### 2026-07-17 — Skill-standard conformance checker (scripts/skill-standard-check.mjs) — V2-503

Scope: scripts/skill-standard-check.mjs
Considered: **the official `skills-ref validate` CLI** (from agentskills/agentskills — authoritative,
but an external binary to install + keep current, and it can't be wired dependency-free into `/ship`
the way this repo's other gates are; it's a Go/Rust tool, not a node module), **`npm run lint` /
existing gates** (none parse SKILL.md frontmatter against the agentskills.io schema), **a small
dependency-free node validator** (chosen — mirrors the repo's `copy-check`/`bdd-coverage`/`fan-out`
harness scripts: zero deps, node:test-adjacent, runs anywhere, easy to wire into a gate).
Decision: **BUILD `scripts/skill-standard-check.mjs`** — validates every `.claude/skills/*/SKILL.md`
frontmatter against the agentskills.io open standard (required `name` ≤64 lowercase-alphanumeric-
hyphen, no leading/trailing/consecutive hyphens, MUST match the parent dir; required `description`
1–1024 chars; only the spec's known optional fields `license`/`compatibility`/`metadata`/
`allowed-tools` allowed), exits non-zero on drift naming the file+field. `npm run skill-check`.
The official `skills-ref` stays the reference for the SPEC (cited in the script header) — we track
its rules, not its binary. Zero runtime/dev dependency. Informational for the ADR-032 hook (lives in
`scripts/`). See V2-503, ADR-054.

### 2026-07-17 — Docs-currency lookup (context7 MCP) — V2-504

Scope: .claude/skills/docs-current/**
Considered: **build a fetch-and-cache skill** (a skill that fetches + caches official docs itself —
reinvents crawling, versioning, and snippet extraction that a purpose-built service already does, and
owns the staleness problem), **WebSearch-only** (works offline-ish but noisy + less authoritative than
a docs-indexed source, and no version pinning), **the already-connected context7 MCP** (chosen —
purpose-built live library-doc lookup with version-pinned IDs, `/org/project/version`; no new npm/
runtime dependency; already in the session's MCP set).
Decision: **ADOPT the context7 MCP** behind a thin `docs-current` skill: it routes version-sensitive
questions about the locked stack (Next 16 / Prisma 7 / Tailwind 4 / Auth.js / Playwright) through
`resolve-library-id` → `query-docs` (pinning the stack version, e.g. `/prisma/prisma/7.6.0`), with a
graceful **WebSearch / `docs/recipes.md` fallback** when context7 is unreachable — never a stale
confident answer. Verified live: a Prisma 7.6.0 `$extends` client-extension lookup returned current
`result`/`model`/`query` extension docs + the `Prisma.defineExtension` typing pattern. No dependency
added (MCP server already connected). See V2-504.

### 2026-07-18 — SBOM-based license gate (scripts/sbom-license-gate.mjs) — O5 (deferral)

Scope: scripts/sbom-license-gate.mjs
Considered: **a third-party SBOM/license scanner** (`license-checker`, `license-compliance`, FOSSA,
Snyk — each brings its own license taxonomy + allowlist format, duplicating the ADR-051 DENY set +
`scripts/license-allowlist.json` this repo already owns, and the SaaS ones need an account/egress),
**extend the existing warm lock-scan only** (`scripts/license-gate.mjs` already gates package-lock —
but that's not the STANDARD compliance artifact a `/handoff` ships, and CycloneDX resolves licenses
from more sources than the lockfile's `license` field, so the SBOM can surface a license the lock
scan missed), **build a thin evaluator over the SBOM we already generate** (chosen — `npm run sbom`
= `cyclonedx-npm` already produces `sbom.json`; reuse `license-gate.mjs`'s exported `DENY` +
`evaluateLicenses` + `loadAllowlist` verbatim so there is NO second license taxonomy to drift).
Decision: **BUILD `scripts/sbom-license-gate.mjs`** — generate/read the CycloneDX SBOM, map each
`components[].licenses` entry (`license.id` / `license.name` / `expression`, name from the `purl`) to
a license string, feed a synthetic `{name:{license}}` map to the EXISTING `evaluateLicenses` so the
ADR-051 deny set + the committed `license-allowlist.json` elections apply unchanged, and RED on a
denied non-elected license in the shippable SBOM. `npm run license:sbom`; wired into `ship:full`
(SBOM generation is ~seconds, too slow for the warm loop — the fast lock-scan stays warm). Zero new
dependency (cyclonedx-npm already present). Informational for the ADR-032 hook (lives in `scripts/`).
See O5, ADR-051.

## 2026-07-18 — Shared row-actions cell (`components/shared/RowActions`)

Scope: components/shared/RowActions.tsx
Considered: **a table/data-grid library's built-in action column** (TanStack Table row actions,
AntD/MUI action cells — all rejected: this repo's `DataTable` already owns the table runtime and
consumes plain column descriptors; pulling an action-cell abstraction from a grid lib would fight
that seam and add surface), **a headless menu lib** (`@radix-ui/react-dropdown-menu` for a
kebab menu — overkill for a fixed 2-button edit/delete cell, and the row already shows both inline),
**leave the per-entity duplication** (rejected — every scaffolded entity's Columns file re-declares
the same `EditIcon`/`DeleteIcon` SVGs + the identical ghost-edit + `ConfirmAction`-delete cell,
which the jscpd Maintainable gate correctly flags once ≥3 entities exist). Decision: **BUILD a thin
`components/shared/RowActions.tsx`** — an internal composition of the SHIPPED primitives (`Button` +
`ConfirmAction`) exporting `EditIcon`, `DeleteIcon`, and `getRowActionsColumn({onEdit,onDelete,t})`
returning the DataTable-shaped actions column. Zero new dependency; collapses the repeated cell +
icons across every entity's Columns into one primitive (the layout sibling of the shared
`EmptyState`/`ConfirmAction`). Informational for the ADR-032 hook.

## 2026-07-18 — Shared relation-picker combobox (`components/shared/RelationSelect`)

Scope: components/shared/RelationSelect.tsx
Considered: **a combobox/command library** (`cmdk`, `downshift`, Radix `Combobox`, react-select —
rejected: this repo already ships Radix `Popover` + `Button` + the `FormControl` seam, and a
debounced server-search-over-`/api/<entity>` picker is ~110 lines on those primitives; adding a
combobox dep duplicates what's shipped and drags styling off-token), **leave the inline copies**
(rejected — `scaffold-entity` emits this exact debounced-fetch relation picker INLINE in every
form that has a relation field, so `AssetForm` and `AssetModelForm` carried byte-identical ~144-line
copies, which the jscpd Maintainable gate flags). Decision: **BUILD `components/shared/RelationSelect.tsx`**
— lift the shipped inline picker verbatim into one shared primitive (Popover + debounced
`fetch(path + ?search=)` reading the paginated `data.data[]` shape, `displayField`-labelled) that
every form imports. Zero new dependency; the relation-field sibling of the shared `EmptyState` /
`RowActions`. A follow-up should teach `scaffold-entity` to emit the import instead of the inline copy.

## 2026-07-18 — Shared list-query parser + entity list-page — **RETIRED 2026-07-25**

Scope: lib/list-query.ts · components/shared/EntityListPage.tsx
Considered: (original entries — `parseListQuery` vs. hand-rolled per-route parsing; `EntityListPage<T>`
vs. per-entity list pages — retained in git history at the commit that removed them.)

**Outcome: both BUILT, then DELETED unused.** Each entry closed with the same caveat — _"a follow-up
should teach `scaffold-entity` to emit the thin wrapper"_ — and that follow-up never happened:
`scripts/scaffold-entity.mjs` kept hand-rolling the identical ~90-line list page and importing
`parsePagination`/`paginatedResponse` directly, so the only consumers these primitives ever had were
the Asset-Tracker's own list pages. When that demo domain was removed (2026-07-25) both dropped to
**zero importers**. `knip` could not see it — `components/shared/**` and `lib/**` are knip _entry_
globs, so anything there is treated as a root, never as dead code.

**The reusable lesson, which is why this entry stays rather than being deleted:** a build-vs-buy
_BUILD_ decision that depends on a follow-up to wire it is not finished when the code lands. Either
wire the generator in the same change, or record the primitive as speculative. Extracting a shared
abstraction whose only caller is the code you are about to delete produces exactly this outcome.

A fork that wants either can recover it from git history; the durable fix is teaching
`scaffold-entity` to emit the pattern, not re-adding an unused module.

## 2026-07-25 — Per-account brute-force lockout (`lib/account-lockout.ts`)

Scope: lib/account-lockout.ts
Considered: **`@upstash/ratelimit` + `@upstash/redis`** — the pairing the shipped recipe
`docs/recipes/shared-security/1-account-lockout.md` names (rejected as the default path: the recipe
predates ADR-035's Valkey adoption, so adopting it now would mean a **second** Redis vendor, a
second set of credentials an operator must create an account for, and a duplicate degrade path
alongside `lib/rate-limit.ts` — a fork already running Valkey would be paying for two shared-state
stores to throttle two things); **reuse `lib/rate-limit.ts` as-is** (rejected — it is an IP-bucket:
it structurally cannot express "N bad passwords for THIS account", which is the whole A07 gap, since
an attacker rotating IPs stays under every bucket); **a DB column** (`failedAttempts`/`lockedUntil`
on `users`) (rejected — a schema migration plus a write on every failed login, i.e. an
unauthenticated write amplification primitive, to store state that is inherently ephemeral);
**`rate-limiter-flexible`'s own block/consume semantics on the EXISTING Valkey client** (chosen).
Decision: **BUILD a ~90-line `lib/account-lockout.ts`** on primitives already in `package.json` —
`rate-limiter-flexible` (`RateLimiterRedis`/`RateLimiterMemory`, whose `points` + `blockDuration`
express lockout directly) over `lib/valkey.ts`'s existing client. **Zero new dependency, zero new
SaaS account**, and it inherits `lib/rate-limit.ts`'s exact posture: shared across replicas when
`VALKEY_URL` is set, in-memory otherwise, `insuranceLimiter` degrading to memory rather than failing
open. A fork that prefers Upstash can still follow the recipe; this makes the default path work with
what the template already ships.

## 2026-08-08 — Shared auth-card wrapper (`components/shared/AuthCard`)

Scope: components/shared/AuthCard.tsx
Considered: **a prebuilt auth-UI kit** (shadcn login-blocks, Clerk/Auth0 hosted UI, NextAuth's
default sign-in pages — rejected: each brings its own styling/routing/dep tree and would fight the
shipped split-screen `(auth)/layout.tsx` + the `Card`/`CardContent` + `FormField` primitives the
three auth pages already compose; the sign-in logic itself stays on Auth.js), **a headless card/form
lib** (rejected — the shadcn `Card` primitive is already shipped; a card wrapper needs no new
dependency), **leave the wrapper inline** (rejected — the identical
`<Card className="w-full max-w-[400px]"><CardContent className="p-6"><h1 …>` header is repeated 4×
across login / forgot-password / reset-password [+ its no-token state], the per-page drift the jscpd
duplication gate + the Maintainable pillar exist to stop), **BUILD a thin `AuthCard` on the shipped
`Card`/`CardContent`** (chosen).
Decision: **BUILD `components/shared/AuthCard.tsx`** — a ~15-line presentational wrapper
(`{ title, children }`) that owns the auth card's fixed width, padding, and centered `<h1>` on the
shipped shadcn `Card`/`CardContent`. Zero new dependency; the auth-form sibling of the existing
shared `SectionCard`/`FormLayout`. Collapses the 4 duplicated card headers into one primitive so the
three auth pages (and any fork's new auth screen) stay consistent. Informational for the ADR-032 hook.

### 2026-08-22 — Nine build-loop skills + Tier-2 routing-eval design (ADR-064)

Scope: .claude/skills/{test-driven-development,debugging-and-error-recovery,incremental-implementation,review,api-and-interface-design,observability-and-instrumentation,doubt-driven-development,browser-debugging,performance-optimization}/**, scripts/run-evals.mjs, scripts/lib/skill-*.mjs
Considered: **build each discipline thin from scratch** — rejected, ignores a vetted MIT
corpus and ADR-032's reuse-first scan for exactly the kind of generic-but-solid process
prose (TDD loop, systematic debugging, incremental slicing) that doesn't benefit from being
reinvented; **vendor `addyosmani/agent-skills` near-verbatim** (e.g. a git submodule or a
straight copy of its `SKILL.md` files) — rejected, it is stack-agnostic prose written for no
particular repo: zero enforcement (3 hooks vs. this template's 14), no reference to `npm run
ship`, the five pillars, or `docs/blueprints/*.md` `Scope:` language, so verbatim import
would read as generic advice sitting beside a harness that actually enforces things, and a
verbatim copy could quietly contradict this repo's own ESLint floor (e.g. weaker input-
validation guidance than the zod-at-the-boundary rule already requires); **reference-only,
no copies** (link to the upstream repo from `docs/recipes.md` instead of adopting) —
rejected, a link does not close the measured gap (BUILD 758 lines / VERIFY 79 / REVIEW 0
against the reference catalogue's 4,342) or give any of the nine disciplines a receipt-
emitting exit criterion, which is the actual defect (`docs/blueprints/sdlc-chain.md`
Problem & outcome); **rewrite in house style, MIT attribution retained** (chosen).
Decision: **ADOPT, rewritten** — nine skills (`test-driven-development`,
`debugging-and-error-recovery`, `incremental-implementation`, `review`,
`api-and-interface-design`, `observability-and-instrumentation`, `doubt-driven-development`,
`browser-debugging`, `performance-optimization`) from `addyosmani/agent-skills` (MIT,
v0.6.7), each REWRITTEN against this repo's primitives per ADR-022's built-not-imported
convention — citing `npm run ship`, the `harness.md` known-traps, the five pillars, and
`docs/blueprints/*.md` `Scope:` language in place of the upstream's generic equivalents —
with MIT attribution retained in each file. `review` additionally emits the
`Reviewed: <scope> <tree-sha>` receipt `.claude/hooks/review-gate.mjs` requires (ADR-064),
which has no upstream equivalent since the source repo has no enforcement layer to feed.
Also adopted: the **Tier-2 routing-eval design** (`evals/cases/*.json` positive/negative
prompts, rank-1 + near-duplicate-description checks) — sourced from the shape of Anthropic
skill-creator's `evals.json`, not from `addyosmani/agent-skills`, and ported into
`scripts/run-evals.mjs` / `scripts/lib/skill-*.mjs` on this repo's own skill catalogue; it
now gates the warm `/ship` loop (`--min-rank1 80`) rather than `ship:full`, so a routing
regression from adding nine skills' worth of description surface cannot land silently. See
`docs/blueprints/sdlc-chain.md` (Market scan, Work DAG task 1/2) and ADR-064.

### 2026-08-24 — PMS org/employee domain layer

Scope: lib/pms/**
Considered: extending lib/api-helpers.ts + the existing User model (rejected — the employee population is not the login population, §4.1); a generic RBAC library like CASL/accesscontrol (rejected — the spec's authority model is derived from org edges, not a policy DSL, and a library would obscure the "one owner per assessment" invariant); hand-built thin domain layer over the existing Prisma/auth/audit primitives (chosen).
Decision: build-thin-layer over existing primitives — permissions/actor/org-tree/employee-select reuse lib/api-helpers.ts, lib/pagination.ts, and the audit + soft-delete extensions unchanged; no new runtime dep. See ADR-065 + docs/blueprints/performance-management-system.md.

### 2026-08-24 — PMS Excel import/export engine

Scope: lib/pms/import/**, lib/pms/export/**
Considered: exceljs (rejected — frozen by ADR-051, no publish since 2024-12); SheetJS/xlsx via vendor CDN (rejected — resolves outside the npm registry so Renovate/npm audit/license gate cannot see it, and makes cdn.sheetjs.com a build-time dependency of every deploy); hand-written xlsx parser (rejected — owning a parser for untrusted uploads); read-excel-file + write-excel-file (chosen — MIT, registry-resolved, actively maintained, per-row schema errors matching spec §3.4).
Decision: adopt read-excel-file + write-excel-file behind a two-file seam (loaders/xlsx.ts, export/xlsx.ts). Supersedes ADR-051 item 4's SheetJS track for this use; ADR-051's exceljs freeze is upheld. See ADR-066.

### 2026-08-26 — Date-input ⇄ ISO-instant conversion

Scope: lib/date-input.ts
Considered: `date-fns` (rejected — ~20 KB for three lines of `Date` arithmetic already present in the repo, and ADR-001 locks the stack; a runtime dep >50 KB would need an ADR anyway); `Intl.DateTimeFormat` round-tripping (rejected — formats for display, does not give the ISO instant the API wants, and reintroduces the parsing step); leaving `CycleForm`'s private helpers in place and copying them (rejected — that copy is precisely how the 360 window ended up saving a deadline at midnight UTC while §5 stages saved end-of-day, deleting a day of every 360 window); extract the existing helpers to a shared leaf module (chosen).
Decision: extract, don't add. `startOfDay`/`endOfDay`/`toDateInput` move out of `components/pms/CycleForm.tsx` unchanged and are now imported by `CycleForm`, `ThreeSixtySetup` and `ThreeSixtyWindow`. No new runtime dep; contract-tested in `tests/contracts/pms-three-sixty.test.ts` ("§5.4 a deadline chosen on a form covers the whole of that day").

### 2026-08-26 — Write-endpoint reachability check

Scope: scripts/**
Considered: `knip`, already adopted and already in the `/ship` chain (rejected for THIS question — knip
answers "is this export imported", and a Next.js route's `export const POST` is consumed by the
framework's file-system router, so every unreachable endpoint F1–F6 and F11–F13 named was, to knip, a
perfectly-used export; it cannot see that no _client_ calls the path); OpenAPI-driven coverage tooling
such as `oasdiff` or a Schemathesis run against `app/api/openapi/route.ts` (rejected — those compare a
spec to a server, which tells you the endpoint EXISTS and answers, the exact claim that was already
true of all eleven unreachable routes, and it needs a live server plus credentials so it cannot gate a
push); `ts-prune` / `depcheck` (rejected — same dead-export model as knip, one axis narrower);
Playwright coverage over `/uat` (rejected as the primary check — it measures what the suite happens to
click, so it grades the test suite rather than the product, and a route nobody wrote a test for reads
identical to a route nobody can reach); hand-built path↔verb cross-reference (chosen).

Decision: build — ~90 lines, no runtime dep, and the question is genuinely specific to this codebase's
shape (Next file-system routes on one side, `apiClient.*` / `useEntityMutations` call sites on the
other). The generic tools all answer "does the code use this symbol"; the defect class here is "can a
PERSON reach this write", which is a different question and the one the 2026-08-25 red team showed
nothing in the stack was asking. It is verb-aware on purpose — a GET caller must not make a POST look
reachable, which is exactly how F11 hid. Its limits are written at the top of the file rather than
implied: it matches paths, not behaviour, so it is a floor and never a substitute for driving the
screen. Cron-only routes are allowlisted with the name of their non-UI caller, so "nothing calls it"
can never be the silent answer.

### 2026-10-20 — Private object storage for §7.1 evidence files

Scope: lib/storage.ts
Considered: **`@vercel/blob` (ADOPTED)** — it is the `/scale-up` recipe's own package for this
capability and the deployment rail is already Vercel, so storage lives where the app does and
`BLOB_READ_WRITE_TOKEN` is injected rather than being another secret to hand over at `/handoff`;
critically it now supports `access: "private"` plus `issueSignedToken`/`presignUrl` (both verified
present in 2.8.2 before adopting, not assumed from the docs), which is what makes it usable for a
Confidential record at all. **Postgres `bytea`** (rejected — keeps one backup and one access path,
which is genuinely attractive for performance records, but it pushes file bytes through Neon's
connection pool, bloats every dump, and the 10 MB × 10-per-KPI ceiling across a whole org is the
kind of growth a row store absorbs badly; revisit only if the operator would rather not add a
storage vendor). **S3 / R2 via `@aws-sdk/client-s3`** (rejected — a far larger dependency, plus
credentials, a bucket policy and a CORS config to get wrong, to buy portability nobody has asked
for; the presigned-GET model is the same one adopted here). **MinIO self-hosted** (rejected — this
fork has no container rail in production, and SECURITY.md T-09 records the last attempt's
root-credential problem). **UploadThing / Uploadcare** (rejected — a third-party processor holding
employee performance records is a data-protection question the operator has not been asked, and
`/handoff` would inherit it).

**What is hand-built and why:** only the ~70 lines in `lib/storage.ts`, which exist to write
`access: "private"` exactly once, to turn a missing token into a sentence a human can act on rather
than a stack trace, and to keep pathname construction in one place so a crafted filename cannot
traverse. Everything underneath — upload, signing, deletion — is the library's.

### 2026-10-26 — HR Centre foundation: org units, people writer, RBAC, logins

Scope: lib/org/**, lib/people/**, lib/rbac/**, lib/crypto/**, lib/validations/org.ts, lib/validations/people.ts, lib/validations/rbac.ts, lib/validations/login.ts
Considered: **Odoo HR as the system of record** (rejected for this step — the operator chose Excel
first with an Odoo API sync later; the foundation keeps `odooId` as the key and routes every write
through one writer so the sync becomes a third caller, not a third implementation). **CASL /
`@casl/ability`** for the role builder (rejected — its strength is attribute-based rules evaluated
client-side; our scopes are org-tree subsets resolved by one SQL query per request, and the 15
Performance helpers already define the call sites, so CASL would be a second vocabulary over the
same checks). **Oso / Permit.io / Cerbos** (rejected — an external policy service or a policy
language is a platform for a prototype rail, and a hosted PDP would hold the org chart). **Auth.js
role claims in the JWT** (rejected — a cached claim survives a role edit until the token expires,
which the blueprint's "no cached permission survives the request" worst path forbids). **A second
field-encryption library (e.g. `@47ng/cloak`)** for ID numbers (rejected — ADR-067's AES-GCM module
is already audited here; ID documents reuse it with a separate key so the two can rotate apart).

Decision: build — a permission catalogue in code, two tables (role, assignment) and a resolver of
~150 lines; an org-unit service of guarded CRUD over Prisma; one employee writer. No runtime
dependency is added.

### 2026-10-27 — JML S1: working calendar, statutory parameters, EMP codes, provisional ids

Scope: lib/working-time/**, lib/statutory/**, lib/people/employee-code.ts, lib/people/provisional-id.ts, lib/people/odoo-id.ts
Considered: **date-fns + date-fns-tz / Luxon** for working days and zone conversion (rejected —
`Intl.DateTimeFormat` already converts zones correctly, the two source apps both hand-rolled
the arithmetic for good reason (Fri/Sat weekend, snap-forward, holidays), and a library would
add a dependency to wrap ~40 lines of loop). **`date-holidays` (npm)** for Oman's public holidays
(rejected — Oman's Islamic holidays are announced by moon-sighting each year, so a computed list
is wrong by a day often enough to move statutory deadlines; HR enters them). **Postgres
sequences** for EMP codes (rejected — the code needs a configurable cutover, an audit record of
who approved it and a "never backwards" rule; a row-locked singleton ported from HR Onboarding
does all three). **Keep each source module's own copy** (rejected — the operator asked for one
calendar; the copies disagreed).

Decision: build — ported from HR Onboarding/Offboarding with holidays added; no dependency.

### 2026-10-27 — HR tickets: the HIVE port

Scope: lib/hive/**, lib/validations/hive/**
Considered: **Keep HIVE as a separate app** (rejected by the operator — HR Centre is Rihal's single
HR system; HIVE's own users, org tables and permission grid would be a second identity and access
system). **ServiceNow HRSD / Freshservice / Zendesk** (rejected — the ticket intake is Siraaj over
MCP with tool schemas Siraaj already depends on, the approval-for-every-answer rule and the
cross-company HR Tag pairs are bespoke, and a hosted service desk would hold employees' HR
questions outside the group). **`@modelcontextprotocol/sdk` for the MCP endpoint** (rejected, as in
HIVE ADR-074 — the server is stateless JSON-RPC over one POST with six tools; the SDK's transport
and session machinery is surface Siraaj does not use). **CASL / a second grant table** for ticket
permissions (rejected — HR Centre's role builder already has scopes, time-boxed assignments and an
extensible scope registry; HIVE's grant rows become assignments).

Decision: build (port) — HIVE's own code, carried over nearly verbatim (pure routing, rotation,
reply-token, tool and protocol modules) and re-wired onto HR Centre's Prisma, org and RBAC. No new
runtime dependency (`read-excel-file` for the provider import is already a dependency).

### 2026-10-26 — Hiring module (port of Rihal Interview Hub)

Scope: lib/hiring/**, lib/validations/hiring/**
Considered: **Keep running Interview Hub as a separate app** (rejected by the operator — HR Centre
is to be Rihal's single HR system, and two identity/role systems for one HR team is the problem
being solved). **An ATS SaaS (Greenhouse, Lever, Workable, Zoho Recruit, BambooHR ATS)** (rejected
— the process is Rihal's documented 15 steps with Oman-specific rules: Tawteen postings, two-step
requisition and offer chains with a COO threshold, payslip package evidence, 5-working-day
Sun–Thu rejection holds; an off-the-shelf ATS would hold candidate PII with a third party and still
need the hand-off into HR Centre's joiner flow). **Port Interview Hub's `lib/**` wholesale with its
Prisma extensions** (rejected for the crypto and identity seams — ADR-080; the business rules ARE
ported, file by file, re-wired onto HR Centre's RBAC, org and field-encryption primitives).
Decision: build — port the rules, reuse HR Centre's role builder (`lib/rbac`), field encryption
(`lib/crypto/field-encryption.ts`), private blob storage (`lib/storage.ts`), Excel engine
(`read-excel-file`/`write-excel-file`) and rate limiter. See docs/blueprints/hiring.md, ADR-080.

### 2026-10-27 — Hiring: drag-and-drop for the pipeline board (`@dnd-kit/core`)

Scope: components/hiring/pipeline/**
Considered: **native HTML5 drag and drop** (rejected — no keyboard or touch dragging, no screen-
reader announcements). **Menus only** (rejected as the only path — it drops the board interaction
the port keeps; kept as the accessible second path on every card). **`@dnd-kit/core`** (adopted —
the library Interview Hub used; keyboard sensor + announcements; MIT).
Decision: buy — `@dnd-kit/core` ^6.3.1, loaded lazily on the board pages only. ADR-081.

### 2026-10-27 — Hiring: offer letter PDF (`@react-pdf/renderer`)

Scope: lib/hiring/offer-letter.tsx
Considered: **`pdf-lib`** (rejected — hand-laid-out text and page breaks for a letter). **A Word
template via docxtemplater** (rejected — HR and the candidate get a .docx instead of the PDF
Interview Hub produced). **Headless Chrome** (rejected — no Chromium on Vercel functions).
**`@react-pdf/renderer`** (adopted — the library Interview Hub used; built-in fonts; server-only).
Decision: buy — `@react-pdf/renderer` ^4.9.0, imported only by the offer-letter route. ADR-084.

### 2026-10-27 — JML: joiners, movers & leavers module (case engine and all slices)

Scope: lib/jml/**, lib/validations/jml/**
Considered: **Odoo HR's onboarding/offboarding plans** (rejected — Odoo plans are flat activity
lists with no stages, compliance gates, settlement, approvals or due-date bases; the two HR apps
being ported exist because Odoo did not cover the process, and the operator's brief is a port
"to the smallest detail"). **A workflow/BPMN engine (Camunda, Temporal, n8n)** (rejected — the
two source artifacts define fixed stages and checklists, not configurable process graphs; an
engine would be a platform for a prototype rail and would hold HR data outside the database the
audit log covers). **Keeping HR Onboarding and HR Offboarding as separate apps linked by API**
(rejected by the operator: HR Centre is the single HR system). **BambooHR / HiBob onboarding**
(rejected — SaaS processors for Restricted settlement and ID data are a data-protection question
the operator has not asked, and neither models Oman gratuity or the C1–C11 gates).

Decision: build — port the two apps' services into one engine over the HR Centre core
(employee record, org, RBAC, departure flow). Dependencies are recorded with their own ADRs
(document generation: docxtemplater + pizzip, slice S6).

### 2026-10-27 — JML: Word document generation for leavers (`docxtemplater` + `pizzip`)

Scope: lib/jml/docs/**
Considered: **hand-writing OOXML** (rejected — HR authors the letters in Word; a hand-rolled
merge breaks on Word's split runs and is a parser we would own). **easy-template-x** (rejected as
first choice — smaller community, bundles jszip, same election needed; kept as the fallback).
**A PDF/document SaaS** (rejected — settlement and termination data would leave the database the
audit log covers, a cross-border question the operator has not asked). **`docxtemplater` core +
`pizzip`** (adopted — what HR Offboarding shipped; default parser only, nothing evaluates; MIT, with
the MIT branch of pizzip's dual licence elected).
Decision: buy — `docxtemplater` 3.71.1 + `pizzip` 3.3.0, server-only, no file retained. ADR-083.

### 2026-10-27 — Hiring: AI assists and document text (`unpdf`, `mammoth`)

Scope: lib/hiring/ai/**, lib/validations/hiring/ai.ts, lib/validations/hiring/ai-egress.ts
Considered: **The Anthropic / OpenAI SDKs** (rejected — `no-direct-anthropic-sdk`, and two vendor
SDKs for two HTTP calls). **LangChain / Vercel AI SDK** (rejected — a framework for three prompt
kinds and two extractors; the egress, budget and redaction controls must sit in our chokepoint
anyway). **`pdf-parse`** (rejected — unmaintained, reads a fixture at import time). **`unpdf` +
`mammoth`** (adopted — what Interview Hub used; pure JS, server-only).
Decision: build the engine (fetch, ~150 lines), buy text extraction — `unpdf` ^1.9.1, `mammoth`
^1.12.3. ADR-085.

### 2026-10-27 — UX review P0: user-addressed notifications and the "My work" list

Scope: lib/notifications/**, lib/hiring/notify.ts, lib/core/**, lib/jml/work-items.ts, lib/hiring/work-items.ts, lib/hive/services/work-items.ts
Considered: **A notification SaaS (Knock, Novu, Courier)** (rejected — another processor for
names and ticket previews, and the bell already reads one Postgres table with dedupe and audit).
**A task/inbox product or workflow engine (Camunda, Temporal)** (rejected — the work already lives
in each module's own tables; the inbox is a bounded read over them, not a new system of record).
**A new `WorkItem` table fed by every module** (rejected for now — a second copy of each module's
state that can drift; a fan-in read needs no sync). Decision: build — a provider registry that
reads each module's tables (≤ 20 rows per provider), and a User recipient on the existing
`Notification` table written through the existing `persistNotifications`.

### 2026-10-27 — UX review P1: one navigation config

Scope: lib/nav/**
Considered: **A menu/navigation library (react-pro-sidebar, Refine's resource menu)** (rejected —
the hard part is the gates, which read our own access hooks; a library would still need the same
typed config and adds a second styling system). **Next.js file-system metadata (a `nav` export per
page)** (rejected — gates and tabs span modules and the sidebar needs the full list without loading
every page). **Keep three hand-written lists (sidebar, palette, breadcrumbs)** (rejected — they
already disagree). Decision: build — one typed array plus pure resolvers, unit-tested.

### 2026-10-27 — UX review P1: employee history and pending-ID display

Scope: lib/people/history.ts, lib/people/pending-id.ts
Considered: **A field-history product / event store (HiBob-style history tables, Temporal)**
(rejected — the audit log already records every Employee write with the changed field names;
a second history store would drift). **Rendering `audit_logs` values** (rejected — values include
Restricted fields; names-only history needs no extra permission model). Decision: build — a
bounded names-only read over `audit_logs`, and a pure placeholder-ID predicate.

### 2026-10-27 — UX review P1: role change preview

Scope: lib/rbac/diff.ts
Considered: **An authorization service with policy simulation (Oso, Permit.io, OpenFGA)**
(rejected — our roles are flat permission lists with a scope; a simulator for a set difference is
a new processor and a second source of truth). Decision: build — two pure set functions.

### 2026-10-27 — UX review P1: manager hub and hiring-manager view

Scope: lib/people/team-overview.ts, lib/hiring/my-hiring.ts
Considered: **A manager-portal product (Workday My Team, Lattice manager dashboards)** (rejected —
the data lives in our own module tables; a portal would need all of it synced out). **Reusing
the Home "My work" providers** (partly — Home stays the task list; this is the team's state, not
tasks). Decision: build — two bounded read services over existing tables.

### 2026-10-27 — UX review P1: performance cycle console

Scope: lib/pms/cycle-overview.ts
Considered: **A review-cycle product (Lattice, Culture Amp)** (rejected — the cycle engine,
statutory stage locks and calibration already live here; this is a read over them). **A BI
dashboard on the database** (rejected — the late/complete rule is the status engine's, and a
second copy in SQL would drift). Decision: build — a bounded read over the status engine plus a
reminder through the existing notification writer.

### 2026-10-27 — UX review P1: HR ticket ownership, SLA clock and saved replies

Scope: lib/hive/ticket-clock.ts, lib/hive/services/ticket-sla.ts, lib/hive/services/ticket-assign.ts, lib/hive/services/ticket-context.ts, lib/hive/services/saved-replies.ts
Considered: **A service-desk product (Zendesk, Jira Service Management, ServiceNow HRSD)**
(rejected — Siraaj is the front door and the four-eyes answer approval is ours; a desk would
duplicate the queue and move employee questions to another processor). **An SLA library
(business-hours npm packages such as `business-time`)** (rejected — the core working calendar
(ADR-077) already models the week, hours, zone and holidays; one more function over it beats a
second calendar). Decision: build.

### 2026-10-27 — UX review P1: hiring vocabulary, requisition pending step, careers role pages

Scope: lib/hiring/requisition-pending.ts, lib/hiring/careers-jd.ts
Considered:

- **A hosted job board (Greenhouse or Lever job boards).** Rejected: the ATS lives here, and a
  second board would mean syncing postings out and applications back.
- **A Markdown renderer (`react-markdown`, `marked`).** Rejected: a JD needs headings,
  paragraphs and lists only. `react-markdown` is about 40 KB, and `marked` emits HTML that would
  need sanitising. A small block parser rendered as React text nodes cannot inject markup.

Decision: build.

### 2026-10-28 — JML task routing (IT / Finance desks, line-manager tasks)

Scope: lib/jml/routing/**, lib/validations/jml/routing.ts
Considered: **Workflow / BPM engines with assignment rules (Camunda, Temporal human tasks)**
(rejected — a whole runtime to route four task roles; the JML engine already generates and owns
tasks). **ITSM hand-off (raise the IT/Finance work as tickets in an external desk such as Jira
Service Management or Freshservice)** (rejected for v1 — IT and Finance want the work in HR
Centre's "My work" next to everything else, and the IT intake integration stays gated at G6).
**A new catalogue role for desk staff** (rejected by the operator — desks are named people in a
setting; line-manager authority is derived from `Employee.managerId`, as Performance does).
Decision: build — an assignee role on template/case tasks, a desk-member table and a derived
authority check in the existing task engine.
