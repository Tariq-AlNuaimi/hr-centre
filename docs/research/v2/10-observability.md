# C10 — Observability: tracing, errors, metrics, logs

> Enterprise-benchmark v2, exhaustive 4-lens pass. Ground truth = `package.json` (Next 16.2.9 / React 19.2 / Node 22, Docker-first `output:"standalone"`, Prisma 7 + Postgres 17). Pivot honored: **enterprise-only, Docker-first, self-hostable, deploy-per-tenant** (no in-app multi-tenancy — so multi-tenant observability backends are a _nice-to-have_, not a requirement; each tenant gets its own compose stack).
>
> **Current obs surface:** `@sentry/nextjs` 10.63.0 (wired in `instrumentation.ts` / `instrumentation-client.ts` / `lib/sentry.ts`, scrubbed via shared `SCRUB_FIELDS`, ADR-002) + `@vercel/speed-insights` ^2.0.0. Everything else in this category is **NET-NEW**. The gap vs "perfect enterprise repo": no OpenTelemetry backbone, no self-hostable traces/metrics/logs backend, and two Vercel/SaaS-shaped choices (Sentry SaaS default, Speed-Insights) that don't fit Docker-first self-hosting.
>
> Lens tags: **BT** battle-tested · **HS** highest-star/popularity · **ENT** enterprise-grade (SSO/SLA/air-gap/commercial backing) · **OSS** best pure open-source (permissive, self-hostable). Stars/versions/licenses verified 2026-07-11; "~approx" = not directly fetched.

---

### `@sentry/nextjs` error tracking — KEEP vs REPLACE

**One line:** Our current, wired error-tracking SDK (`@sentry/nextjs` 10.63.0, ADR-002) reporting to Sentry SaaS by default. Question: for a Docker-first self-hosted enterprise repo, keep it (and where does it point), or replace?

| #   | Candidate                         | Lens      | Stars (2026-07-11)               | License                            | Maturity                        | Why it ranks                                                                                                                        |
| --- | --------------------------------- | --------- | -------------------------------- | ---------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Sentry (SDK `@sentry/nextjs`)** | BT·HS·ENT | ~41k `getsentry/sentry` (approx) | **FSL-1.1** (→Apache-2.0 after 2y) | 2012; SDK 10.x                  | Best-in-class grouping, source-maps, release health, session replay, profiling; the SDK is already wired + scrub-tested             |
| 2   | **GlitchTip**                     | OSS       | ~1.1k (GitLab, approx)           | **MIT**                            | 2020; v6                        | Sentry-API-compatible → **zero-code backend swap** (same SDK, point DSN at it); runs in 512MB–2GB, single-container v6 "all-in-one" |
| 3   | **Sentry self-hosted**            | BT·ENT    | (same repo)                      | FSL-1.1                            | `getsentry/self-hosted` compose | Full Sentry features on your own Docker host; heavy (~20 containers: Kafka, ClickHouse, Redis, Postgres, Relay)                     |
| 4   | **HyperDX / ClickStack**          | OSS·HS    | 9.7k                             | **MIT**                            | 2023; ClickHouse-owned          | Errors correlated with session replay + logs + traces on one ClickHouse (see all-in-one below)                                      |
| 5   | **Highlight.io**                  | OSS       | ~8k (approx)                     | Apache-2.0                         | 2022                            | Errors + session replay + logs, OTel-native, self-hostable; smaller community, funding uncertainty                                  |
| 6   | **Rollbar**                       | BT·ENT    | SaaS (closed)                    | Commercial                         | 2012                            | Mature SaaS error tracking, good grouping; no self-host, per-event pricing                                                          |
| 7   | **Bugsnag (SmartBear)**           | BT·ENT    | SaaS (closed)                    | Commercial                         | 2013                            | Enterprise stability scoring/SLA; SaaS-only, no OTel-native path, pricey                                                            |
| 8   | **SigNoz exceptions**             | OSS       | 28.8k                            | MIT (core)                         | 2021                            | Errors as a byproduct of OTel spans — weaker grouping/replay, but zero extra stack if SigNoz is already the backbone                |

