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
- [x] **E-gate** — DB-structure check (ADR-031) — landed 2026-07-02 (`scanDbStructure` in
      `scripts/ship.mjs`: baseline-model check, migrations non-empty, shadow-DB sync check with
      graceful WARN degradation, `dbAck` + register adjudication)
- [ ] **B-gate** — docker-build in `/ship --full` (ADR-030; owned by Workstream B)

## Wave A2 — security & trust boundaries (2 sessions; Ask-before, full blueprints)

- [x] **PostToolUse prompt-injection / secret-exposure scanner** — landed 2026-07-02
      (`.claude/hooks/post-tool-scan.mjs`; warn-only via additionalContext, 300KB cap,
      session dedupe; blueprint: `docs/blueprints/wave-a2-security-hooks.md`)
- [x] **PreToolUse protect-secrets deny hook** — landed 2026-07-02
      (`.claude/hooks/protect-secrets.mjs`; denies `.env*`/key-material reads, allows `.env.example`)
- [x] **Dangerous-command deny hook** — landed 2026-07-02 (`.claude/hooks/dangerous-commands.mjs`)
- [x] **Agent-read secret hook** — landed 2026-07-02 (deduped into `protect-secrets.mjs`)
- [x] **trufflehog `--only-verified`** — landed 2026-07-02 (optional pass in `/audit` SKILL.md;
      external binary, skips-with-note when not installed)
- [ ] **trivy** — image + config scan (cat 10; owned by Workstream B / ADR-030)
- [x] **PreCompact context-refresh hook** — landed 2026-07-02 (`.claude/hooks/pre-compact-refresh.mjs`)

## Wave A3 — measurement & runtime verification (2 sessions)

- [~] **Vercel Speed Insights** — recipe documented (`/scale-up` §15) 2026-07-02; install lands
      in the full A3 pass
- [~] **Lighthouse-CI vs preview URL** — recipe documented (`/scale-up` §15) 2026-07-02; wiring
      lands in the full A3 pass
- [~] **@next/bundle-analyzer** behind `ANALYZE=1` — recipe documented (`/scale-up` §15)
      2026-07-02; install lands in the full A3 pass
- [~] **react-scan** dev overlay — recipe documented (`/scale-up` §15, npx CLI) 2026-07-02
- [x] **context7 MCP** — landed 2026-07-02 (`.mcp.json` + `docs/mcp.md`)
- [x] **postgres-mcp + k6/k6-mcp + pghero** — landed 2026-07-02 (`/scale-up` §12–14)
- [x] **chrome-devtools-mcp** as-needed wiring note — landed 2026-07-02 (`docs/mcp.md`)

## Wave A4 — process & skills upgrades (2–3 sessions; mostly markdown)

- [x] **Blueprint story IDs + EARS acceptance criteria + `was→now` delta** — landed 2026-07-02
      (`.claude/skills/blueprint/SKILL.md`)
- [x] **Superpowers `writing-plans` wiring + `[P]` markers** — landed 2026-07-02 (blueprint SKILL.md)
- [x] **Anti-rationalization tables** — landed 2026-07-02 on `/ship`, `/qa`, `/design-qa`,
      `/blueprint`
- [ ] **grill-with-docs + `/domain-modeling`** skill borrows (cat 02)
- [x] **MADR schema in ADR-TEMPLATE + Mermaid C4 in `/blueprint`** — landed 2026-07-02
- [x] **Reviewer lenses** — landed 2026-07-02 (five named lenses + execution-trace +
      0–100 confidence filter in `.claude/agents/senior-code-reviewer.md`)
- [~] **Skill auto-activation** — advisory `.claude/skill-rules.json` landed 2026-07-02;
      hook wiring into settings.json is a proposed follow-up (`.claude/README.md`)
- [~] **plugin-eval** — adopt-before-use note landed (`.claude/README.md`) 2026-07-02; an actual
      evaluator run over our skills/agents remains
- [x] **GWT scenario shape** — landed 2026-07-02 (blueprint SKILL.md happy/worst scenarios)

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
