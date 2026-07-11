# Phase 2 backlog + implementation phasing (enterprise pivot)

## A. Future benchmark-research tasks (operator request) — DISCUSS AFTER the plan is fully implemented
Same exhaustive top-10 × 4-lens methodology as `METHODOLOGY.md`. Do NOT start these until the
implementation plan (below) is landed and green.
1. **Enterprise benchmark research — Skills.** Benchmark our `.claude/skills/*` lifecycle against how
   leading orgs package AI dev workflows (skill libraries, golden-path generators); what skills a
   best-in-class enterprise Claude harness ships; gaps in ours.
2. **Enterprise benchmark research — Agents.** Benchmark our role-agent model (scout / senior-code-reviewer /
   Plan / Explore / general-purpose + proposed ai-eval / security-architect / sre) vs enterprise multi-agent
   patterns; agent registry, evals, guardrails, orchestration.
3. **Enterprise benchmark research — MCPs.** Benchmark MCP servers to standardize on (github, playwright,
   chrome-devtools, shadcn, context7, figma, + net-new: DB, observability, secrets, cloud); trust/security
   posture of MCP; which to ship wired by default.
4. **Enterprise benchmark research — Libraries.** A deeper cut than the v2 dependency pass: transitive-dep
   health, supply-chain posture, license audit, and per-capability library shortlists for the net-new
   enterprise surface.
5. **Enterprise benchmark research — anything else remaining.** Sweep for uncovered surfaces (docs system,
   DX/onboarding, data migration/seeding, cost/FinOps, DR runbooks, compliance evidence automation, etc.).

## B. Implementation phasing for the v2 plan (do this BEFORE writing code)
The v2 report's P0/P1/P2 action plan is the source of truth. Because nearly every action touches the
Ask-before surface, implementation MUST go through the repo's own gates. Recommended sequence:

**Phase 0 — Governance first (L5).** Write the superseding ADRs the plan implies (Docker-first delivery
[supersedes ADR-006, reframes ADR-030]; AI/agent stack; enterprise floor [reframes ADR-007/011]; Node 24;
Argon2id; observability/OTel; supply-chain hardening incl. the Trivy-pin incident). Each net-new capability
also needs a `docs/build-vs-buy-ledger.md` entry BEFORE its `lib/` file (the gate denies otherwise).

**Phase 1 — `/blueprint` the v1 enterprise baseline.** One committed blueprint (or a few) covering the P0
slice: Docker delivery rail (Dockerfile + compose.prod + Caddy), Valkey rate-limiter, Argon2id, Trivy pin +
SHA-pin actions + SAST, OTel+SigNoz seam, and the `lib/ai/*` provider+tool-runner skeleton. Resolve open
questions via AskUserQuestion. The blueprint gate requires this before new routes/pages.

**Phase 2 — Implement in gated increments, each landing green.** Suggested parallelizable workstreams
(independent enough to run as separate plan-mode efforts / worktree agents, but each with its own blueprint
+ /ship + /code-review + senior-code-reviewer):
- WS-1 Delivery: Dockerfile (distroless, non-root, digest-pinned) + compose.prod (profiles) + Caddy + GHCR + migration-at-startup.
- WS-2 Security P0: pin Trivy (≤0.69.3) + trivy-action v0.35.0, SHA-pin all actions, add Semgrep/Opengrep SAST + cosign/SLSA, bcrypt→@node-rs/argon2.
- WS-3 Distributed runtime: Valkey + rate-limiter-flexible (replace in-memory `lib/rate-limit.ts`), pg-boss queue.
- WS-4 Observability: `@vercel/otel` in instrumentation.ts → OTel Collector → SigNoz; keep Sentry (GlitchTip self-host default).
- WS-5 AI layer: `lib/ai/*` (Anthropic SDK provider + thin native Tool Runner wrapper), pgvector, evals (Langfuse+Promptfoo), `/scaffold-ai-endpoint`, ai-eval agent + gate.
- WS-6 Identity floor: Ory Polis sidecar (SAML→OIDC + SCIM), generalize Entra ID to one-OIDC-per-deploy.
- WS-7 Stack bumps: Node 22→24, zod v3→v4, TS7 shadow-CI pilot; add Prettier + format gate; activate dormant CI gates as HARD.
- WS-8 Harness (L1-L3): fail-open→fail-closed hooks, gate-trio→gate-quartet (add ai-eval), security-architect + sre role-agents, enforce ADR-022 tier routing, docker-first `/deploy`.

**Do NOT** batch-generate all of this in one pass. Each WS: blueprint → plan-mode sign-off → implement →
/ship green → /code-review → push → senior-code-reviewer. Land P0 (WS-1/2/3) before P1/P2.

> Reminder: the operator's "below list" (referenced but never pasted) still needs folding into the v2
> benchmark categories and the report before/at the start of implementation.
