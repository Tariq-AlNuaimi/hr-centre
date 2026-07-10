# Enterprise Pivot — Gap Analysis & Research Brief

> **Status: DIRECTION SET, research pending.** This is the first-pass architectural gap analysis for a strategic repositioning. The deep, multi-agent research it scopes should run in a **fresh session** (this one hit the context limit). Do not treat the "First-pass findings" as final — treat them as the hypotheses the research validates.

## The pivot (the new objective — binding)

| | Was (prototype rail) | Now (enterprise factory) |
|---|---|---|
| **Purpose** | Disposable internal-tool prototypes for non-dev stakeholders to review via a URL | **Enterprise-level apps, tools, Agents, and AIs** shipped as real products |
| **Delivery unit** | Vercel + Neon (`git push` = deploy); Docker an opt-in escape hatch (ADR-030) | **Dockerized Next.js app + dockerized DB** — the fork-and-ship unit; Vercel optional |
| **Audience** | Operator iterates, team reviews, IT takes over later | Enterprise engineering + the operator; production-grade from day one |
| **Constant** | The Claude harness that makes shipping-to-standard automatic | **Unchanged** — still the harness; the *standard* it enforces rises |

**One sentence:** _a dockerized template + a Claude harness that ships enterprise apps, tools, agents, and AIs to an enterprise standard automatically._

This supersedes the "prototype/disposable/personal-tier" framing at the identity level. A fast-prototype mode may survive as a *mode*, but the **default target is enterprise**.

---

## What this pivot touches (the change surface)

Three axes of change, each with an ADR-level decision behind it:

### AXIS 1 — Deploy inverts: Docker-first, DB-in-a-container
- **Supersedes ADR-006** (Vercel+Neon = the deploy path) and **reframes ADR-030** (Docker was a build *artifact*, Vercel the deploy). Now the container is the product.
- **Needs:** a production `Dockerfile` (multi-stage, `output:"standalone"` likely default-on — today it's gated behind `DOCKER_BUILD=1` so Vercel stays byte-identical; that gate's rationale weakens); a `docker-compose.prod.yml` (app + Postgres + Redis + object store + reverse proxy); container registry wiring (GHCR/ECR); migrations run at container start (not `vercel.json` build); secrets via Docker/orchestrator secrets, not the Vercel dashboard; `AUTH_URL` set explicitly (Vercel auto-injects it today — a known trap becomes the default path).
- **DB:** "dockerized DB" = self-hosted Postgres container with persistent volumes, backup/restore, and **connection pooling (PgBouncer)** — mandatory once the app is multi-container. Neon may remain an *option*, not the default. `pgvector` extension becomes near-free here (see Axis 2).
- **Orchestration decision:** compose-only, or Helm/k8s manifests for real enterprise? (Open question for research.)

### AXIS 2 — "Agents and AIs" is a brand-new product category the template has zero primitives for
This is the **largest gap**. Today the repo is a CRUD/RBAC/audit web-app template — no AI runtime at all (the `claude-api` skill is *guidance*, not a shipped `lib/`).
- **Needs (new `lib/ai/*` layer + ADRs):**
  - LLM provider layer (`@anthropic-ai/sdk`) with streaming (RSC + SSE), retries, timeouts, cost accounting per tenant.
  - A tool/function-calling harness + agent-loop orchestration (build vs. adopt: Anthropic SDK tool-runner / Managed Agents vs. a framework — this is a build-vs-buy ledger entry, ADR-032).
  - **Vector store = `pgvector` on the dockerized Postgres** (the dockerized-DB decision makes this the natural choice) + embeddings + retrieval primitives.
  - Prompt/version management; guardrails/safety; **evals + LLM-as-judge** observability for agent quality (the `senior-code-reviewer` pattern, applied to model outputs).
  - Background execution for long-running agents (Inngest/queue — today a `/scale-up` add-on, now core).
  - New scaffold skills: `/scaffold-agent`, `/scaffold-ai-endpoint`, mirroring `/scaffold-entity`.
- Default to the latest Claude models (Opus 4.8 / Sonnet 5 / Haiku 4.5) per the API guidance already in-repo.

### AXIS 3 — "Enterprise-level" raises the floor; the tier model must be rethought
- **Reframes ADR-007** (solo-rail/free-plan optimization) and **ADR-011** (tenancy-by-deployment). Enterprise apps often need **in-app multi-tenancy** with row-level isolation, not one-deploy-per-tool.
- **Floor rises to:** SSO/SAML/OIDC + **SCIM provisioning** as default (ADR-024 Entra ID is opt-in and single-provider — insufficient); fine-grained RBAC/ABAC beyond the 3-role enum; audit retention + compliance export; **column-level encryption** (today intentionally absent); mandatory observability + **OpenTelemetry tracing** (Sentry is opt-in/error-only today); SBOM (the cyclonedx dependabot branch hints at this); container + dependency scanning (trivy exists in `/ship --full`); backup/DR; secrets management (Vault/sealed-secrets).
- **CI stops being dormant.** The whole "free plan, CI dormant, `/ship` is the gate" premise (ADR-007) inverts — enterprise means live CI/CD, and the `/ship --full` docker gate likely becomes the *main* path.
- **Distributed everything.** The **in-memory rate limiter breaks** across containers (must go to Redis/Upstash); several `/scale-up` "add later" recipes (distributed rate limit, background jobs, object storage via MinIO, connection pooling) become **baseline, not optional**.