**Head-to-head:** The **SDK is not the question — the backend is.** `@sentry/nextjs` is genuinely best-in-class for Next.js error UX (fingerprinting, source-mapped stack traces, release health, session replay) and it's already scrub-tested against `SCRUB_FIELDS`; ripping it out is pure loss. But Sentry SaaS is a per-project external account (ADR-002's own "negative") and full Sentry self-hosted is a ~20-container beast that dwarfs the app it monitors — a bad fit for deploy-per-tenant Docker. **GlitchTip is the key move**: it speaks the Sentry API, so the _same_ `@sentry/nextjs` SDK reports to it by changing only the DSN — a genuine drop-in, self-hostable in one small container. You trade away session replay / profiling / advanced perf for a 512MB footprint. Rollbar/Bugsnag are SaaS-only lock-in with no self-host and lose on the Docker-first axis. HyperDX/Highlight fold error tracking into a broader ClickHouse stack (see all-in-one) — attractive if you want _one_ backend for everything incl. replay.

**Recommendation:** **KEEP+HARDEN — keep the `@sentry/nextjs` SDK, make the backend tenant-choosable.** Ship a `SENTRY_DSN`-driven abstraction where the default docker-first backend is **self-hosted GlitchTip** (MIT, one container, drop-in), with **Sentry SaaS / Sentry self-hosted** as opt-in for tenants that want session replay + profiling. This preserves the wired instrumentation + scrub contract while killing the "external SaaS account required" negative for the self-host default. **Fit 5/5** (SDK unchanged). **ADR impact:** supersede ADR-002's "Sentry SaaS default" with "SDK kept, GlitchTip is the self-host default backend, Sentry optional."

---

### OpenTelemetry — NET-NEW (the backbone)

**One line:** NET-NEW — no vendor-neutral instrumentation layer today; Sentry's SDK auto-instruments but only reports to Sentry. OTel is the standard that lets one instrumentation feed _any_ backend and avoid lock-in.

| #   | Candidate                                                                    | Lens       | Stars (2026-07-11)                              | License            | Maturity                            | Why it ranks                                                                                                                                          |
| --- | ---------------------------------------------------------------------------- | ---------- | ----------------------------------------------- | ------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`@vercel/otel`**                                                           | BT·HS      | (npm; part of Vercel SDK)                       | **Apache-2.0/MIT** | GA                                  | Wraps OTel SDK w/ Node+Edge handling + fetch instrumentation; **~5-line `instrumentation.ts`**, works off-Vercel via `OTEL_EXPORTER_OTLP_*`           |
| 2   | **OpenTelemetry JS SDK** (`@opentelemetry/sdk-node` + auto-instrumentations) | BT·HS·OSS  | 2.6k `open-telemetry/opentelemetry-js` (approx) | Apache-2.0         | GA (traces/metrics GA, logs stable) | Full control; the manual path when you need custom span processors / exporters not covered by the wrapper                                             |
| 3   | **OpenTelemetry Collector**                                                  | BT·ENT·OSS | ~5k+ (core+contrib, approx)                     | Apache-2.0         | GA                                  | The vendor-neutral pipeline: receive OTLP → process (batch, redact, tail-sample) → export to any backend; **the piece that makes backends swappable** |
| 4   | **Grafana Alloy**                                                            | OSS        | ~2k (approx)                                    | **Apache-2.0**     | GA                                  | OTel-Collector distro + Prometheus pipelines; the collector if you go Grafana LGTM                                                                    |
| 5   | **Sentry OTel bridge**                                                       | BT         | (in SDK)                                        | FSL-1.1            | GA                                  | Sentry SDK 8+ is OTel-based internally; can emit OTLP spans alongside Sentry — useful bridge, not a full collector                                    |

