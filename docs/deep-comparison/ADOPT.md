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

- [x] **knip** — dead-code/unused-export detection as a `/ship` phase (cats 08, 13) — landed 2026-07-03 (`a0a9f61`; phase-A parallel, `knip.json` template-aware entry roots, `knipAck` waiver)
- [x] **jscpd** — duplication threshold gate (cats 08, 13) — landed 2026-07-03 (`a0a9f61`; ≤3% over app/components/lib/hooks, baseline 0.40%, `jscpdAck`)
- [x] **coverage floor** — test-coverage threshold in `/ship` (cats 09, 16) — landed 2026-07-03 (`a0a9f61`; node built-in `--test-coverage` over `lib/**`, lines65/funcs70/branch80, `coverageAck`)
- [x] **size-limit** — bundle budget gate (cat 12) — landed 2026-07-03 (`a0a9f61`; 1.2MB gzip client JS, baseline 1.01MB, `sizeLimitAck`)
- [x] **eslint-plugin-jsx-a11y** — static a11y in the lint gate (cat 22) — landed 2026-07-03 (`a0a9f61`; recommended set at error; 3 UI-layer rules held at warn w/ TODO(C4))
- [x] **complexity metric** — quantified complexity threshold (cat 09) — landed 2026-07-03 (`a0a9f61`; cyclomatic ≤24 on product code, TODO tighten toward ~15 post-replatform)
- [x] **E-gate** — DB-structure check (ADR-031) — landed 2026-07-02 (`scanDbStructure` in
      `scripts/ship.mjs`: baseline-model check, migrations non-empty, shadow-DB sync check with
      graceful WARN degradation, `dbAck` + register adjudication)
- [x] **B-gate** — docker-build in `/ship --full` (ADR-030) — landed 2026-07-02 (`8b50604`;
      `scanDocker` phase gated on `--full`/`SHIP_FULL=1`, graceful WARN when Docker/daemon absent,
      `dockerAck` escape + register line)

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
- [x] **trivy** — image + config scan (cat 10; ADR-030) — landed 2026-07-02 (`8b50604`; wired into
      `/audit` + the docker `/ship --full` phase, optional binary skip-with-note, HIGH/CRITICAL WARN)
- [x] **PreCompact context-refresh hook** — landed 2026-07-02 (`.claude/hooks/pre-compact-refresh.mjs`)

## Wave A3 — measurement & runtime verification (2 sessions)

- [x] **Vercel Speed Insights** — landed 2026-07-02 (`cc353d6`; `@vercel/speed-insights` mounted in
      `app/[locale]/layout.tsx`, guarded by `process.env.VERCEL` — inert in local/Docker)
- [~] **Lighthouse-CI vs preview URL** — config + `npm run lhci` landed 2026-07-02 (`ac3eb4c`;
  `lighthouserc.cjs`, runnable ad-hoc); per-PR CI assertion stays dormant until Actions activate
- [x] **@next/bundle-analyzer** behind `ANALYZE=1` — landed 2026-07-02 (`ac3eb4c`; gate broadened to
      honor `ANALYZE=1`, no-op default/Vercel build)
- [x] **react-scan** dev overlay — landed 2026-07-02 (`ac3eb4c`; `npm run scan` CLI, dev-only)
- [x] **context7 MCP** — landed 2026-07-02 (`.mcp.json` + `docs/mcp.md`)
- [x] **postgres-mcp + k6/k6-mcp + pghero** — landed 2026-07-02 (`/scale-up` §12–14)
- [x] **chrome-devtools-mcp** as-needed wiring note — landed 2026-07-02 (`docs/mcp.md`)

## Wave A4 — process & skills upgrades (2–3 sessions; mostly markdown)

- [x] **Blueprint story IDs + EARS acceptance criteria + `was→now` delta** — landed 2026-07-02
      (`.claude/skills/blueprint/SKILL.md`)
- [x] **Superpowers `writing-plans` wiring + `[P]` markers** — landed 2026-07-02 (blueprint SKILL.md)
- [x] **Anti-rationalization tables** — landed 2026-07-02 on `/ship`, `/qa`, `/design-qa`,
      `/blueprint`
- [x] **grill-with-docs + `/domain-modeling`** skill borrows (cat 02) — landed 2026-07-02 (`dcac2e3`;
      "grill against the docs" alignment interview + structured domain-model grid folded into
      `/blueprint`, cross-referenced in `/scaffold-entity`)
