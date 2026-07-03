# Session handoff — 2026-07-03 (session 3: C2 primitive layer + skill hook + B item 4)

## Goal
Replatform-and-adoption program per the signed contract
`docs/blueprints/2026-07-replatform-and-adoption-program.md`. This session:
grand table delivered first, then the **C2 long-pole primitive layer**, the
**A4 skill-activation hook** (Ask-before, operator-confirmed), and **Workstream
B item 4** integrated, `/ship` green, pushed.

## State
Branch `claude/ui-layer-signoff-replatform-onjlrr` at HEAD after integration,
pushed, tree clean. **`/ship` GREEN end-to-end (12 phases, ~46s).** Not deployed.
Base for this session was `7e9a100`.

## Done this session (all in one green /ship, one push)
1. **C2 follow-up — the primitive long pole** (`7af269f`,`836c17c`,`cbe080a`,
   `194637c`; built by a worktree agent, cherry-picked in). Decision made
   (delegated by operator): **semantic shadcn token layer (Option B)** — added
   `--color-background/foreground/card/muted/border/input/ring/primary/destructive`
   etc. to the `@theme` block in `app/tokens.css` mapped to the existing scale +
   brand vars, dark mode via a single `[data-theme="dark"]` variable swap in
   `globals.css` (not per-class `dark:` pairs). Lockstep test extended, green.
   - New shadcn ui primitives: `components/ui/{table,dialog,popover,skeleton,input,label,form}.tsx`.
   - Rebuilt shared primitives on shadcn/Tailwind/Radix, **same prop APIs**:
     `DataTable`/`DataView` (shadcn Table + **@tanstack/react-table**: sort ✓,
     pagination ✓, column controls ✓, row-select+bulk ✓ — AntD Table parity),
     `PageHeader`, `Skeletons`, `ConfirmAction`, `BrandedStatus`; new `Modal`,
     `FormField` (**react-hook-form + @hookform/resolvers** zodResolver).
   - Refactored the 5 already-shipped primitives + button/badge onto semantic tokens.
   - Deps: `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`,
     `@radix-ui/react-dialog`, `@radix-ui/react-popover`.
   - **Tremor DEFERRED** — `@tremor/react@3.18.7` has a hard `react@^18` peer;
     fails clean install on React 19 / Next 16. NOT forced. `Chart` stays on
     recharts directly with a Tremor-style API; re-logged in ADOPT.md deferred
     list (trigger: Tremor peer accepts React 19).
2. **A4 skill auto-activation hook** (`804f331`, Ask-before → operator-confirmed
   7 defaults). `.claude/hooks/skill-activation.mjs` consumes `skill-rules.json`
   on **UserPromptSubmit** (prompt → `keywords`) + **PreToolUse Edit|Write|MultiEdit**
   (file → `paths` globs); advisory `additionalContext` only, **never blocks**,
   fires on every match, suggests all matches. Wired in committed `settings.json`.
   Docstrings in `skill-rules.json` + `.claude/README.md` updated (no longer
   "no hook consumes it yet").
3. **Workstream B item 4** (`4065f1a`). `/handoff` HANDOFF.md now documents
   `make docker-up` (app+Postgres) as the recommended IT run path + a step 1c
   that builds/verifies the image before packaging; `/quickstart` notes the fast
   loop stays image-free by design but Docker is a standard artifact to verify
   once; `/new-project` gains a verify-image step (Vercel+Neon stays deploy default).
4. **ADOPT.md** (`<this push>`): skill auto-activation `[x]`; Tremor deferral re-logged.

## LESSONS (worked / bit us this session — carry forward)
- **Worktree base bug (bit us twice):** the harness `isolation:'worktree'` agents
  were based on `032f643` (stale/other branch), NOT session HEAD `7e9a100`. The
  C2 agent recovered by fast-forwarding its own branch to session HEAD (stayed on
  its branch); the B-item-4 agent correctly REFUSED rather than fabricate against
  the wrong base. **Next time: tell each worktree agent to verify its base is a
  descendant of session HEAD as step 0, and FF if it's a clean ancestor.** Integrate
  coupled work (shared package.json/tokens.css) as ONE agent, not parallel worktrees.
- **Integration that worked:** cherry-pick the agent's commits → `git worktree
  remove --force` ALL worktrees → `npm ci` (NOT install) → one `/ship` → one push.
  Discard stray SessionStart-hook edits to package.json/lock/REPO-MAP with
  `git restore` before cherry-picking the deps commit (they block it).
- `AskUserQuestion` failed once then WORKED on retry this session — worth one retry
  before falling back to plain-text decisions.
- gitleaks missing again (fresh container). GitHub release downloads are
  proxy-BLOCKED (only the in-scope repo is enabled) — the release-binary recipe in
  agent-memory no longer works here. Use `GOBIN=~/.local/bin GOSUMDB=off go install
  github.com/zricethezav/gitleaks/v8@v8.21.2` (proxy.golang.org is allowed; note the
  module path is still `zricethezav`, not `gitleaks/gitleaks`, at v8.21.2).
- The react-hooks eslint fix (`1d2d912`) held — lint green, don't re-diagnose.

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
- **C3 — screen migration** is now UNBLOCKED (C2 primitives complete). Sweep
  `app/[locale]/**` screen by screen: DashboardContent, AuditLogClient, profile,
  entity CRUD, settings/RBAC, auth, recycling bin still use AntD `Table`/`Form`/
  `Descriptions` DIRECTLY. Forms → react-hook-form + zodResolver (FormField ready).
  Run `/design-qa` per screen; axe-clean serious/critical is the per-screen exit bar.
- **C4** — after C3: retarget `no-raw-hex-color` to the `@theme` block, drop `antd`
  deps + the type-only AntD imports still in DataTable/DataView/ConfirmAction, drop
  the CSP `'unsafe-inline'` style exception, rewrite `docs/design-recipes.md`.
- **A1** deterministic gates (knip/jscpd/coverage/size-limit/jsx-a11y/complexity)
  and **A5** testing/design depth are now UNBLOCKED once C3/C4 land (they target the
  post-replatform tree). A2 + A4 are complete.
- **Workstream D** verify pass (0.5 session): fresh default fork shows zero RTL/ar
  surface; flipping `["en","ar"]` restores it.

## OPERATOR DIRECTIVES for the next session (binding — carry forward verbatim)
1. **FIRST: show the operator the GRAND PROGRESS TABLE** before any work — all 22
   categories + 5 directives + workstreams (Phase0/C1–C4/B/E/D/A1–A5), each row:
   item → status ([x]/[~]/[ ]) → commit/date. Build it from
   `docs/deep-comparison/ADOPT.md` + the program blueprint + this file.
2. **Maximize parallel sessions** — spawn as many worktree agents as dependencies
   allow. LESSONS: verify each worktree's base is a descendant of session HEAD
   (FF if it's a clean ancestor); remove ALL worktrees before `/ship`; agents must
   NOT edit ADOPT.md/agent-memory/SESSION-HANDOFF (integrator owns those); integrate
   via cherry-pick → `npm ci` → one `/ship` → one push. Keep coupled work (shared
   deps/token files) in ONE agent to avoid worktree conflicts.

## Merge-to-main
Merge to `main` when the operator wants forks to inherit (minus this file).