**Head-to-head:** Next 16 auto-detects a root `instrumentation.ts` (no config), and we already ship one (currently Sentry-only). `@vercel/otel` is the pragmatic entry — despite the name it is **not** Vercel-locked; it honors standard `OTEL_EXPORTER_OTLP_ENDPOINT` and runs anywhere, handling the Node-vs-Edge `NEXT_RUNTIME` split (the same split our `instrumentation.ts` already branches on). Drop to the raw `@opentelemetry/sdk-node` only when you need custom span processors. **The load-bearing decision is the Collector**: run one OTel Collector container per tenant stack as the single OTLP sink, and every backend (SigNoz, Tempo, Loki, GlitchTip) becomes a config change, not a re-instrumentation. This is what future-proofs the whole category and is the direct answer to Sentry-SDK lock-in.

**Recommendation:** **ADOPT (net-new) — OTel is the backbone.** Add `@vercel/otel` + `@opentelemetry/sdk-logs`/`api-logs`/`instrumentation` to `instrumentation.ts` (coexists with Sentry: Sentry for errors, OTLP for traces/metrics/logs), and ship an **OpenTelemetry Collector** service in the compose stack as the single sink. Wire `OTEL_EXPORTER_OTLP_ENDPOINT` into `lib/env.ts`. **Fit 5/5** — Next-16-native, no framework fight. **ADR impact:** new ADR "OpenTelemetry backbone + Collector as the swappable-backend seam."

---

### Tracing backend — NET-NEW (Jaeger vs Grafana Tempo vs SigNoz)

**One line:** NET-NEW — nowhere to send distributed traces today. Where do OTLP spans land?

| #   | Candidate              | Lens       | Stars (2026-07-11)           | License                       | Maturity             | Why it ranks                                                                                                            |
| --- | ---------------------- | ---------- | ---------------------------- | ----------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | **SigNoz**             | OSS·HS     | 28.8k (v0.132.2, 2026-07-10) | **MIT** core / AGPL collector | 2021                 | Traces as first-class + logs+metrics in ONE UI; service maps, flame views, trace↔log correlation; polished APM          |
| 2   | **Jaeger**             | BT·ENT·OSS | 23k (v2.19.0, 2026-06)       | **Apache-2.0**                | 2016; CNCF graduated | The de-facto OSS tracer; **v2 is built ON the OTel Collector**; needs Cassandra/ES/ClickHouse backend; traces-only      |
| 3   | **Grafana Tempo**      | BT·OSS     | ~4.3k (v3.x, approx)         | **AGPL-3.0**                  | 2020                 | Cheapest at scale — trace storage on S3/GCS object store, no index DB; minimal (trace-by-ID lookup), pairs with Grafana |
| 4   | **Uptrace**            | OSS        | ~3.8k (approx)               | AGPL-3.0                      | 2021                 | Lightweight OTel-native traces+metrics+logs on ClickHouse; simplest OTel-beginner backend                               |
| 5   | **HyperDX/ClickStack** | OSS        | 9.7k                         | MIT                           | 2023                 | Traces + replay + logs on ClickHouse (all-in-one section)                                                               |

**Head-to-head:** **Jaeger** is the battle-tested/CNCF pick and v2's rebuild on the OTel Collector makes it a first-class OTLP citizen — but it is **traces-only** and needs a separate storage DB (Cassandra/Elasticsearch/ClickHouse), so you still need separate tools for logs+metrics. **Tempo** is the cost champion (spans straight to S3, no index) but is deliberately minimal — great as a cheap trace _store_ keyed by trace-ID from a log line, poor as a standalone exploration UI, and it's **AGPL-3.0**. **SigNoz** treats traces as first-class _and_ unifies logs+metrics+APM in one ClickHouse-backed UI, which for a deploy-per-tenant single-stack is the decisive advantage — one backend instead of Jaeger+Loki+Prometheus+Grafana. For a repo whose whole ethos is "one compose file per tenant, no SRE," the consolidation wins over Jaeger's tracing purity.

**Recommendation:** **ADOPT (net-new) → SigNoz as the trace backend** (folded into the all-in-one decision below). If a tenant already runs Grafana, **Tempo** is the ADD-AS-OPTION (AGPL-noted). Jaeger only if traces-only + CNCF governance is a hard requirement. **Fit 5/5** (OTLP via the Collector). **ADR impact:** covered by the all-in-one ADR.

