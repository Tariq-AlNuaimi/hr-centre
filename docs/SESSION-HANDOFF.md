# Session handoff — 2026-07-02 (UI sign-off + Phase 0)

## Goal
Replatform-and-adoption program, per the signed contract
`docs/blueprints/2026-07-replatform-and-adoption-program.md` (5 operator
directives). This session's sub-goal — UI-layer sign-off + Phase 0 governance —
is **COMPLETE**.

## State
Branch `claude/ui-layer-signoff-replatform-onjlrr` (fast-forwarded from
`claude/claude-repos-comparison-0ddkul`, which it now supersedes). Tree clean,
pushed. `/ship` NOT run (docs-only batch; pushes `--no-verify` per operator
batch instruction). Not deployed.

## Done (this session)
- **Operator signed off Q1: shadcn/ui + Tremor** (via AskUserQuestion — the
  tool works again in this env). All 4 blueprint open questions now answered.
- ADR-029 — UI replatform AntD 6 → Tailwind v4 + shadcn/ui + Tremor (supersedes
  ADR-027 p1 + ADR-028 p2's AntD layers; amends ADR-001 UI line).
- ADR-030 — Docker as standard build artifact (supersedes ADR-023's opt-in
  stance; gate at `/ship --full`/`/deploy`/`/handoff`/CI; trivy; `dockerAck`).
- ADR-031 — Mandatory structured DB (`/ship` schema+migrations gate; `dbAck`).
- `docs/deep-comparison/ADOPT.md` — deduped D1 backlog, waves A1–A5 + deferred,
  with sequencing rules (A2+A4 now, A1 after C).
- Superseded-status headers added to ADR-023/027/028; blueprint marked
  SIGNED OFF with all four answers recorded.

## Decisions
- UI layer = **shadcn/ui + Tremor** (ADR-029). Do not relitigate — the reversal
  rationale vs ADR-027 is recorded in ADR-029's Context.
- recharts stays (under Tremor); dnd-kit stays; forms = react-hook-form +
  zodResolver; tables = shadcn Table + TanStack Table.

## Landmines
- This container's MITM proxy: Chromium can't CONNECT (curl/Node fetch can).
  Workaround: Playwright `context.route('**/*')` fulfilling every request via
  `request.newContext({ proxy })` — see agent-memory entry.
- `docs/SESSION-HANDOFF.md` never merges to `main`.
- Old branch `claude/claude-repos-comparison-0ddkul` is fully contained in this
  branch; safe to delete on remote after this branch merges.

## Next steps
1. **Workstream C1** (Tailwind v4 foundation: install, `@theme` from
   brand.config + tokens.css, next/font, dark-mode strategy) — per blueprint
   §C1; ADR-029 is signed, C is unblocked.
2. Workstreams **A2** (security hooks) + **A4** (process/skills) can run in
   parallel sessions — full blueprint track (Ask-before surfaces).
3. **E** (DB gate in `scripts/ship.mjs`) + **D** (RTL verify pass) anytime;
   **B** (docker gate) after C1.
4. Merge this branch to `main` (minus SESSION-HANDOFF.md) so the ADRs and
   ADOPT.md reach fork source-of-truth.
