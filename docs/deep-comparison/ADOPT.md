# ADOPT.md — the deduped adoption backlog (directive D1)

**Source:** operator directive D1 ("adopt all recommendations across the 22
comparison tables"), scoped by the signed program blueprint
(`docs/blueprints/2026-07-replatform-and-adoption-program.md`, Workstream A).
**Snapshot:** 2026-07-02. ~45 raw recommendations dedupe into the five waves
below plus a deferred list.

**Rules (from the blueprint, binding):**
- This file is the **single checklist**; adoption survives sessions by being
  checked off here, not remembered.
- Each wave lands via its own `/blueprint` + `/ship`-green push. Ask-before
  items (hooks, `lib/`, `eslint-rules/`) get the full blueprint track.
- Waves land whole **or the remainder is re-logged here** — never silently
  dropped (pillar rule).
- Sequencing (operator-answered, 2026-07-02): **A2 + A4 may start now; A1
  waits for Workstream C** (the Tailwind replatform, ADR-029) so its gates
  target the post-replatform tree. A3/A5 are unblocked except where an item
  notes a C dependency.

Status legend: `[ ]` pending · `[x]` done (with date + commit/ADR) · `[~]`
partially landed (note what remains) · `[-]` dropped (with adjudication note).

---

## Wave A1 — deterministic `/ship` gates (after C lands; 2–3 sessions)

Highest leverage: each item turns a manual pillar affirmation into a
deterministic gate. One consolidated `scripts/ship.mjs` extension +
findings-register waiver wiring.

- [ ] **knip** — dead-code/unused-export detection as a `/ship` phase (cats 08, 13)
- [ ] **jscpd** — duplication threshold gate (cats 08, 13)
- [ ] **coverage floor** — test-coverage threshold in `/ship` (cats 09, 16)
- [ ] **size-limit** — bundle budget gate (cat 12)
- [ ] **eslint-plugin-jsx-a11y** — static a11y in the lint gate (cat 22)
- [ ] **complexity metric** — quantified complexity threshold (cat 09)
- [ ] **E-gate** — DB-structure check (ADR-031; owned by Workstream E, listed
      here because it lands in the same `ship.mjs` surface)
- [ ] **B-gate** — docker-build in `/ship --full` (ADR-030; owned by Workstream B)

## Wave A2 — security & trust boundaries (2 sessions; Ask-before, full blueprints)

- [ ] **PostToolUse prompt-injection / secret-exposure scanner** (lasso
      pattern, cat 04) — the output-side trust boundary push-time gitleaks
      can't cover
- [ ] **PreToolUse protect-secrets deny hook** (karanb192 pattern, cat 04)
- [ ] **Dangerous-command deny hook** (disler pattern, cat 04)
- [ ] **Agent-read secret hook** (mintmcp pattern, cat 10)
- [ ] **trufflehog `--only-verified`** — high-signal live-credential pass in
      `/audit` (cat 10)
- [ ] **trivy** — image + config scan (cat 10; owned by Workstream B / ADR-030)
- [ ] **PreCompact context-refresh hook** (cat 04)

## Wave A3 — measurement & runtime verification (2 sessions)

- [ ] **Vercel Speed Insights** — zero-config CWV (cat 12)
- [ ] **Lighthouse-CI vs preview URL** (cat 12)
- [ ] **@next/bundle-analyzer** behind a flag (cat 12)
- [ ] **react-scan** dev overlay (cat 12)
- [ ] **context7 MCP** — read-only current-docs server for the stack (cat 05)
- [ ] **postgres-mcp + k6/k6-mcp + pghero** as `/scale-up` recipes (cat 07)
- [ ] **chrome-devtools-mcp** as-needed wiring (cats 05, 12)

## Wave A4 — process & skills upgrades (2–3 sessions; mostly markdown)

- [ ] **Blueprint story IDs + EARS acceptance criteria** (`US1 → AC-1.1: WHEN …
      THE SYSTEM SHALL …`) + OpenSpec-style `was→now` delta (cat 19)
- [ ] **Superpowers `writing-plans` wiring** downstream of `/blueprint` +
      spec-kit `[P]` parallelizable markers (cat 20)
- [ ] **Anti-rationalization tables** on each gate skill's SKILL.md (cat 02)
- [ ] **grill-with-docs + `/domain-modeling`** skill borrows (cat 02)
- [ ] **MADR schema in ADR-TEMPLATE** (decision drivers, per-option Good/Bad) +
      Mermaid C4 sketch in `/blueprint` (cat 14)
- [ ] **Reviewer lenses** — named blocking lenses in `senior-code-reviewer` +
      logic-lens trace + confidence filter (cat 09)
- [ ] **Skill auto-activation** — `skill-rules.json`-style keyword/path/intent
      triggers (cat 01)
- [ ] **plugin-eval** — static + LLM-semantic evaluator run over our own
      skills/agents (cat 06)
- [ ] **GWT scenario shape** (Given/When/Then) in test-case authoring (cat 17)

## Wave A5 — testing & design depth (2–3 sessions)

- [ ] **fast-check** property tests for audit-scrub/zod invariants (cat 18)
- [ ] **qodo-cover-style AI test-gen** on changed files, feeding the A1
      coverage floor (cat 16)
- [ ] **`/manual-uat` record-to-spec** — codegen-session emitting committed
      `*.uat.ts` regression specs (cat 17)
- [ ] **Token-thrift trimmed Playwright responses** in browser-driven skills
      (cat 17)
- [ ] **Figma design-to-code sub-recipe** in `/design-system`, targeting the
      post-C Tailwind tokens (cat 21; depends on C)
- [ ] **style-dictionary `tokens.json` → `@theme` compile** (cat 21; depends on C)
- [ ] **Slop-gate named anchors + taste tables + density knob** re-targeted to
      Tailwind (cat 22; depends on C)
- [ ] **A11y manual criteria** (focus/ARIA/live-regions/keyboard, WCAG 2.2 AA)
      lifted into `/design-qa` (cat 22)
- [ ] **superdesign variants step** in the design flow (cat 21)

## Deferred / future (tracked, not scheduled)

Re-promote via `/blueprint` when a trigger fires; never adopt silently.

- [ ] claude-task-master (fork outgrows single-session planning)
- [ ] Backlog.md (same trigger)
- [ ] fastmcp provider path (we ship our own MCP server)
- [ ] keploy record-replay (API-level test-gen alternative)
- [ ] Vitest migration (test-runner swap; needs its own ADR)
- [ ] citus / read-replicas (scale trigger, cat 07)
- [ ] sonarqube-mcp at `/handoff` (IT team runs SonarQube)
- [ ] wasp declarative-CRUD ergonomics study over `/scaffold-entity` (cat 11)
- [ ] specialist-agent seeds (`nextjs-pro`/`postgres-pro`/`prisma-expert`) as
      one optional stack-aware review agent (cat 03)

---

## Cross-references

- Program contract: `docs/blueprints/2026-07-replatform-and-adoption-program.md`
- Governance: ADR-029 (UI replatform), ADR-030 (Docker standard), ADR-031
  (mandatory DB)
- Evidence layer: `01–22` in this folder; consolidated per-category picks in
  `README.md`
- Note (ADR-029 consequence): the `21`/`22` skip-verdicts phrased against
  "we're on AntD" **flip to adoptable** once Workstream C lands — tweakcn,
  shadcn MCP servers, Tailwind density tokens are in scope for A5/C4.