- [x] **MADR schema in ADR-TEMPLATE + Mermaid C4 in `/blueprint`** — landed 2026-07-02
- [x] **Reviewer lenses** — landed 2026-07-02 (five named lenses + execution-trace +
      0–100 confidence filter in `.claude/agents/senior-code-reviewer.md`)
- [x] **Skill auto-activation** — landed 2026-07-03 (`804f331`; `.claude/hooks/skill-activation.mjs`
      consumes `skill-rules.json` on UserPromptSubmit [keywords] + PreToolUse Edit|Write|MultiEdit
      [path globs], advisory `additionalContext` only, never blocks; operator-confirmed defaults)
- [x] **plugin-eval** — evaluator run landed 2026-07-02 (`33ac56a`; `docs/plugin-eval-2026-07.md`
      scores all 24 skills + 2 agents on 4 dims — harness healthy, 5 one-line disambiguation findings)
- [x] **GWT scenario shape** — landed 2026-07-02 (blueprint SKILL.md happy/worst scenarios)

## Wave A5 — testing & design depth (2–3 sessions)

- [x] **fast-check** property tests for audit-scrub/zod invariants (cat 18) —
      landed 2026-07-03 (`2333c98`; `tests/property/*`, 15 props; surfaced + pinned
      2 latent `lib/pagination.ts` edges as KNOWN-GAP tests)
- [x] **qodo-cover-style AI test-gen** on changed files, feeding the A1
      coverage floor (cat 16) — landed 2026-07-03 (session 12; new
      `.claude/skills/cover/SKILL.md` — Claude-driven test-gen with the
      keep-only-if-passes-AND-raises-coverage discipline, targeting the
      `node --test`/tsx runner + the `scanCoverage` floor; concept not dep, ADR-022)
- [x] **`/manual-uat` record-to-spec** — codegen-session emitting committed
      `*.uat.ts` regression specs (cat 17) — landed 2026-07-03 (session 12;
      "Record-to-spec" section in `.claude/skills/manual-uat/SKILL.md` — a walk
      emits a committed `tests/uat/<flow>.uat.ts` re-expressed on our stable
      Radix/shadcn selectors, closing the `/manual-uat → /uat` bridge)
- [x] **Token-thrift trimmed Playwright responses** in browser-driven skills
      (cat 17) — landed 2026-07-03 (session 12; "Token-thrift (ADR-019)" notes in
      `/manual-uat`, `/uat`, `/design-qa` — scoped `browser_snapshot` + `ref`
      interactions over full-tree dumps, screenshot-to-file, capped log reads)
- [x] **Figma design-to-code sub-recipe** in `/design-system`, targeting the
      post-C Tailwind tokens (cat 21; depends on C) — landed 2026-07-03 (session
      12; "Figma → on-token screen" subsection in `/design-system` SKILL + the
      concrete recipe §1b in `docs/design-recipes.md` — read the frame via the
      Figma MCP, map variables → `app/tokens.css` tokens (never raw hex), rebuild
      on `components/shared/*`)
- [x] **style-dictionary `tokens.json` → `@theme` compile** (cat 21; depends on C) —
      landed 2026-07-03 (`2333c98`; `tokens/` + `npm run tokens:build`, additive
      seed over `app/tokens.css`)
- [x] **Slop-gate named anchors + taste tables + density knob** re-targeted to
      Tailwind (cat 22; depends on C) — landed 2026-07-03 (`2333c98`; slop-gate
      Tier-1a criteria in `docs/uat-rubric.md`)
- [x] **A11y manual criteria** (focus/ARIA/live-regions/keyboard, WCAG 2.2 AA)
      lifted into `/design-qa` (cat 22) — landed 2026-07-03 (`2333c98`; Tier-1b
      manual-a11y criteria in `docs/uat-rubric.md`)
- [x] **superdesign variants step** in the design flow (cat 21) — landed
      2026-07-03 (session 12; optional greenfield-only "Rough-variant sketch" step
      in `/blueprint`'s lightweight track — sketch 2-3 approaches, converge, then
      build via `/design-system`; concept not dep, skipped when a recipe fits)

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
- [ ] **Tremor charts (re-promote when Tremor ships React 19 support)** — ADR-029
      named Tremor for charts/KPI, but `@tremor/react@3.18.7` declares a hard
      `react@^18` peer and fails a clean install on this React 19 / Next 16 tree
      (verified 2026-07-03, C2). Not forced. `components/shared/Chart` stays on
      **recharts directly** (React-19-safe) with a Tremor-style declarative API, so
      the swap is a drop-in when the peer clears. Trigger: `@tremor/react` peer
      accepts React 19.

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