---

## First-pass findings — what to change, by repo layer

_(Hypotheses for the fresh-session research to validate/cost/sequence. Layer names per `docs/repo-architecture.md`.)_

**L5 Governance (do first — everything downstream depends on it):**
- New superseding ADRs: `Docker-first delivery` (supersedes 006, reframes 030); `AI/agent application stack` (SDK, streaming, pgvector, evals, orchestration); `Enterprise floor` (SSO/SCIM, multi-tenancy, encryption, observability, live CI — reframes 007/011).
- Rewrite the identity in `CLAUDE.md` + `README.md` (prototype-rail language → enterprise factory). Revisit the `personal`/`shared` tier model — likely `enterprise` becomes a tier or the default.
- `SECURITY.md`: multi-tenancy isolation, column encryption, SSO/SCIM, data residency, model-safety for the AI layer.

**L3 Enforcement (the gaps I already flagged become table stakes):**
- Make the 5 PreToolUse guard hooks **fail-closed** (today all fail-open).
- Extend build-vs-buy / blueprint / complexity gates from **added-files-only → full diff**.
- Turn the 4 **skip-if-absent** `/ship` gates (knip, jscpd, coverage, size-limit) into hard-fails in CI.
- New gates: container image scan (promote trivy from `--full` to core), SBOM, AI-eval gate, secrets-in-image scan.

**L2 Runtime (new primitives):**
- New `lib/ai/*` (provider, streaming, tools, agent loop, embeddings, retrieval, evals, cost accounting).
- `lib/rate-limit.ts` → distributed (Redis). `lib/prisma` → pgvector support, connection pooling, tenant-scoping in the extensions.
- Multi-tenancy: tenant column + row-level filter extension (mirror the soft-delete extension pattern).

**L1 Lifecycle (skills):**
- Rework Vercel-centric skills: `/deploy`, `/new-project`, `/first-fork` → Docker/registry/orchestrator flow (keep Vercel as a preview option).
- New: `/scaffold-agent`, `/scaffold-ai-endpoint`, `/dockerize` (promote), an enterprise `/harden` or `/enterprise-readiness` skill.
- `/scale-up`: promote the now-baseline recipes (Redis, jobs, object store, pooling) into core; keep the rest.

**L4 Intelligence / stack:**
- Add: `@anthropic-ai/sdk`, an eval lib, `pgvector`, Redis client, MinIO/S3 client, PgBouncer, OpenTelemetry, a reverse proxy. Each >50 KB dep is an ADR / build-vs-buy ledger entry (the gates now govern the pivot itself — dogfooding).

---

## Research agenda for the fresh session (run this deeply)

Deep, multi-agent (the `deep-research` skill + parallel scouts + market-scan per CLAUDE.md's "market benchmark before building"):

1. **Docker-first Next.js enterprise deploy** — standalone image best practices, compose vs. Helm/k8s, migration-at-startup, secrets, registry, zero-downtime. Cost/complexity of each.
2. **AI/agent application architecture** — Anthropic SDK tool-runner & Managed Agents vs. frameworks (build-vs-buy); streaming patterns in Next 16 RSC; pgvector vs. dedicated vector DB; eval/observability tooling; agent background execution.
3. **Enterprise floor** — SSO/SAML/OIDC + SCIM options; in-app multi-tenancy isolation patterns in Prisma; column encryption; OTel; SBOM/scanning; DR.
4. **Sequencing** — what's a prerequisite for what; what ships in a v1 "enterprise + dockerized" baseline vs. later; which existing ADRs get superseded in what order.

Each answer → a superseding ADR + a build-vs-buy ledger entry. Then `/blueprint` the v1 baseline before any code.

## Open questions for the operator (resolve before building)
- **Orchestration target:** docker-compose only, or Helm/k8s for real enterprise?
- **Multi-tenancy:** in-app (row-level) or stay one-deploy-per-tenant (ADR-011)?
- **Does the disposable/prototype mode survive** as a fast-path mode, or is everything enterprise now?
- **Self-hosted Postgres vs. Neon** as the default DB (dockerized DB implies self-hosted; is Neon still an option)?
- **Which agent runtime** — thin Anthropic-SDK wrapper we own, or adopt a framework?