---

### Metrics — NET-NEW (Prometheus+Grafana vs VictoriaMetrics vs Mimir)

**One line:** NET-NEW — no metrics/TSDB today (Speed-Insights is web-vitals only, not app/infra metrics).

| #   | Candidate           | Lens          | Stars (2026-07-11)           | License        | Maturity             | Why it ranks                                                                                                                |
| --- | ------------------- | ------------- | ---------------------------- | -------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Prometheus**      | BT·HS·ENT·OSS | ~57k (approx)                | **Apache-2.0** | 2012; CNCF graduated | The industry-standard pull TSDB + PromQL; every backend speaks its format. Limits: single-node, ~15d default retention      |
| 2   | **VictoriaMetrics** | BT·OSS        | 17.3k (v1.147.0, 2026-07-06) | **Apache-2.0** | 2019                 | Prom-compatible, **single binary**, ~10x compression (a year on one 100GB SSD), lower RAM; the best drop-in long-term store |
| 3   | **Grafana Mimir**   | ENT·OSS       | ~4.6k (approx)               | **AGPL-3.0**   | 2022                 | Horizontally scalable multi-tenant Prom on S3; memory-heavy; overkill unless 500+ devs / MaaS                               |
| 4   | **Grafana** (viz)   | BT·HS·ENT     | 75.5k                        | **AGPL-3.0**   | 2014                 | The dashboard layer over any of the above; near-universal                                                                   |
| 5   | **SigNoz metrics**  | OSS           | 28.8k                        | MIT            | 2021                 | OTLP metrics into the same ClickHouse UI — no separate Prom+Grafana if SigNoz is the backbone                               |

**Head-to-head:** **Prometheus** is the unavoidable standard (pull scraping + PromQL + exporters), but single-node with short retention. **VictoriaMetrics** is the pragmatic upgrade — Prometheus-compatible, one binary, dramatically better compression and RAM, low query latency from local disk — ideal for a single self-hosted box per tenant. **Mimir** solves a problem we don't have: horizontally-scalable _multi-tenant_ metrics — but the pivot is **deploy-per-tenant with no in-app multi-tenancy**, so Mimir's raison d'être (X-Scope-OrgID isolation across 500+ devs) is wasted ops burden, and it's memory-bound + AGPL. The real fork is whether metrics live in a **dedicated Prom/VM+Grafana** or get **folded into SigNoz's ClickHouse**. For minimal ops, folding wins; for teams that want PromQL + the Grafana ecosystem, VictoriaMetrics + Grafana is the answer.

**Recommendation:** **ADOPT (net-new) — default: SigNoz metrics** (OTLP, one stack). **ADD-AS-OPTION: VictoriaMetrics + Grafana** for tenants wanting PromQL/exporters. **DEFER Mimir** — multi-tenant scaling we deliberately don't need. **Fit 4/5.** **ADR impact:** covered by all-in-one ADR; note AGPL if Grafana/Mimir chosen.

---

### Logs — NET-NEW (Loki vs ELK/OpenSearch vs Vector vs OpenObserve)

**One line:** NET-NEW — logs go to container stdout today (Docker/Vercel), no aggregation/search/retention.

