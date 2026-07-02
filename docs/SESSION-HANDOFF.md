# Session handoff — 2026-07-02

## Goal
Operator directives on the deep-comparison batch, program-planned in
`docs/blueprints/2026-07-replatform-and-adoption-program.md`: (1) adopt all
22-table recommendations, (2) Docker a standard build, (3) replace AntD with
Tailwind fully, (4) RTL/ar fully optional, (5) every app has a structured DB.
Current sub-goal: operator sign-off on the UI layer, then Phase 0 (ADR-029/030/031
+ ADOPT.md).

## State
Branch `claude/claude-repos-comparison-0ddkul`, in sync with origin after this
handoff's push. Tree clean. `/ship` NOT run this session (docs + screenshots only;
pushes were `--no-verify` per operator batch instruction). Not deployed. Local PG
:5433 + dev server were session-local (gone in a fresh container).

## Done
- `662f85d` docs: deep-comparison README index + adopt-per-category list.
- `4db376e` docs: program blueprint for the 5 directives (the contract).
- `0f5b1ad` chore: lockfile churn from SessionStart.
- Published artifact (22 comparison tables): claude.ai/code/artifact/c873b8f9-20ef-4e12-99d0-b23a81c04cb8
- Delivered 6 dashboard screenshots (ours-AntD live, shadcn, Tremor, HeroUI,
  Catalyst, TailAdmin) for the UI-layer decision.

## In flight
- **UI-layer sign-off pending.** 3 of 4 open questions answered (Docker gate =
  full-ship/deploy/handoff; RTL = keep inert; sequencing = A2+A4 now, A1 after C).
  Q1 (component layer) awaiting confirm after screenshots; recommendation
  **shadcn/ui + Tremor** (also ADR-027's own pick).

## Decisions
- Program blueprint is the contract; governance first: ADR-029 (AntD->Tailwind,
  supersedes ADR-027/028-p2), ADR-030 (Docker standard, supersedes ADR-023),
  ADR-031 (mandatory DB). D4 (optional RTL) already shipped by ADR-028 p1.
- Big-bang replatform on a branch; same-API rebuild of `components/shared/*`.

## Landmines
- This container's MITM proxy: Chromium can't CONNECT (curl/Node fetch can).
  Workaround that works: Playwright `context.route('**/*')` fulfilling every
  request via `request.newContext({ proxy })` — see agent-memory entry.
- Flowbite/Vercel demos bot-gate headless browsers ("Failed to verify browser").
- preview.pro.ant.design chunks time out through the proxy — use our own app
  (local PG recipe in agent-memory) as the AntD exhibit.
- `docs/SESSION-HANDOFF.md` never merges to `main`.

## Next steps
1. Get operator confirm on shadcn/ui + Tremor (screenshots delivered).
2. Phase 0: write ADR-029/030/031 + `docs/deep-comparison/ADOPT.md`; commit, push.
3. Start Workstream A2 (security hooks) + A4 (process/skills) in parallel sessions;
   Workstream C (replatform) kicks off per blueprint SS-C1 after ADR-029 signs.
