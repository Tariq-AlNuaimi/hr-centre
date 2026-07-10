# Observability, Supply Chain & CI/CD — Enterprise Pivot Benchmark

> **Domain research for the enterprise repositioning.** Decision-grade. Star counts and version facts verified against the live GitHub API and web sources on **2026-07-10**. Cited inline `[n]`; sources at the end.

## Summary

The template's founding premise — "free plan, CI dormant, `/ship` (an 18-gate local script) is the gate" — **inverts** under the enterprise pivot. Enterprise means **live CI/CD from day one**: the dormant GitHub Actions workflows (verify / secrets-scan / sast / codeql / uat) activate, and today's *skip-if-absent* gates (knip, jscpd, coverage, size-limit) plus the `--full`-only container scan and SBOM step become **hard CI fails**. The other structural change is the **distributed floor**: the in-memory `lib/rate-limit.ts` is correct on one container and silently wrong across many (each replica keeps its own counters, so an attacker gets `N × limit`), so a Redis-backed limiter is a v1 correctness requirement, not a `/scale-up` nicety. This document benchmarks ten capabilities across four lenses, gives per-item ADOPT/REJECT verdicts for the seed list, and sequences v1-baseline vs later.

**Map to the pivot.** Observability + supply-chain + CI/CD is the *enforcement and operations* half of "production-grade from day one" (Axis 3 of `docs/enterprise-pivot-analysis.md`). Docker-first + compose-now/k8s-ready (operator decisions 3 & 5) means every pick below must run **self-hosted in a container** as the default, with SaaS as an option — the reverse of the prototype rail's Vercel-managed defaults. Deploy-per-tenant (decision 1, ADR-011 kept) means we do **not** need multi-tenant-aware observability cardinality; one deployment = one app = one telemetry stream, which keeps the self-hosted single-node backends viable far longer.

A recurring, load-bearing lesson from 2026: the **March 2026 Trivy supply-chain compromise** [16][17] — attackers force-pushed 75 tags in `aquasecurity/trivy-action` to malicious commits and pushed poisoned Docker Hub images, turning the scanner itself into a credential stealer inside CI. The takeaway shapes several verdicts: **pin every third-party GitHub Action by commit SHA, not by tag**, and pin scanner container digests. The supply-chain tooling we adopt must itself be supply-chain-hardened.

---

## Capability benchmarks (4-lens tables)

Legend — **Fit 1-5** = fit for *our* stack (Next.js 16 · Prisma 7 · Postgres 17 · Docker-compose-now/k8s-ready · deploy-per-tenant · GitHub SCM). Stars as of **2026-07-10** via GitHub API.

### 1. Distributed tracing / APM (OpenTelemetry + a backend)

| Lens | Pick | Notes |
|---|---|---|
| Battle-tested | **Grafana Tempo** (5.4k★) behind Grafana, or **Datadog/Grafana Cloud** (SaaS) | Tempo pairs with the metrics/logs stack; SaaS if ops budget is thin |
| Highest-star / popular | **Grafana** 75.5k★ [8] (the pane of glass); **Jaeger** 23.0k★ [8] (the classic OSS trace UI) | Jaeger is the reference OTLP trace backend |
| Enterprise-grade | **Datadog APM** / **Grafana Cloud** / **Honeycomb** (SaaS) | Turnkey SLOs, retention, RBAC, on-call; cost scales with spans |
| Best pure-OSS | **SigNoz** 28.8k★ [4][8] — traces+metrics+logs in one ClickHouse-backed app | Single product replaces the LGTM stack; OTel-native |
| **Recommendation** | **OpenTelemetry SDK via `@vercel/otel` in `instrumentation.ts` → OTLP → SigNoz (self-hosted, compose) as the default backend; swap the OTLP endpoint for Grafana Cloud/Datadog when a fork wants SaaS.** | `@vercel/otel` is Next-team-maintained, works Node+Edge, needs **no `next.config` change** on Next 15/16 [1][2]. The collector→backend indirection means the backend is a config swap. |
| **Fit** | **5** | Instrumentation is stack-native; SigNoz's OTLP ingest decouples us from any single backend. |

