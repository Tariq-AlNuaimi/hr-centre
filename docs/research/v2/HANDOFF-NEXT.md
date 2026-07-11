# HANDOFF — Enterprise Benchmark v2 (exhaustive, top-10 × 4-lens) → finish in a fresh session

**Branch:** `claude/enterprise-pivot-research-6t7euo` (all work pushed here).
**Operator goal (verbatim intent):** an exhaustive review of EVERYTHING in the repo (+ what's
needed to reach enterprise level). For **every catalogue item**: top-10 battle-tested ×
top-10 highest-star × top-10 enterprise × top-10 OSS, full head-to-head, and a
**Recommendation column** (what we take / change to reach "the perfect enterprise repo").
PLUS a **top-10 enterprise-architects** section (is our approach right for the AI era?).
Deliverable = a **self-contained HTML report** to revise and build a plan from. Cite sources.

> The operator's v1 (top-1-per-lens) report was rejected as not thorough enough. This v2 is
> the redo at top-10 depth. v1 files (`docs/research/*.md`, `enterprise-benchmark-report.html`,
> Artifact https://claude.ai/code/artifact/8672e218-b611-4c56-ac47-b7f01ee76226) stay as a
> skeleton — do NOT delete; v2 supersedes.

## STATUS
Scope decisions (operator, via AskUserQuestion): **run START NOW this session** (spilled to
handoff at context limit — expected); catalogue = **every current dependency (100+) + net-new**.

Spec on disk (pushed): `docs/research/v2/METHODOLOGY.md` (binding output format — READ FIRST) +
`docs/research/v2/CATALOGUE.md` (all deps + net-new, 14 categories C01–C14 + architects C15).

**Research files — 14/15 DONE + pushed** in `docs/research/v2/`:
01-core-framework · 02-data-layer · 03-auth-identity · 04-authz-policy · 05-ui-design-system ·
06-forms-validation-data · 07-ai-agent-stack · 08-i18n · 09-infra-delivery · 10-observability ·
11-supplychain-security · 12-testing-qa · 14-runtime-services · 15-architects-ai-era.
**MISSING: 13-cicd-tooling.md** (first C13 agent failed to write; a re-run was in flight).

## NEXT ACTIONS (in order)
0. **Add the operator's 5-Principles trace (NEW — operator request).** The operator wants the
   deliverable to explicitly show each recommendation against their 5 principles (= the repo's
   Five Pillars): **Scalability, Maintainability, Security, Quality, Speed-of-Delivery** (defs:
   scalable-to-complexity not complex-from-day-1; single-responsibility, ≤1-file-per-behavior-change,
   typed end-to-end; hostile-input + least-privilege + authz on every route; explicit edge/empty/error
   states + validate-vs-requirements; small shippable increments, proven libs, no gold-plating — never
   trading the other four for speed). The v2 files scored fit-vs-stack + honored the pivot but did NOT
   add an explicit per-recommendation 5-principle column. Add: (a) a short "how each principle shaped
   the verdicts" note in the exec summary; (b) a principle tag on each P0/P1/P2 action-plan row (which
   principle it most serves) — flagging where a pick trades one principle for another (e.g. Argon2id =
   Security up, tiny Speed cost). Then **re-publish to the SAME Artifact URL** (pass
   `url=https://claude.ai/code/artifact/4c9aa672-d04e-4646-b9dc-faa97a3bfe78`).
1. **Glob `docs/research/v2/13-cicd-tooling.md`.** If absent, re-run one general-purpose agent:
   "read METHODOLOGY.md; benchmark C13 (linter/formatter/CI-platform/dead-code/dup/bundle-budget/
   release/git-hooks/design-tokens) with 4-lens top-10 per item; WRITE the file." Seed with the
   "C13 findings" below if needed.
2. **Fold in the operator's pasted list** — the operator referenced a "below list" to add to the
   comparison that never pasted. Check the latest message / ask for it; add items as `[op]` to the
   right category files before synthesizing.