| #   | Candidate            | Lens       | Stars (2026-07-11)          | License           | Maturity       | Why it ranks                                                                                                                      |
| --- | -------------------- | ---------- | --------------------------- | ----------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Grafana Loki**     | BT·HS·OSS  | 28.5k (v3.7.3)              | **AGPL-3.0**      | 2018           | Indexes _labels_ not full text → cheap object-store logs; easiest to operate long-term; pairs w/ Grafana. Full-text search slower |
| 2   | **OpenObserve**      | OSS·HS     | 19.8k (v0.91.1, 2026-07-02) | **AGPL-3.0**      | 2023           | Rust single-binary, Parquet storage, claims ~140x lower storage vs ES; logs+metrics+traces+RUM in one; SQL query                  |
| 3   | **OpenSearch**       | BT·ENT·OSS | ~11k (approx)               | **Apache-2.0**    | 2021 (ES fork) | Full-text power + Dashboards; heavy (dense indexing = high storage/compute); the ELK path without Elastic's license               |
| 4   | **Vector** (Datadog) | BT·OSS     | ~19k (approx)               | **MPL-2.0**       | 2019           | Not a store — a high-perf log/metric _pipeline/router_ (collect→transform→ship). Complements Loki/OO, doesn't replace them        |
| 5   | **SigNoz logs**      | OSS        | 28.8k                       | MIT               | 2021           | OTLP logs into the same ClickHouse — trace↔log correlation for free if SigNoz is the backbone                                     |
| 6   | **Elastic ELK**      | BT·ENT     | —                           | Elastic v2 / SSPL | 2010           | The incumbent; license traps (SSPL) + heavy ops; OpenSearch is the OSS-clean substitute                                           |

**Head-to-head:** **Loki** is the low-cost, low-ops default (label-index + object storage) and integrates natively with Grafana, but its full-text search is weaker (scans chunks) and it's AGPL-3.0. **OpenSearch** gives real full-text search and is cleanly Apache-2.0, but pays for it in storage/compute — a heavier box per tenant. **OpenObserve** is the modern efficiency play (Rust, Parquet, single binary, SQL, ~140x storage claim) and also spans traces+metrics+RUM — but it's AGPL-3.0 (legal review before embedding/redistribution). **Vector** is orthogonal: a best-in-class _pipeline_ (Datadog-owned, MPL-2.0) you'd put in front of any store for redaction/routing — worth knowing but not a backend choice. As with metrics, the pivotal call is dedicated-log-store vs **fold logs into SigNoz's ClickHouse** for zero-extra-stack trace-to-log correlation.

**Recommendation:** **ADOPT (net-new) — default: SigNoz logs** (OTLP, unified). **ADD-AS-OPTION: Loki+Grafana** (cheapest dedicated, AGPL-noted) or **OpenObserve** (efficiency, AGPL-noted). Put **Vector** in front only if a tenant needs heavy redaction/routing. **DEFER OpenSearch/ELK** unless deep full-text search is a hard requirement. **Fit 4/5.** **ADR impact:** covered by all-in-one ADR.

---

### All-in-one OSS platforms — SigNoz vs HyperDX vs Highlight vs OpenObserve vs Uptrace (the pragmatic single-stack pick)

**One line:** NET-NEW — the strategic question: for deploy-per-tenant Docker-first, do we run one unified OTel-native backend instead of assembling Jaeger+Prom+Loki+Grafana?

| #   | Candidate                | Lens   | Stars (2026-07-11) | License                                            | Storage                       | Why it ranks                                                                                                          |
| --- | ------------------------ | ------ | ------------------ | -------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | **SigNoz**               | OSS·HS | 28.8k (v0.132.2)   | **MIT** core / AGPL otel-collector / ee-commercial | ClickHouse                    | Most polished OSS APM UI; traces+logs+metrics+alerts+dashboards; OTel-native; multi-container compose                 |
| 2   | **HyperDX / ClickStack** | OSS·HS | 9.7k               | **MIT**                                            | ClickHouse (ClickHouse-owned) | **Adds session replay + errors** to logs/traces/metrics — the only OSS one correlating front-end replay↔backend spans |
| 3   | **OpenObserve**          | OSS·HS | 19.8k (v0.91.1)    | **AGPL-3.0**                                       | Parquet (own engine)          | Lightest footprint (single Rust binary), lowest storage cost, RUM included; less APM depth                            |
| 4   | **Highlight.io**         | OSS    | ~8k (approx)       | Apache-2.0                                         | ClickHouse                    | Errors + session replay + logs, OTel-native; **cleanest license** but smallest community / funding risk               |
| 5   | **Uptrace**              | OSS    | ~3.8k (approx)     | AGPL-3.0                                           | ClickHouse                    | Simplest OTel backend, low overhead; thinnest log analysis — good starter, weak as sole platform                      |