**Why SigNoz over LGTM for us:** deploy-per-tenant keeps per-deployment telemetry volume low, so the operational overhead of running Loki+Tempo+Mimir+Grafana separately [8] isn't justified — one SigNoz container gives traces+metrics+logs on one schema, click-through correlated [4]. Keep a Prometheus+Grafana escape hatch (capability 3) for forks that already run Grafana.

### 2. Error tracking

| Lens | Pick | Notes |
|---|---|---|
| Battle-tested | **Sentry SaaS** (44.3k★ repo [5]) | Best-in-class SDK, session replay, tracing, release health |
| Highest-star / popular | **Sentry** 44.3k★ [5] | Dominant; `@sentry/nextjs` is first-class for Next 16 |
| Enterprise-grade | **Sentry Business/Enterprise SaaS** | SSO/SAML, data residency, audit — but self-host is *not recommended* by Sentry (40+ containers, 16 GB RAM floor) [6] |
| Best pure-OSS | **GlitchTip** (primarily GitLab-hosted; speaks Sentry's wire protocol) | 4 containers vs Sentry's 40+ [6]; no session replay / limited tracing |
| **Recommendation** | **Standardize on the Sentry SDK (`@sentry/nextjs`) at the code layer; point the DSN at GlitchTip (self-hosted, compose) by default, at Sentry SaaS when a fork wants replay/deep tracing.** | GlitchTip speaks the Sentry protocol, so the DSN is a swap with zero app-code change [6]. This is the same "SDK-stable, backend-swappable" pattern as tracing. |
| **Fit** | **4** | Self-hosted Sentry is too heavy for a per-deployment enterprise fork [6]; GlitchTip fits the compose footprint. Overlaps with SigNoz's error views — see sequencing. |

### 3. Metrics + dashboards

| Lens | Pick | Notes |
|---|---|---|
| Battle-tested | **Prometheus 65.1k★ + Grafana 75.5k★** [8] | The industry-standard metrics duo |
| Highest-star / popular | **Grafana** 75.5k★ [8] | The default dashboarding layer everywhere |
| Enterprise-grade | **Grafana Cloud / Datadog / Amazon Managed Prometheus** | Managed scaling, long retention, alerting |
| Best pure-OSS | **SigNoz** 28.8k★ [4] (metrics part of the all-in-one) | Avoids running a separate metrics stack |
| **Recommendation** | **If SigNoz is adopted for tracing, take its metrics too (one system). Offer Prometheus + Grafana as the alternative recipe for forks with existing Grafana investment.** | Don't run both SigNoz and Prometheus+Grafana in the same deployment — pick one pane of glass per fork. Expose a Prometheus `/metrics` endpoint regardless (cheap, universal scrape target). |
| **Fit** | **5 (SigNoz) / 4 (Prom+Grafana)** | Both compose-friendly; SigNoz reduces moving parts, Prom+Grafana is more universally understood by IT. |

### 4. Log aggregation

| Lens | Pick | Notes |
|---|---|---|
| Battle-tested | **ELK / OpenSearch** | Full-text indexing, richest query; heavy RAM/CPU [10] |
| Highest-star / popular | **Grafana Loki** 28.5k★ [8][10] | Label-indexed, object-store backed, cheap to run |
| Enterprise-grade | **OpenSearch** (Apache-2.0 ES fork) or **Datadog/Grafana Cloud Logs** | OpenSearch for teams who need ELK semantics fully OSS [10] |
| Best pure-OSS | **Loki** (store) + **Vector** 22.2k★ (pipeline/shipper) [10] | Vector = high-perf collect/transform/route; CNCF |
| **Recommendation** | **SigNoz logs by default (already there if adopted). Where a fork needs standalone logging, Loki for storage + Vector as the shipper; reserve OpenSearch for forks that genuinely need full-text search.** | Loki is stateless-simple (data in object storage) [10]; Vector normalizes/routes and can fan out to multiple sinks. Structured JSON logs from the app make either trivial. |
| **Fit** | **5 (SigNoz) / 4 (Loki+Vector)** | Deploy-per-tenant keeps log volume modest, so Loki's cheap model or SigNoz's unified store both fit; ELK's cost [10] is unjustified at this scale. |

### 5. Distributed rate limiting

| Lens | Pick | Notes |
|---|---|---|
| Battle-tested | **`@upstash/ratelimit`** (2.0k★ [11][14]) on Upstash Redis (SaaS) or any Redis | HTTP/REST client, edge-safe; sliding-window + analytics [14] |
| Highest-star / popular | **`@upstash/ratelimit`** for the Next.js ecosystem [14] | The de-facto Next rate-limit lib; v2.x actively maintained [14] |
| Enterprise-grade | **Envoy / API-gateway-level limiting** or **Upstash Enterprise** | Gateway limiting offloads floods before app; more infra |
| Best pure-OSS | **Self-hosted Redis + `@upstash/ratelimit`'s Redis adapter**, or a token-bucket via `ioredis` + Lua | `@upstash/ratelimit` works against any Redis, not just Upstash's SaaS [14] |
| **Recommendation** | **Replace `lib/rate-limit.ts` internals with `@upstash/ratelimit` pointed at the compose Redis service by default; Upstash SaaS as the option. Keep the existing `withRateLimit` wrapper API so `no-rate-limit-inside-auth` and call sites are unchanged.** | The library's Redis-adapter path removes the Upstash-SaaS lock-in the seed worried about. Compose already needs Redis (Axis 1). |
| **Fit** | **5** | Directly fixes the correctness bug the pivot names (in-memory limiter = `N × limit` across replicas). Wrapper API preserved → no ESLint-rule or route churn. |

### 6. SBOM generation

| Lens | Pick | Notes |
|---|---|---|
| Battle-tested | **Syft** 9.2k★ (Anchore) [12][13] | 30+ ecosystems; emits both CycloneDX and SPDX [13] |
| Highest-star / popular | **Syft** [13] via `anchore/sbom-action` | Runs against the built image; zero custom shell [13] |
| Enterprise-grade | **Syft → Dependency-Track** (CycloneDX) or FOSSA (commercial) | Continuous SBOM ingestion + vuln correlation |
| Best pure-OSS | **CycloneDX** (`@cyclonedx/cyclonedx-npm`) for a JS-native SBOM, or **Syft** for image-level | CycloneDX = security-focused, best npm metadata [12]; per-language plugin [13] |
| **Recommendation** | **Generate a CycloneDX SBOM in CI. Use Syft against the built Docker image (`anchore/sbom-action`, SHA-pinned) as the primary source of truth — image-level catches the full runtime closure, not just `package.json`. Emit CycloneDX (security) + optionally SPDX (license). Attach to the GitHub release and, later, feed Dependency-Track.** | Image-level SBOM (Syft) > source-level for a Docker-first product because it captures OS + base-image packages too. The repo's existing cyclonedx/dependabot hint aligns. |
| **Fit** | **5** | Docker-first makes image-SBOM the natural artifact; one CI step, standard action. |

### 7. Container + dependency scanning

| Lens | Pick | Notes |
|---|---|---|
| Battle-tested | **Trivy** 36.9k★ (Aqua) [15] | Most-adopted OSS scanner; images+fs+IaC+secrets+SBOM; offline DB [15] |
| Highest-star / popular | **Trivy** 36.9k★ [15] | Already available in `/ship --full` |
| Enterprise-grade | **Snyk** (SaaS; CVEs ~47 days earlier [15]) or **Aqua/Prisma Cloud** | Curated DB, dev-experience, licenses; paid |
| Best pure-OSS | **Grype** 12.5k★ (Anchore) [15] — faster pure-image scanning, pairs with Syft | Same-vendor SBOM→scan pipeline (Syft→Grype) |
| **Recommendation** | **Promote Trivy from `/ship --full` to a core CI gate (image + filesystem + secret + misconfig). Run Grype as a second opinion on the SBOM (Syft→Grype). PIN both the GitHub Actions by commit SHA and pin scanner image digests — the March 2026 `trivy-action` tag-poisoning attack [16][17] is exactly why.** | Trivy the *tool* remains the right pick; the incident was tag-mutable actions + Docker Hub creds, not a Trivy code flaw. Grype-on-SBOM adds vendor diversity so one poisoned DB/feed can't blind the pipeline. |
| **Fit** | **5** | Trivy already in-repo; the pivot just promotes it to hard-fail. SHA-pinning is a one-time hardening. |

### 8. SAST / secret scanning in CI

| Lens | Pick | Notes |
|---|---|---|
| Battle-tested | **CodeQL** (GitHub-native) + **gitleaks** 28.1k★ [18][19] | CodeQL: deeper semantic analysis, higher OWASP F1 (74.4% vs 69.4%) [18] |
| Highest-star / popular | **gitleaks** 28.1k★ / **TruffleHog** 27.0k★ (secrets) [19]; **Semgrep** 15.8k★ (SAST) [18] | gitleaks already gates `/ship` |
| Enterprise-grade | **CodeQL** (GitHub Advanced Security) + **GitGuardian** (governance) | CodeQL free for public repos; GHAS licensed for private |
| Best pure-OSS | **Semgrep** 15.8k★ [18] (fast, YAML rules, all CI) + **gitleaks** [19] | Semgrep rules authored in minutes; CodeQL finds unknown-unknowns [18] |
| **Recommendation** | **Run both SAST engines, layered: Semgrep on every PR (fast pattern feedback, custom rules for our `no-*` invariants), CodeQL nightly/on-merge (deep semantic pass). Secrets: gitleaks at pre-commit + CI diff (already wired), TruffleHog on scheduled full-history scans (verified, live-credential detection [19]). Activate the dormant `sast.yml`/`codeql.yml` workflows.** | This is the "pragmatic 2026 stack" the market converged on [18][19]. Semgrep can encode the template's bespoke rules (e.g. no-prisma-in-client) that generic CodeQL packs miss. |
| **Fit** | **5** | Both dormant workflows already exist; gitleaks already in `/ship`. Mostly activation + one Semgrep config. |

### 9. CI/CD pipeline shape (dockerized Next app)

| Lens | Pick | Notes |
|---|---|---|
| Battle-tested | **GitHub Actions → GHCR → deploy** | GHCR: no pull rate limits, free in-Actions bandwidth [20] |
| Highest-star / popular | GitHub Actions (SCM is fixed as GitHub) | Native to the repo; `docker/build-push-action` + buildx cache |
| Enterprise-grade | Actions → GHCR (SHA-tagged + digest-pinned) → **compose pull on host** now; **ArgoCD/Helm** when k8s [20] | Structure images so k8s can layer later (operator decision 3) |
| Best pure-OSS | Same; all components OSS or GitHub-native | — |
| **Recommendation (pipeline stages):** | **(1) `verify` (typecheck+lint+test — the `/ship` fast gates); (2) hardened gates — `knip`, `jscpd`, `coverage`, `size-limit` as HARD fails; (3) `build` multi-stage image (`output:"standalone"`), tag by commit SHA; (4) `sbom` (Syft→CycloneDX); (5) `scan` (Trivy image + Grype-on-SBOM, SHA-pinned actions) — fail on HIGH/CRITICAL; (6) `sast/secrets` (Semgrep+CodeQL+gitleaks/TruffleHog); (7) `push` to GHCR by digest; (8) `deploy` (compose pull now / Helm later); (9) `lhci` perf budget against a preview.** | See the "which dormant gates become hard fails" verdict below. Keep the fast `/ship` loop image-free locally (per ADR-030); the image build/scan lives in CI + `/ship --full`. |
| **Fit** | **5** | GitHub is the fixed SCM; GHCR is the zero-friction registry [20]; compose-now/k8s-ready matches decision 3. |

### 10. Uptime / synthetic / health probes

| Lens | Pick | Notes |
|---|---|---|
| Battle-tested | **`/api/health` route + Docker `HEALTHCHECK` + compose `healthcheck`** [21][22] | 30s interval / 3s timeout / 3 retries is the common baseline [22] |
| Highest-star / popular | **Uptime Kuma** (self-hosted status/uptime) for external synthetic checks | Simple compose add-on; alerting built in |
| Enterprise-grade | **Grafana Synthetic Monitoring / Datadog Synthetics / Checkly** (SaaS) | Multi-region synthetic + SLOs |
| Best pure-OSS | App-native probes + Prometheus blackbox-exporter / SigNoz alerts | Reuses the metrics stack for alerting |
| **Recommendation** | **Ship two endpoints: `/api/health/live` (liveness — process up, returns 200) and `/api/health/ready` (readiness — checks Postgres via Prisma + Redis; returns 503 when a dependency is down [21]). Wire compose `healthcheck` now; the same paths map to k8s `livenessProbe`/`readinessProbe` later (decision 3). Add Uptime Kuma for external synthetic pinging.** | The critical correctness rule: a readiness probe must return **503 when it can't serve**, not `200 {ok:false}` — a 200-always health check "lies" to the orchestrator and traffic keeps routing to a broken pod [21]. Split live vs ready so a slow DB doesn't trigger pod *restarts* (liveness) when it should only drain traffic (readiness). |
| **Fit** | **5** | Pure app + compose; k8s-ready by construction; reuses Prisma/Redis clients we already have. |

---

## Seed-list verdicts

| Seed item | Verdict | Rationale | ADR / `/ship`-gate impact |
|---|---|---|---|
| **OpenTelemetry tracing** | **ADOPT-v1** | Stack-native via `@vercel/otel`, no `next.config` change [1][2]; backend-agnostic OTLP. Enterprise floor names it (Axis 3). | New ADR "Observability stack (OTel + SigNoz default)". Add `instrumentation.ts` primitive. No new hard `/ship` gate (runtime, not CI check). |
| **Sentry (errors)** | **ADOPT-v1 (SDK) / KEEP-AS-OPTION (backend)** | Adopt `@sentry/nextjs` SDK; default DSN → self-hosted **GlitchTip** (compose-fit), Sentry SaaS optional [6]. Self-hosted Sentry rejected (40+ containers, 16 GB [6]). | Same observability ADR. Overlaps SigNoz error views — see sequencing (may defer to v1.1 if SigNoz covers it). |
| **SBOM (CycloneDX)** | **ADOPT-v1** | Docker-first ⇒ image-level SBOM is a natural artifact; Syft→CycloneDX, standard action [12][13]. | New CI stage `sbom`; **hard gate** (build fails if SBOM not produced/attached). New ADR line or fold into supply-chain ADR. |
| **trivy container/dep scanning** | **ADOPT-v1 (hardened)** | Promote from `/ship --full` to core CI gate; most-adopted OSS scanner [15]. **Mandate SHA-pinned actions + digest-pinned scanner images** post-March-2026 incident [16][17]; add Grype-on-SBOM as a second opinion. | Promote to **hard CI fail** on HIGH/CRITICAL. New supply-chain ADR must encode the SHA-pinning rule. Possible new `/ship` lint: "no tag-ref'd third-party action." |
| **distributed rate limit (Redis/Upstash)** | **ADOPT-v1** | Fixes a real correctness bug: in-memory limiter = `N × limit` across replicas. `@upstash/ratelimit` works against self-hosted Redis [14]. | Rewrite `lib/rate-limit.ts` internals (Ask-before file — needs ADR). Keep `withRateLimit` API + `no-rate-limit-inside-auth` rule intact. Supersede the `/scale-up` "add later" recipe. |
| **Redis client** | **ADOPT-v1** | Prerequisite for distributed rate limiting; compose already needs a Redis service (Axis 1). Also future session/cache/queue backing. | Add Redis to `docker-compose.prod.yml`; add readiness-probe check. >50 KB dep ⇒ build-vs-buy ledger entry. |
| **live CI/CD activation** | **ADOPT-v1** | The core of the pivot: "CI dormant" premise inverts. Activate verify/secrets-scan/sast/codeql/uat workflows; GitHub SCM + GHCR [20]. | Reframes ADR-007 (solo-rail/free-plan). Removes "CI dormant" language from CLAUDE.md. `/ship` stays the local pre-push gate; CI becomes the enforcing gate. |
| **size-limit / lhci perf gates** | **ADOPT-v1 (size-limit) / ADOPT-v1 (lhci, non-blocking→blocking)** | size-limit = bundle budget hard fail; lhci = Core Web Vitals regression guard [20]. Both map to the Speed + High-Quality pillars. | size-limit: **hard fail** in CI. lhci: start as a **reporting gate** against a preview, promote to blocking once budgets are calibrated (avoid flaky-perf false reds). |
| **knip / jscpd / coverage gate hardening** | **ADOPT-v1** | Turn the three skip-if-absent `/ship` gates into hard CI fails (dead-code, duplication, coverage floor) — Maintainable pillar. | **Hard CI fails.** knip (unused files/exports), jscpd (duplication threshold), coverage (floor, fed by `/cover`). Update `/ship` so absence ≠ skip in CI mode. |
| **Semgrep / CodeQL SAST** | **ADOPT-v1 (both, layered)** | Semgrep on PR (fast, custom rules for our invariants) + CodeQL nightly (deep) is the converged 2026 stack [18]. Dormant workflows already exist. | Activate `sast.yml` + `codeql.yml` as **hard CI fails** on new HIGH findings. Author a Semgrep ruleset mirroring the `no-*` ESLint rules. |
| **gitleaks secret scan** | **ADOPT-v1 (+ TruffleHog scheduled)** | gitleaks already gates `/ship` [19]; add TruffleHog for verified full-history live-credential scans [19]. | gitleaks stays **hard fail** (already is). Add scheduled TruffleHog workflow (non-blocking report → rotate-now list). |

---

## Sequencing

**v1 — enterprise baseline (ships with the Docker-first template):**
1. **Distributed floor (correctness-first):** Redis service in compose + `@upstash/ratelimit` rewrite of `lib/rate-limit.ts` (fixes the multi-container bug). Readiness/liveness probes (`/api/health/live`, `/api/health/ready`) with 503-when-unhealthy [21].
2. **Live CI/CD:** activate the dormant workflows; GitHub Actions → GHCR (digest-pinned) → compose deploy [20]. **All third-party actions SHA-pinned** [16][17].
3. **Hard-gate the skip-if-absent checks:** knip, jscpd, coverage, size-limit become CI hard fails.
4. **Supply chain:** Syft→CycloneDX SBOM stage + Trivy (promoted to core, SHA/digest-pinned) + Grype-on-SBOM. Fail on HIGH/CRITICAL.
5. **SAST/secrets:** Semgrep (PR) + gitleaks (already) as blocking; CodeQL (merge/nightly) + TruffleHog (scheduled) as layered.
6. **Tracing + metrics + logs:** OTel via `@vercel/otel` → **SigNoz** (one compose service covers all three) [4].

**v1.1 — layer on once baseline is green:**
- Error tracking backend decision: if SigNoz's error views suffice, **defer** a separate GlitchTip/Sentry; otherwise add GlitchTip (compose) with the Sentry SDK.
- lhci promoted from reporting → blocking once perf budgets are calibrated per fork.
- Uptime Kuma for external synthetic monitoring; alerting rules on the metrics backend.
- SBOM → Dependency-Track for continuous vuln correlation.
- New `/ship` lint rule: reject tag-referenced third-party GitHub Actions (encodes the March-2026 lesson).

**Later / k8s-ready (not v1):**
- Helm charts / ArgoCD; gateway-level (Envoy) rate limiting; multi-region synthetic (SaaS); Grafana LGTM as an alternative to SigNoz for forks with existing Grafana.

---

## Sources

1. SigNoz — Instrument Next.js with OpenTelemetry (no `next.config` change on Next 15/16; `@vercel/otel`): https://signoz.io/blog/opentelemetry-nextjs/
2. SigNoz Docs — Next.js OpenTelemetry instrumentation: https://signoz.io/docs/instrumentation/javascript/opentelemetry-nextjs/
3. SigNoz — Deploying & scaling OpenTelemetry in production Next.js: https://signoz.io/blog/opentelemetry-nextjs-production/
4. SigNoz — Grafana alternative / all-in-one observability (replaces LGTM): https://signoz.io/grafana-alternative/
5. getsentry/sentry — GitHub API (44,264★, 2026-07-10): https://github.com/getsentry/sentry
6. DanubeData — Self-host Sentry or GlitchTip (2026); Bugsink comparison (container counts, RAM floor): https://danubedata.ro/blog/self-host-sentry-glitchtip-error-tracking-2026
7. SigNoz — Sentry alternatives 2026: https://signoz.io/comparisons/sentry-alternatives/
8. Star counts via GitHub API, 2026-07-10 — grafana/grafana 75,490; prometheus/prometheus 65,123; grafana/loki 28,533; SigNoz/signoz 28,803; jaegertracing/jaeger 22,987; vectordotdev/vector 22,164; grafana/tempo 5,362; open-telemetry/opentelemetry-collector 7,235.
9. SigNoz — Loki vs Elasticsearch 2026: https://signoz.io/blog/loki-vs-elasticsearch/
10. Canadian Web Hosting — Self-hosted logging 2026 (Loki vs ELK vs Vector, cost); Last9 ELK alternatives: https://blog.canadianwebhosting.com/self-hosted-logging-comparison-2026/
11. Upstash Blog — Rate limiting Next.js API routes with Upstash Redis: https://upstash.com/blog/nextjs-ratelimiting
12. HeroDevs — SPDX vs CycloneDX (choosing an SBOM format): https://www.herodevs.com/blog-posts/spdx-vs-cyclonedx-choosing-the-right-sbom-format-for-your-software-supply-chain
13. Sbomify / sbomgenerator — Syft vs Trivy vs CycloneDX CLI (2026); `anchore/sbom-action`: https://sbomify.com/2026/01/26/sbom-generation-tools-comparison/
14. upstash/ratelimit-js — GitHub (2,040★; works against any Redis; v2.x): https://github.com/upstash/ratelimit-js
15. DevOpsBoys / Aikido / Tomoda — Trivy vs Grype vs Snyk vs Docker Scout (2026): https://devopsboys.com/blog/trivy-vs-grype-vs-snyk-container-scanning-2026
16. Microsoft Security Blog — Trivy supply-chain compromise (2026-03-24): https://www.microsoft.com/en-us/security/blog/2026/03/24/detecting-investigating-defending-against-trivy-supply-chain-compromise/
17. Aqua Security advisory GHSA-69fq-xp46-6x23 — Trivy ecosystem temporarily compromised (tag-poisoning, Docker Hub images): https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23
18. Konvu / Safeguard — Semgrep vs CodeQL 2026 (OWASP F1 74.4% vs 69.4%; layered PR+nightly): https://konvu.com/compare/semgrep-vs-codeql
19. devsecops.ae (NomadX) — Gitleaks vs TruffleHog 2026 (pragmatic stack): https://devsecops.ae/secrets-scanners-comparison-2026/
20. Gecko Security — GHCR guide 2026 (no pull limits, free in-Actions bandwidth); mxd.codes / dev.to — dockerized Next.js CI/CD; Unlighthouse — LHCI guide 2026; Knip in CI: https://www.gecko.security/blog/ghcr-github-container-registry-guide
21. dev.to — "Your Next.js health check is lying to you" (503 vs 200 {ok:false}; live vs ready): https://dev.to/ohyeah_d04cd4c2cd46a1ad2c/your-nextjs-health-check-is-lying-to-you-and-how-to-fix-it-1ho4
22. oneuptime — Containerizing Next.js 14+ with Docker (compose healthcheck 30s/3s/3): https://oneuptime.com/blog/post/2026-02-08-how-to-containerize-a-nextjs-14-application-with-docker-app-router/view