3. `git add docs/research/v2/*.md && commit && push` any new files.
4. **Synthesis → HTML.** ONE fresh-context general-purpose agent reads all 15 `docs/research/v2/*.md`
   + METHODOLOGY.md + this file, writes a **self-contained** report to
   `docs/research/v2/enterprise-benchmark-v2.html`. Structure: exec summary (verdict tally + the
   load-bearing calls + a current-events-catches callout) → per-category sections with the 4-lens
   top-10 tables + head-to-head + Recommendation → cross-item verdict matrix → architects (Part
   A/B/C) → prioritized P0/P1/P2 action plan. Rules: NO external hosts (inline all CSS; no
   webfont/CDN URLs), theme-aware (prefers-color-scheme + data-theme), wide tables in
   `overflow-x:auto`, NO `<!doctype>/<html>/<head>/<body>` skeleton tags (Artifact adds them),
   `<title>` present. Grep-verify (0 skeleton tags, 0 external hosts) before publishing. Given
   15 large files, the agent may need to build section-by-section to fit context.
5. **Publish Artifact** — load `artifact-design` skill first; favicon 🏭; new file → new URL; give
   the operator the URL to revise.
6. **`/ship` green** — docs-only; run `npm run ship` WITHOUT `export NODE_ENV=production` (that flag
   loads production react-dom into jsdom and falsely fails component tests). Push. Verify
   `git rev-list --count @{u}..HEAD` = 0.