**Head-to-head:** All five are OTel-native and self-host via Docker — the difference is UX depth, footprint, and license. **SigNoz** wins on APM polish and community (28.8k, MIT core) and is the safest "one backend for traces+logs+metrics" — its cost is a multi-container ClickHouse compose stack (heavier per tenant). **HyperDX/ClickStack** is the most _complete_ single stack — it folds **error tracking + session replay** in, so it could theoretically replace _both_ Sentry and the SigNoz backbone on one ClickHouse — but it's now **ClickHouse-owned** (acquired March 2025 → "ClickStack"), so roadmap is vendor-directed and its error-grouping UX is less mature than Sentry. **OpenObserve** is the footprint champion (one Rust binary, best storage economics) — attractive for many small tenants — but AGPL and shallower APM. **Highlight** has the cleanest license (Apache-2.0) but the smallest community and funding uncertainty. **Uptrace** is a fine starter but too thin to be the sole platform.

**Recommendation:** **ADOPT (net-new) → SigNoz as the default unified backbone** (traces+metrics+logs+dashboards+alerts, OTLP-fed by the Collector, MIT core). It is the pragmatic single-stack pick that collapses four backend decisions into one. **ADD-AS-OPTION: HyperDX/ClickStack** for tenants who want to also consolidate **error tracking + session replay** onto the same ClickHouse (potentially retiring Sentry+GlitchTip for a true one-stack shop) — flag the ClickHouse-ownership governance shift. **Fit 5/5** (OTLP, Docker-compose native). **ADR impact:** new ADR "unified OTel backend: SigNoz default, HyperDX/ClickStack option."

---

### `@vercel/speed-insights` / RUM — vs Grafana Faro (and relevance once off Vercel)

