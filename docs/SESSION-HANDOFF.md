# Session handoff — 2026-07-02 (session 2: five workstreams integrated)

## Goal
Replatform-and-adoption program per the signed contract
`docs/blueprints/2026-07-replatform-and-adoption-program.md`. This session:
grand table delivered, then FIVE parallel workstream items integrated via
four worktree agents, `/ship` green, pushed.

## State
Branch `claude/ui-layer-signoff-replatform-onjlrr` at HEAD after integration,
pushed, tree clean. **`/ship` GREEN end-to-end (12 phases, ~42s)** after a
required environmental lint fix (see below). Not deployed. Base for this session
was `a61d3d7`.

## Done this session (all cherry-picked into one green /ship, one push)
Four worktree agents ran in parallel (like session 1's 6-agent run); 11 agent
commits + 1 integrator fix landed:
1. **C2 slice** (`1d8b040`,`f38391f`) — shadcn foundation (`lib/utils.ts` `cn()`,
   `components/ui/button|badge`) + 5 simplest `components/shared/*` primitives
   (EmptyState, SectionCard, DescriptionList, StatCard, Toolbar) rebuilt on
   shadcn/Tailwind with **exact same prop APIs** (screens still compile). Deps:
   class-variance-authority, clsx, tailwind-merge. AntD stays; preflight OFF.
2. **B — docker gate + trivy** (`8b50604`,`982a89f`) — `scanDocker()` in
   `scripts/ship.mjs` gated on `--full`/`SHIP_FULL=1` (fast loop image-free);
   graceful WARN when Docker/daemon absent; `dockerAck` escape + register line;
   trivy image+config scan wired into `/audit` + the `--full` phase (ADR-030).
3. **db-structure exemption fix** (`b82c12d`,`ac266cd`) — replaced the
   package-name proxy with a `"pristine": true` flag in `project.config.json`;
   all three fork scripts (rebrand/deploy/new-project) clear it. Findings-register
   line → `fixed`. (ADR-031.)
4. **A3 install pass** (`cc353d6`,`ac3eb4c`) — @vercel/speed-insights mounted
   (VERCEL-guarded), bundle-analyzer gate broadened to `ANALYZE=1`, `npm run scan`
   (react-scan) + `lighthouserc.cjs`/`npm run lhci` (dormant).
5. **A4 remainder** (`dcac2e3`,`33ac56a`,`1baf853`) — grill-against-docs +
   domain-model grid folded into `/blueprint` (cross-ref `/scaffold-entity`);
   `docs/plugin-eval-2026-07.md` evaluator run (24 skills + 2 agents).
6. **Integrator lint fix** (`1d2d912`) — see landmine #1.

ADOPT.md checked off this session: A2 **trivy** → `[x]` (A2 now fully complete);
A1 **B-gate** → `[x]`; A3 Speed-Insights/bundle-analyzer/react-scan → `[x]`
(Lighthouse-CI stays `[~]`, dormant-CI); A4 grill-with-docs + plugin-eval → `[x]`
(skill auto-activation stays `[~]` — Ask-before settings.json hook wiring).

## Landmines / notes
- **#1 (env lint fix, IMPORTANT):** on a fresh `npm ci` of this branch, `/ship`
  lint aborts with *"could not find plugin react-hooks"*. Cause: eslint-config-next
  registers react-hooks in a `files`-scoped object, but the template's global
  rule-relaxation object referenced its rule, and ESLint 9.x on the pinned
  next@16.2.9 + eslint-plugin-react-hooks@7.1.1 aborts config validation. Fix
  (`1d2d912`): added `files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"]` to that object
  in `eslint.config.mjs`. This is now committed — do NOT re-diagnose it.
- **#2 (integration hygiene, worked well):** agent worktrees under
  `.claude/worktrees/` were correctly based on the session branch HEAD this time
  (not main). Still: `git worktree remove --force` ALL of them BEFORE `/ship`
  (they poison lint), then `npm ci` (NOT `npm install`) to get an exact,
  drift-free tree — `npm install` left eslint-config-next in a broken export shape.
- gitleaks was already at `~/.local/bin` (8.21.2) this container; `export
  PATH="$HOME/.local/bin:$PATH"` before `/ship`. If missing next time:
  `GOBIN=~/.local/bin go install github.com/zricethezav/gitleaks/v8@v8.21.2`.
- db-structure sync check WARN-skips without `SHADOW_DATABASE_URL`; checks (a)+(b)
  still enforced. `.env` reads are blocked by the A2 `protect-secrets` hook —
  expected; use `.env.example` for shape.
- `new-project.mjs` pristine stamp makes one extra best-effort GitHub commit on
  the generated repo — untested against live GitHub API; smoke on next /new-project.

## Senior-review outcome (post-push, resolved/scheduled this session)
Two findings on `a61d3d7..HEAD` (reviewer ran a live Chromium render, not just static read):
- **[High, conf 95] FIXED (`46766c7`):** the new `components/ui/button.tsx` showed
  native `<button>` UA chrome (outset black border, `appearance:auto`) because Preflight is OFF
  during the AntD coexistence slice and the cva base had no reset. It's the button
  `EmptyState` (and `/scaffold-entity`'s generated empty-list page) renders — every fork's first
  screen. Fixed by adding `appearance-none` to the cva base. **Deterministic CSS fix; visual
  re-confirm is routed to the next `/design-qa` (the C3 per-screen exit gate) — not live-verified
  this session (style-guide is auth-gated).** LESSON: every native-element `components/ui/*`
  primitive must carry its own reset until C4 enables Preflight.
- **[Medium, conf 84] SCHEDULED:** pristine-flag *clearing* in `new-project.mjs`/`deploy.mjs` is
  best-effort (warn-only, no retry/ack) → a fork could keep `pristine:true` and ship green with no
  domain models. Logged to findings-register, adjudicated → scheduled into **Workstream B item 4**
  (which reopens those scripts anyway). Narrow risk; `/ship` stays green (status ≠ open).
- Discarded (conf 60): `npm run scan`/`lhci` use `npx <pkg>@latest` (unpinned) — optional ad-hoc
  dev tools, not in any gate; needs an operator ruling to promote.

## In flight / NEXT (parallelizable now, per operator directive 2)
- **C2 follow-up (long pole):** the hard shared primitives — DataTable/DataView on
  shadcn Table + TanStack (sorting/pagination/column-controls/bulk parity), Chart
  on Tremor-over-recharts, form-field (react-hook-form + zodResolver), modal/overlay
  (Radix), + remaining PageHeader/Skeletons/ConfirmAction/BrandedStatus. Add deps:
  @tanstack/react-table, @radix-ui/*, react-hook-form, @hookform/resolvers, @tremor/react.
  Decide semantic shadcn token layer (`bg-background`/`card`/`muted`) vs the default
  palette used in the slice — coordinate with C1's `tokens.css` + its lockstep test.
- **C3** screen sweep (gated per-screen by `/design-qa`), then **C4** (drop AntD +
  CSP `'unsafe-inline'` style exception, retarget `no-raw-hex-color`, rewrite recipes).
- **Workstream B item 4** (not done): `/quickstart`/`/new-project`/`/handoff` produce/
  verify the image; HANDOFF.md documents `make docker-up`.
- **A1** deterministic gates (knip/jscpd/coverage/size-limit/jsx-a11y/complexity) and
  **A5** testing/design depth — still gated on C landing. **A2 is now complete.**
- **skill auto-activation** (`skill-rules.json` → settings.json hook) — Ask-before.

## OPERATOR DIRECTIVES for the next session (binding — carry forward)
1. **FIRST: show the operator the GRAND PROGRESS TABLE** before any work — all 22
   categories + 5 directives + workstreams (Phase0/C1–C4/B/E/D/A1–A5), each row:
   item → status ([x]/[~]/[ ]) → commit/date. Build it from
   `docs/deep-comparison/ADOPT.md` + the program blueprint + this file.
2. **Maximize parallel sessions** — spawn as many worktree agents as dependencies
   allow. LESSONS: verify each worktree's base branch (merge the session branch
   first); remove ALL worktrees before `/ship`; agents must not edit ADOPT.md/
   agent-memory/SESSION-HANDOFF (integrator owns those); integrate via cherry-pick
   → `npm ci` → one `/ship` → one push.

## Merge-to-main
Merge to `main` when the operator wants forks to inherit (minus this file).