## CROSS-CUTTING FINDINGS (seed for the exec summary)
**Big KEEP (stack is largely right):** Next.js 16 + React 19 (5/5); Prisma 7 (WASM rewrite kills
Drizzle's old edge); Auth.js v5; AntD→Tailwind/shadcn migration (all UI = KEEP); zod; react-hook-form;
TanStack Table/Query (scope Query to client islands — RSC is default read path); Playwright + fast-check;
next-intl; gitleaks/npm audit; knip/jscpd/size-limit.

**Big REPLACE / ADD (P0/P1):**
- Node 22 → **Node 24**; TS5 → plan **TS7** (Corsa GA 2026-07-08, ~10× tsc) as shadow-CI pilot.
- **In-memory rate-limiter = real bug** under multi-replica → **Valkey + rate-limiter-flexible** (P0).
- `bcryptjs` → **@node-rs/argon2** (Argon2id).
- Vector **pgvector** on PG 17/18; backup **WAL-G** (NOT pgBackRest); pooler **PgBouncer**.
- AI agent runtime **BUILD** (~100-line wrapper on Anthropic **native Tool Runner**); defer frameworks;
  Vercel AI SDK for streaming-UI seam only; evals **Langfuse + Promptfoo**.
- Identity: **Ory Polis** (SAML→OIDC + SCIM sidecar), Auth.js consumes as OIDC.
- AuthZ: KEEP 3-role enum + add `lib/authz/` seam; default engine **Cerbos** (defer from v1), OpenFGA hatch.
- Infra: multi-stage **distroless** image, `compose.prod.yaml` profiles, **Caddy** proxy, **Garage**
  (not MinIO) object store, **OpenTofu** (not Terraform), **SOPS+age** secrets.
- Observability: **OpenTelemetry** backbone + **SigNoz** all-in-one; keep Sentry (backend tenant-choosable;
  GlitchTip self-host default).
- Supply chain: add **SAST (Semgrep/Opengrep)** + **cosign/SLSA**; **pin all Actions to full SHA**.
- Runtime: **pg-boss** queue; **React Email**; reconsider PDF via **@react-pdf/renderer**.

**CURRENT-EVENTS CATCHES (verify before final report — they change defaults):**
- **Trivy compromised 2026-03-19** (CVE-2026-33634) — repo runs trivy in `/ship`/CI. Pin trivy ≤0.69.3,
  trivy-action v0.35.0, setup-trivy v0.2.6. **P0.**
- **tj-actions/changed-files CVE-2025-30066** → SHA-pin all Actions.
- **MinIO CE archived 2026-04-25** → Garage. **pgBackRest unmaintained 2026-04** → WAL-G.
  **Bitnami free images deprecated 2025-08** → official pgvector/pgvector.
- **Auth.js absorbed into Better Auth (2025-09-26)** (security-fixes-only; log migration eval). **Lucia deprecated.**
- **Terraform/Vault BUSL** → OpenTofu/OpenBao. **Redis→Valkey.** **Soketi abandoned.** **Oso OSS deprecated.**
  **Warrant→WorkOS.** **OPA team → Apple (2025-08).**
- **shadcn default → Base UI (2026-07)** (Radix still fine); **cva dormant**; **Tremor→Vercel.**
- **ExcelJS stalled** (pin). **next-i18next = Pages-Router trap.**
- **ts-prune/unimported archived → knip**; **husky quiet (v10 pre-announced)**; **@lhci/cli lags Lighthouse 13**;
  **Langfuse→ClickHouse, Promptfoo→OpenAI, Voyage→MongoDB** (all still OSS/self-host); **HyperDX→ClickHouse (ClickStack)**;
  **Grafana LGTM + OpenObserve + Uptrace are AGPL-3.0** (matters for a redistributed template; SigNoz core is MIT).

## Architects/AI-era (C15) — highest-leverage harness tweaks
- **Add an `ai-eval` agent + AI-eval `/ship` gate (P0)** — harness gates code but not model outputs; mirror
  senior-code-reviewer (LLM-as-judge + eval suite + adjudication artifact) → gate-trio becomes a gate-quartet.
- **`/scaffold-ai-endpoint` + a conditional 6th "AI-Quality" pillar (P0)** (inert on non-AI forks; don't fold into High-Quality).
- **Unify the 5 fail-OPEN deny-hooks + 10 lint rules + ship gates into one fail-CLOSED whole-diff policy pass (P1)** — fixes the #1 systemic gap (guards fail open; added-files-only blindness).
- **New `security-architect` + `sre` role-agents + Docker-first `/deploy`; promote SBOM/container-scan to always-on fitness functions (P1).**
- **Enforce ADR-022 model-tier routing (currently advisory) + a runtime cascade router w/ per-tenant cost metering (P1).**
- Framing: DORA 2025 validates the thesis (AI is an amplifier; a quality internal platform is the governance/distribution layer). Strongest school for us = Ford/Parsons/Kua **fitness functions** — our gates already are fitness functions; we're missing eval/tracing-coverage/SBOM-freshness ones.

## C13 findings (reconstruct 13-cicd-tooling.md if needed)
- **Linter:** KEEP ESLint 9 (v10 Feb 2026 flat-config-only; only tool running the 10 custom AST rules faithfully); hybrid **Oxlint (fast, ESLint-compatible JS plugins, alpha) + ESLint (type-aware/custom authoritative)** is the 2026 pattern. Biome GritQL can't do logic/type-aware rules.
- **Formatter:** repo has none → add **Prettier** (or Biome format, ~25-35× faster, ~97% compat).
- **CI platform:** KEEP GitHub Actions as thin trigger (free self-hosted runners + ARC); optional **Dagger** for portable build logic; SHA-pin all. Woodpecker = light OSS self-host; GitLab CI = heavyweight all-in-one; **Earthly DEAD**; Jenkins legacy.
- **Dead-code** knip. **Dup** jscpd (v5 Rust). **Bundle** size-limit (bundlewatch dormant; lhci lagging). **Release** changesets. **Hooks** husky (lefthook if chain grows). **Tokens** style-dictionary (DTCG stable).
- **HARD CI gates for enterprise:** gitleaks, npm audit, pinned Trivy+Grype, action-SHA-pin (zizmor), SAST ruleset, cosign/SLSA verify-on-deploy.

## GOTCHAS
- Agents sometimes return the report as the completion MESSAGE instead of writing the file (C13 run 1 did). Always Glob-verify the file after an agent finishes; re-run if absent.
- `/ship` docs-only: `npm run ship` WITHOUT forcing NODE_ENV=production.
- Commit author must be `noreply@anthropic.com` (Stop hook flags "Unverified" otherwise).