**One line:** Current dep `@vercel/speed-insights` ^2.0.0 — Core-Web-Vitals RUM that **only works on Vercel** (requires Vercel Pro, data lives in Vercel's dashboard). Off the Vercel rail it is dead weight.

| #   | Candidate                                | Lens      | Stars (2026-07-11)                   | License        | Maturity | Why it ranks                                                                                                                     |
| --- | ---------------------------------------- | --------- | ------------------------------------ | -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Grafana Faro** (web SDK)               | OSS·HS    | ~900 `grafana/faro-web-sdk` (approx) | **Apache-2.0** | 2023     | RUM: web-vitals + JS errors + logs + **front-end traces that correlate to backend via OTel**; self-hostable, no per-session cost |
| 2   | **Sentry Browser SDK** (replay/perf)     | BT·HS·ENT | (in SDK)                             | FSL-1.1        | mature   | Already in our bundle via `@sentry/nextjs`; web-vitals + errors + session replay in one — RUM for free if we keep Sentry         |
| 3   | **OpenTelemetry JS (browser)**           | OSS       | (OTel-JS)                            | Apache-2.0     | stable   | Raw browser OTLP spans → any backend; more assembly, no opinionated RUM UX                                                       |
| 4   | **OpenObserve RUM / HyperDX**            | OSS       | 19.8k / 9.7k                         | AGPL / MIT     | 2023     | RUM baked into the all-in-one backend if chosen — no separate RUM tool                                                           |
| 5   | **`@vercel/speed-insights`** (incumbent) | HS        | (npm)                                | MIT            | GA       | Zero-config CWV **on Vercel only**; Vercel Pro required; not self-hostable                                                       |

**Head-to-head:** `@vercel/speed-insights` is genuinely great _on Vercel_ (zero-config CWV in the Vercel dashboard) but is fundamentally a managed-Vercel feature — the pivot is Docker-first self-hosting, so it becomes irrelevant/removable for the self-host default (keep only for tenants who _do_ deploy to Vercel). The self-hostable replacement is **Grafana Faro** (Apache-2.0, front-end telemetry that correlates to backend OTel spans, no per-session licensing) — but note it wants a Faro Collector/Grafana Alloy sink. The cheaper move: **Sentry's Browser SDK already ships in our bundle** and covers web-vitals + errors + session replay, so if Sentry/GlitchTip stays, RUM is largely already paid for. If the tenant picks HyperDX/OpenObserve as the backend, RUM is included there too.

**Recommendation:** **REPLACE → conditional.** Make `@vercel/speed-insights` **Vercel-only opt-in** (loaded only when deployed to Vercel; removed from the self-host default). For self-hosted RUM, default to **Sentry/GlitchTip browser telemetry** (already in bundle) and **ADD-AS-OPTION Grafana Faro** for tenants on a Grafana/Faro stack. **Fit 3/5** (incumbent is Vercel-coupled). **ADR impact:** note in the RUM/observability ADR — Speed-Insights is not part of the self-host baseline.

---

## Category verdict table

| Item                   | Current                  | Recommendation                                                                                               | Net-new deps to add                                                                            | ADR impact                       | Priority |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------- | -------- |
| Error tracking SDK     | `@sentry/nextjs` 10.63.0 | **KEEP+HARDEN** — SDK stays; backend becomes tenant-choosable (GlitchTip default self-host, Sentry optional) | GlitchTip (container, no npm dep)                                                              | Supersede ADR-002 "SaaS default" | **P0**   |
| OpenTelemetry backbone | none                     | **ADOPT** — `instrumentation.ts` emits OTLP; Collector as swappable seam                                     | `@vercel/otel`, `@opentelemetry/{sdk-logs,api-logs,instrumentation}`; OTel Collector container | New ADR: OTel backbone           | **P0**   |
| Tracing backend        | none                     | **ADOPT → SigNoz** (Tempo option; Jaeger if traces-only)                                                     | SigNoz compose (ClickHouse)                                                                    | Covered by unified-backend ADR   | **P1**   |
| Metrics/TSDB           | none (CWV only)          | **ADOPT → SigNoz metrics**; VictoriaMetrics+Grafana option; **DEFER Mimir**                                  | (in SigNoz) or VictoriaMetrics+Grafana                                                         | Unified-backend ADR; AGPL note   | **P1**   |
| Logs                   | stdout only              | **ADOPT → SigNoz logs**; Loki/OpenObserve option; Vector for redaction; **DEFER OpenSearch/ELK**             | (in SigNoz)                                                                                    | Unified-backend ADR; AGPL note   | **P1**   |
| All-in-one platform    | none                     | **ADOPT → SigNoz default backbone**; **HyperDX/ClickStack** option (adds errors+replay)                      | SigNoz (or HyperDX) docker-compose                                                             | New ADR: unified OTel backend    | **P0**   |
| RUM / web-vitals       | `@vercel/speed-insights` | **REPLACE → conditional** — Vercel-only opt-in; Sentry/GlitchTip browser default; Faro option                | Grafana Faro (option); drop Speed-Insights from self-host baseline                             | RUM ADR / note in obs ADR        | **P2**   |

## Recommended v1 self-hostable observability stack

**Design principle:** one OTel instrumentation → one Collector → one unified backend per tenant compose file. No SRE, no Kafka, no k8s. Error-tracking UX kept where Sentry excels; everything else consolidated.

```
Next 16 app (instrumentation.ts)
  ├─ @sentry/nextjs SDK  ──DSN──►  GlitchTip (MIT, 1 container)   ← errors, self-host default
  │                                 [or Sentry SaaS/self-host for replay+profiling]
  └─ @vercel/otel (OTLP) ──────►  OpenTelemetry Collector  ──────►  SigNoz (ClickHouse)
                                    (batch, redact, sample)          ← traces + metrics + logs + dashboards + alerts
Browser: Sentry/GlitchTip web SDK (web-vitals + errors + replay)   ← RUM, self-host default
         [@vercel/speed-insights only when deployed to Vercel]
         [Grafana Faro option for Grafana-stack tenants]
```

**Baseline containers added per tenant:** `otel-collector` + `signoz` (bundles ClickHouse) + `glitchtip` (+ its Postgres/Redis). **Consolidation option:** swap SigNoz+GlitchTip for a single **HyperDX/ClickStack** (one ClickHouse for traces+metrics+logs+errors+session replay) when a tenant wants the absolute minimum number of moving parts and can accept ClickHouse-directed governance + less-mature error grouping.

**Env wiring (into `lib/env.ts`):** `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, keep `SENTRY_DSN` (now GlitchTip-compatible), gate `@vercel/speed-insights` on a `VERCEL` flag. Reuse the existing `SCRUB_FIELDS` redaction in the Collector's processor so PII scrubbing extends from Sentry to all OTLP signals.

---

## Sources

1. Sentry self-host vs GlitchTip vs OTel-native (2026) — DanubeData: https://danubedata.ro/blog/self-host-sentry-glitchtip-error-tracking-2026
2. Sentry alternatives 2026 — SigNoz: https://signoz.io/comparisons/sentry-alternatives/
3. 10 Best Sentry Alternatives 2026 — OneUptime: https://oneuptime.com/blog/post/2026-03-12-10-best-sentry-alternatives-2026/view
4. All-in-one observability stacks tested (2026) — Tasrie IT: https://tasrieit.com/blog/all-in-one-observability-stack-cloud-native-2026
5. OpenObserve vs SigNoz (2026) — CubeAPM: https://cubeapm.com/blog/openobserve-vs-signoz/
6. Best open-source observability platforms 2026 — Parseable: https://www.parseable.com/blog/ten-best-open-source-observability-platforms-2026
7. Jaeger vs Tempo — SigNoz: https://signoz.io/blog/jaeger-vs-tempo/
8. Grafana Tempo vs Jaeger — Last9: https://last9.io/blog/grafana-tempo-vs-jaeger/
9. Best log management tools 2026 — OpenObserve: https://openobserve.ai/blog/log-management-tools/
10. Best ELK alternatives 2026 — Last9: https://last9.io/blog/top-elk-alternatives/
11. Next.js OpenTelemetry guide — Next.js docs: https://nextjs.org/docs/app/guides/open-telemetry
12. OpenTelemetry in Next.js with @vercel/otel — OneUptime: https://oneuptime.com/blog/post/2026-02-06-opentelemetry-nextjs-vercel-otel/view
13. Prometheus vs VictoriaMetrics vs Mimir 2026 — PkgPulse: https://www.pkgpulse.com/guides/prometheus-vs-victoriametrics-vs-grafana-mimir-metrics-2026
14. Scaling Prometheus 2026 (Thanos/Mimir/VM) — sanj.dev: https://sanj.dev/post/prometheus-scaling-thanos-mimir-victoriametrics/
15. Grafana Faro OSS RUM: https://grafana.com/oss/faro/
16. Grafana Faro vs Vercel Speed Insights / self-hosted RUM — OneUptime: https://oneuptime.com/blog/post/2026-02-09-grafana-faro-rum/view
17. Vercel Speed Insights docs: https://vercel.com/docs/speed-insights
18. ClickHouse acquires HyperDX (2025-03) — HyperDX blog: https://www.hyperdx.io/blog/clickhouse-acquires-hyperdx-to-accelerate-the-future-of-open-source-observability
19. What is ClickStack (2026) — Tasrie IT: https://tasrieit.com/blog/what-is-clickstack-clickhouse-observability-explained-2026
20. Grafana/Loki/Tempo relicensing to AGPLv3 — Grafana Labs: https://grafana.com/blog/grafana-loki-tempo-relicensing-to-agplv3/
21. GitHub star/version/license (fetched 2026-07-11): SigNoz https://github.com/SigNoz/signoz · OpenObserve https://github.com/openobserve/openobserve · Jaeger https://github.com/jaegertracing/jaeger · VictoriaMetrics https://github.com/VictoriaMetrics/VictoriaMetrics · HyperDX https://github.com/hyperdxio/hyperdx · Loki https://github.com/grafana/loki · Grafana https://github.com/grafana/grafana
