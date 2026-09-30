# Architecture Decision Records — status index

Every architectural decision in this repo is an **ADR**: a dated, numbered, immutable record. New
ones go through `/adr` (MADR template, `ADR-TEMPLATE.md`).

## The two rules that make this index necessary

1. **ADRs are never edited to reverse a decision, and never renamed or moved.** A decision that no
   longer holds is **superseded by a new ADR**; the old file stays exactly where it is so every link
   in the repo (and in every fork) keeps resolving. Changing the ADR-001 locked stack means writing a
   superseding ADR first — that is a `CLAUDE.md` Ask-before rule.
2. **Because nothing is deleted, a dead decision reads as live unless it is labelled.** Every
   superseded ADR now carries a banner directly under its title, and this table is the index. Read
   the Status column before treating an ADR as current.

Legend — 🟢 Accepted (current) · 🟡 Accepted, partially superseded (read the banner: part of it is
dead) · 🔴 Superseded (historical record only).

> ADR-059 (Asset-Tracker architecture) was archived with the demo domain on 2026-07-25 — recover it
> from the archive tag, see `docs/ARCHIVE.md`. That is why the numbering skips 059.

## Index

| ADR                                                          | Title                                                                                                                   | Status                | Supersession                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| [001](ADR-001-template-baseline.md)                          | Template baseline stack and invariants                                                                                  | 🟡 Accepted (partial) | Docker/GHCR/MinIO baseline → [ADR-006]; UI line → [ADR-029]; Node+zod pins → [ADR-046]                  |
| [002](ADR-002-observability-stack.md)                        | Observability stack: Sentry SaaS + Better Uptime SaaS                                                                   | 🟡 Accepted (partial) | Better-Uptime / self-host ops half → [ADR-006]; observability reframed → [ADR-040]. Sentry half stands. |
| [003](ADR-003-release-process.md)                            | Release process: `/release` after `/promote`                                                                            | 🔴 Superseded         | → [ADR-006] (Vercel owns deploys; no `/promote`/`/release`)                                             |
| [004](ADR-004-ci-driven-ops.md)                              | CI-driven ops (Claude proposes, GitHub Actions executes)                                                                | 🔴 Superseded         | → [ADR-006] (the Actions ops surface was deleted)                                                       |
| [005](ADR-005-deployment-platform-options.md)                | Deployment platform options: keep the droplet path; document the PaaS alternative                                       | 🔴 Superseded         | → [ADR-006] (droplet-vs-PaaS decided: Vercel + Neon)                                                    |
| [006](ADR-006-pivot-to-vercel-neon.md)                       | Pivot to Vercel + Neon; template is a prototype rail, not a production rail                                             | 🟡 Accepted (partial) | deploy-default half → [ADR-035] for self-host forks; still governs the prototype rail                   |
| [007](ADR-007-solo-rail-optimization.md)                     | Optimize for solo operator on free plan; template-as-standard with conformance + tiers                                  | 🟢 Accepted           |                                                                                                         |
| [008](ADR-008-uat-via-playwright.md)                         | UAT through Chrome via Playwright (solo-dev acceptance loop)                                                            | 🟢 Accepted           |                                                                                                         |
| [009](ADR-009-headless-deploy-web-session.md)                | Headless deploy of an existing fork (`/deploy`) from a web session                                                      | 🟢 Accepted           |                                                                                                         |
| [010](ADR-010-audit-completeness-and-atomicity.md)           | Audit completeness (soft-delete / restore / permanent-delete) and the non-atomicity limitation                          | 🟢 Accepted           |                                                                                                         |
| [011](ADR-011-tenancy-by-deployment.md)                      | Tenancy by deployment (one Vercel+Neon project per tool)                                                                | 🟢 Accepted           | reframed by [ADR-035]: one dockerized deployment per tenant on the self-host track                      |
| [012](ADR-012-rest-zod-not-trpc.md)                          | Stay REST + zod (with an OpenAPI seam at handoff), not tRPC                                                             | 🟢 Accepted           |                                                                                                         |
| [013](ADR-013-api-versioning-and-seams.md)                   | Public API versioning (`/api/v1/*`) and the auth/SSO seams                                                              | 🟢 Accepted           |                                                                                                         |
| [014](ADR-014-shared-tier-recipe-library.md)                 | Shared-tier capability recipes live in `docs/recipes/`, not the base                                                    | 🟢 Accepted           |                                                                                                         |
| [015](ADR-015-design-taste-layer.md)                         | Design quality via a generation-time taste layer on AntD, not a stack swap                                              | 🟢 Accepted           | re-targeted (not superseded) by [ADR-029] — the taste-layer method stands, the substrate swapped        |
| [016](ADR-016-website-e2e-testing-tool.md)                   | "Vibe Inspector": website E2E testing tool (extracted to its own repo)                                                  | 🔴 Superseded         | product extracted to [`vibe-inspector`](https://github.com/Tariq-AlNuaimi/vibe-inspector)               |
| [017](ADR-017-dependency-currency-policy.md)                 | Dependency currency policy: continuous in-range, quarterly majors                                                       | 🟢 Accepted           |                                                                                                         |
| [018](ADR-018-audit-retention-via-vercel-cron.md)            | Audit-log retention via Vercel Cron                                                                                     | 🟢 Accepted           |                                                                                                         |
| [019](ADR-019-token-thrift-harness.md)                       | Token-thrift harness: automate context discipline                                                                       | 🟢 Accepted           |                                                                                                         |
| [020](ADR-020-mandatory-senior-code-review.md)               | Mandatory post-push senior code review (cross-stack)                                                                    | 🟢 Accepted           |                                                                                                         |
| [021](ADR-021-client-data-layer-tanstack-query.md)           | Client data layer: TanStack Query                                                                                       | 🟢 Accepted           |                                                                                                         |
| [022](ADR-022-agent-memory-and-model-routing.md)             | Cross-session agent memory + model-routing policy                                                                       | 🟢 Accepted           |                                                                                                         |
| [023](ADR-023-docker-self-host-opt-in-rail.md)               | Docker as an opt-in self-host rail                                                                                      | 🟡 Accepted (partial) | the _opt-in stance_ → [ADR-030]; the Dockerfile/compose implementation stands                           |
| [024](ADR-024-sso-via-microsoft-entra-id.md)                 | MFA via Microsoft Entra ID SSO (flag-enforced)                                                                          | 🟢 Accepted           |                                                                                                         |
| [025](ADR-025-tiered-enforcement-gates.md)                   | Tiered enforcement gates: pillars, blueprint, tier, and a blocking Stop hook                                            | 🟢 Accepted           |                                                                                                         |
| [026](ADR-026-native-design-system.md)                       | A native design system over importing external design skills                                                            | 🟢 Accepted           |                                                                                                         |
| [027](ADR-027-ui-library-and-standard-app-skeleton.md)       | UI library direction & standard app skeleton                                                                            | 🟡 Accepted (partial) | Part 1 (keep AntD) → [ADR-029]; Part 2 (app skeleton) stands                                            |
| [028](ADR-028-enterprise-design-system-and-optional-i18n.md) | Enterprise design-system overhaul + optional Arabic/RTL                                                                 | 🟡 Accepted (partial) | Part 2 AntD layers → [ADR-029]; Part 1 (optional Arabic/RTL) stands                                     |
| [029](ADR-029-ui-replatform-antd-to-tailwind-shadcn.md)      | UI replatform: Ant Design 6 → Tailwind v4 + shadcn/ui + Tremor                                                          | 🟢 Accepted           |                                                                                                         |
| [030](ADR-030-docker-standard-build-artifact.md)             | Docker as a standard build artifact                                                                                     | 🟢 Accepted           | reframed by [ADR-035]: the image is now the primary delivery rail                                       |
| [031](ADR-031-mandatory-structured-db.md)                    | Mandatory structured database                                                                                           | 🟢 Accepted           |                                                                                                         |
| [032](ADR-032-build-vs-buy-enforcement-gate.md)              | Build-vs-Buy Enforcement Gate                                                                                           | 🟢 Accepted           |                                                                                                         |
| [033](ADR-033-blueprint-before-build-gate.md)                | Blueprint-Before-Build Enforcement Gate                                                                                 | 🟢 Accepted           |                                                                                                         |
| [034](ADR-034-complexity-budget-gate.md)                     | Complexity-Budget Enforcement Gate                                                                                      | 🟢 Accepted           |                                                                                                         |
| [035](ADR-035-docker-first-enterprise-delivery.md)           | Docker-first enterprise delivery (self-host, deploy-per-tenant)                                                         | 🟢 Accepted           |                                                                                                         |
| [036](ADR-036-ai-agent-stack.md)                             | AI / agent stack: build a thin Claude-native runtime, don't buy a framework                                             | 🟢 Accepted           |                                                                                                         |
| [037](ADR-037-enterprise-floor.md)                           | The enterprise floor (reframing the solo prototype rail)                                                                | 🟢 Accepted           |                                                                                                         |
| [038](ADR-038-node-24-runtime-floor.md)                      | Node 24 as the runtime floor                                                                                            | 🟢 Accepted           |                                                                                                         |
| [039](ADR-039-argon2id-password-hashing.md)                  | Argon2id password hashing (supersede bcryptjs)                                                                          | 🟢 Accepted           |                                                                                                         |
| [040](ADR-040-otel-observability-backbone.md)                | OpenTelemetry backbone + SigNoz (self-hostable observability)                                                           | 🟢 Accepted           |                                                                                                         |
| [041](ADR-041-supply-chain-hardening.md)                     | Supply-chain hardening (pinned scanners, SHA-pinned Actions, SAST, sign/verify)                                         | 🟢 Accepted           |                                                                                                         |
| [042](ADR-042-ai-quality-pillar.md)                          | AI-Quality: a conditional sixth pillar, inert on non-AI forks                                                           | 🟢 Accepted           |                                                                                                         |
| [043](ADR-043-pgvector-rag.md)                               | pgvector RAG substrate + pluggable embeddings seam                                                                      | 🟢 Accepted           |                                                                                                         |
| [044](ADR-044-langfuse-genai-tracing.md)                     | Langfuse LLM tracing by reusing the OTel backbone (GenAI semconv, no new dep)                                           | 🟢 Accepted           |                                                                                                         |
| [045](ADR-045-enterprise-sso-via-ory-polis.md)               | Enterprise SSO (SAML→OIDC) + SCIM 2.0 via an Ory Polis sidecar                                                          | 🟢 Accepted           |                                                                                                         |
| [046](ADR-046-ws7-stack-bumps-node24-zod4-prettier.md)       | WS-7 stack bumps: Node 24, zod 4, Prettier + format gate                                                                | 🟢 Accepted           |                                                                                                         |
| [047](ADR-047-ws8-harness-hardening.md)                      | WS-8 harness hardening: fail-closed guards, gate-quartet, role-agents, docker-first deploy                              | 🟢 Accepted           |                                                                                                         |
| [048](ADR-048-react-compiler-adoption.md)                    | React Compiler adoption (auto-memoization)                                                                              | 🟢 Accepted           |                                                                                                         |
| [049](ADR-049-mcp-trust-policy.md)                           | MCP trust policy: deny-by-default, pinned, three-tier wiring, untrusted-content rule                                    | 🟢 Accepted           |                                                                                                         |
| [050](ADR-050-ci-blast-radius-hardening.md)                  | CI supply-chain blast-radius hardening (SHA-pin + zizmor gate, Harden-Runner egress, dormant-gate promotion at handoff) | 🟢 Accepted           |                                                                                                         |
| [051](ADR-051-supply-chain-p1-hardening.md)                  | Supply-chain P1 hardening: install-time triad, license gate, provenance, exceljs→SheetJS track                          | 🟢 Accepted           |                                                                                                         |
| [052](ADR-052-openapi-contract-seam.md)                      | OpenAPI contract seam for `/api/v1` (zod-openapi → Scalar → Schemathesis)                                               | 🟢 Accepted           |                                                                                                         |
| [053](ADR-053-docs-site-fumadocs.md)                         | Docs site: Fumadocs, mounted inside the existing Next.js app                                                            | 🟢 Accepted           |                                                                                                         |
| [054](ADR-054-harness-plugin-and-agent-eval.md)              | Harness distribution as a versioned plugin + agent-eval golden-set (who reviews the reviewers)                          | 🟢 Accepted           |                                                                                                         |
| [055](ADR-055-ops-runbooks-and-dr.md)                        | Operational runbooks + DR restore-drill (`docs/runbooks/`)                                                              | 🟢 Accepted           |                                                                                                         |
| [056](ADR-056-auth-beta-freeze-and-better-auth-eval.md)      | Freeze the Auth.js v5 beta pin; track Better Auth as the successor                                                      | 🟢 Accepted           | re-confirmed 2026-07-17 (V2-501): stay frozen, trigger-based revisit                                    |
| [057](ADR-057-parallel-execution-mechanism.md)               | Parallel execution mechanism: native subagent dispatch vs a custom `/fan-out` skill                                     | 🟢 Accepted           |                                                                                                         |
| [058](ADR-058-bdd-traceability.md)                           | Story→test traceability via playwright-bdd (machine-verified coverage)                                                  | 🟢 Accepted           |                                                                                                         |
| [060](ADR-060-rich-text-editor.md)                           | Rich-text editor: adopt Tiptap when a fork needs one (entry ahead of build)                                             | 🟢 Accepted           | deferred adoption — nothing installed until a fork needs it                                             |
| [061](ADR-061-integration-harness-and-ship-full.md)          | Ephemeral-DB integration harness + the warm/full `/ship` split                                                          | 🟢 Accepted           |                                                                                                         |
| [062](ADR-062-plugin-publish-readiness.md)                   | Plugin publish-readiness: prepare, do not publish                                                                       | 🟢 Accepted           |                                                                                                         |
| [063](ADR-063-offline-build-and-vendored-fonts.md)           | The production build must not need the network; fonts are vendored                                                      | 🟢 Accepted           |                                                                                                         |
| [064](ADR-064-sdlc-chain.md)                                 | The SDLC chain: receipt-gated build loop                                                                                | 🟢 Accepted           |                                                                                                         |
| [065](ADR-065-pms-identity-and-roles.md)                     | PMS identity model: `Employee` separate from `User`, additive `PmsRole`                                                 | 🟢 Accepted           |                                                                                                         |
| [066](ADR-066-pms-excel-engine.md)                           | Excel engine for the PMS import layer: `read-excel-file` + `write-excel-file`                                           | 🟢 Accepted           |                                                                                                         |
| [067](ADR-067-salary-at-rest.md)                             | Encryption at rest for `employees.basicSalary`                                                                          | 🟢 Accepted           |                                                                                                         |
| [068](ADR-068-audit-rows-inside-transactions.md)             | An audit row must share the fate of the write it describes                                                              | 🟢 Accepted           |                                                                                                         |
| [069](ADR-069-employee-access.md)                            | Employee access: import-provisioned logins, env-gated SSO, two role systems that stay two                               | 🟢 Accepted           |                                                                                                         |
| [071](ADR-071-next-16-3-for-two-criticals.md)                | Move to Next.js 16.3.x to clear two critical CVEs (no fix exists on the 16.2 line)                                      | 🟢 Accepted           | Supersedes the agent-memory "stay on 16.2.x, no 16.3 preview" note, on its own revisit condition        |

## Supersession map (the ten labelled records)

| Superseded                | By                                    | What actually changed                                                                                                                                                                                      |
| ------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-003, ADR-004, ADR-005 | **ADR-006**                           | The whole self-hosted ops surface (`/promote`, `/rollback`, `/restore`, `/release`, Portainer, DigitalOcean, Cloudflare) was deleted. Vercel deploys on push; roll back by reverting the commit.           |
| ADR-001 (parts)           | **ADR-006**, **ADR-029**, **ADR-046** | `output: "standalone"` + GHCR/Portainer CI/CD + MinIO dropped (006); Ant Design 6 → Tailwind v4 + shadcn/ui (029); Node 24 + zod 4 major pins (046).                                                       |
| ADR-002 (parts)           | **ADR-006**, **ADR-040**              | Better Uptime / self-hosted `/deploy` integration removed (006); SaaS-only observability reframed onto an OpenTelemetry backbone + SigNoz for self-host forks (040). The Sentry half is unchanged.         |
| ADR-006 (deploy default)  | **ADR-035**                           | For enterprise self-host forks the Docker image is the primary delivery rail; Vercel + Neon becomes an opt-in prototype/preview option. The prototype rail — the template default — still follows ADR-006. |
| ADR-016                   | _(extracted)_                         | The "Vibe Inspector" product moved to its own repository.                                                                                                                                                  |
| ADR-023 (stance)          | **ADR-030**                           | Docker went from an opt-in self-host rail to a **standard, mandatory build artifact** gated at `ship:full` / `/deploy` / `/handoff`. ADR-023's Dockerfile/compose/Make implementation is kept.             |
| ADR-027 (Part 1)          | **ADR-029**                           | "Keep AntD, elevate at the token layer" was reversed — the UI replatformed to Tailwind v4 + shadcn/ui. Part 2 (the standard app skeleton) survives.                                                        |
| ADR-028 (Part 2)          | **ADR-029**                           | The AntD-specific design-system layers (`antd-theme.ts`, per-component token overrides) went with AntD. Part 1 (optional Arabic/RTL) survives.                                                             |

**Not superseded, despite appearances:** **ADR-015** (design taste layer) was _re-targeted_ by
ADR-029, not reversed — the generation-time taste-layer method stands, only its substrate changed
(it is still the cited authority for design-token enforcement in `eslint.config.mjs`). **ADR-011**
and **ADR-030** are _reframed_ by ADR-035, not superseded. Only decisions with explicit,
in-file evidence are labelled here.

## Where the enforcement ADRs live

Four ADRs are not just records — they are **hard gates** with a committed adjudication artifact
(`CLAUDE.md` "the enforcement quartet"):

- **ADR-032** build-vs-buy → `docs/build-vs-buy-ledger.md` (a `Scope:` + `Considered:` entry;
  PreToolUse **deny** at write time)
- **ADR-033** blueprint-before-build → `docs/blueprints/<feature>.md` (a covering `Scope:`;
  PreToolUse **deny**)
- **ADR-034** complexity budget → `/ship` RED unless `complexityAck` + an adjudicated
  `docs/findings-register.md` line
- **ADR-036 / ADR-042** ai-eval → conditional; inert on a fork with no AI rail, enforced once one
  sets `AI_API_KEY` and writes eval fixtures

**ADR-025** (tiered enforcement gates) defines the shared `<gate>Ack` + adjudicated-register-line
escape hatch every one of them uses, and **ADR-031** the mandatory-structured-DB gate.

## Adding an ADR

Run `/adr`. Number it one past the highest here (including archived numbers — never reuse 059),
copy `ADR-TEMPLATE.md`, and if it supersedes anything: add a `**Supersedes:**` line to the new ADR,
add the banner to the old one, and add both to this index in the same commit.

<!-- reference links used in the tables above -->

[adr-006]: ADR-006-pivot-to-vercel-neon.md
[adr-029]: ADR-029-ui-replatform-antd-to-tailwind-shadcn.md
[adr-030]: ADR-030-docker-standard-build-artifact.md
[adr-035]: ADR-035-docker-first-enterprise-delivery.md
[adr-040]: ADR-040-otel-observability-backbone.md
[adr-046]: ADR-046-ws7-stack-bumps-node24-zod4-prettier.md
