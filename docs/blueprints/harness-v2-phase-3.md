# Blueprint — HARNESS-V2 Phase 3: "Shrink the decision space"

Scope: CLAUDE.md, .claude/rules/design.md, .claude/rules/harness.md, .claude/skills/adopt/**, .claude/skills/design-qa/**, eslint-rules/**, components/shared/PageShell.tsx, components/shared/StatGrid.tsx, components/shared/FormLayout.tsx, components/shared/BrandedStatus.tsx, components/layout/**, app/\*\*/style-guide/\*\*, messages/**, scripts/capture-screens.mjs, scripts/copy-check.mjs, scripts/ship.mjs, project.config.json, docs/design-references.md, docs/design-recipes.md, docs/oss-catalog.md, docs/verification/**, docs/build-vs-buy-ledger.md, docs/findings-register.md, docs/HARNESS-V2-EVIDENCE.md, docs/blueprints/harness-v2-phase-3.md, tests/eslint-rules/**, tests/harness/**, package.json

Track: **Full** · Program: harness-v2 · Phase: 3 of 5 · Branch `claude/harness-v2-kickoff-yhid26`

Feature parity: n/a — this is the PROGRAM blueprint for a harness phase, not a product feature; it names capability items (V2-301…309), not a benchmark matrix.

## Problem & outcome

Phases 0–2 made the gates trustworthy, every session cheap, and the build loop
complete. Phase 3 attacks the remaining variance: the space of _defensible-but-
different_ decisions an agent makes on look, copy, and build-vs-buy. Left open,
that space produces drift — off-scale spacing, Title-Case-here / sentence-case-
there copy, a hand-rolled capability that an OSS library already solves. Phase 3
**shrinks the decision space** into scales + gates + catalogs so the default path
is the considered one:

- **Look** — a visual-iteration loop that forces capture-then-view (V2-301), taste
  anchors + a scored rubric (V2-307), a composed layout-primitive layer (V2-302),
  named page archetypes (V2-303), and a spacing/type lint that pulls arbitrary
  Tailwind values onto the scale (V2-304).
- **Copy** — a chokepoint (every UI string through next-intl) + a copy-lint gate on
  the source-locale messages (V2-305).
- **Build-vs-buy** — an OSS catalog + `/adopt` skill wiring catalog-lookup as step 0
  of the scan (V2-306), and the build-vs-buy gate extended to the `components/shared`
  and `scripts` surfaces, requiring a `Considered:` line (V2-309). Visual regression
  (V2-308) guards the look against silent pixel drift.

Outcome: a new screen, a new string, and a new capability each have a **default that
is already on-scale, on-voice, and reuse-first** — the agent chooses within a shrunk,
gated space, not a blank one.

## Market scan

Concepts adopted, built native per ADR-022 unless a dependency earns its place
(recorded per-item in `docs/build-vs-buy-ledger.md`): design-token linting (Tailwind
arbitrary-value plugins — evaluated, too blunt, built scoped local rules), i18n
literal-string linting (eslint-plugin-i18next — evaluated, built scoped local rule),
sentence-case/house-style copy checks (Vale/alex — heavier prose linters; built a
deterministic messages-JSON checker), visual regression (Lost Pixel / Argos CE —
V2-308, a real dependency), OSS capability catalogs (the feature-oracle products:
Plane/Twenty/Documenso/Formbricks/Cal.com — V2-306). Taste anchors: Linear / Vercel /
Stripe (operator-chosen), annotated in `docs/design-references.md`.

## Tier

`personal` (matches `project.config.json`). Phase 3 adds rules/gates/skills/docs — it
does not touch the security floor. `shared`-only enforcement stays warn-on-`personal`
per the tier contract.

## Stories

- **US3.1 (operator):** As the operator, I want any screen I build to be captured and
  self-critiqued against a scored rubric before it's called done, so "looks good" is a
  claim from pixels, not code. (V2-301, V2-307)
- **US3.2 (agent):** As the agent, I want a composed layout-primitive layer + named page
  archetypes so I assemble a screen from vetted parts on the token scale, not hand-rolled
  grids. (V2-302, V2-303)
- **US3.3 (agent):** As the agent, I want arbitrary off-scale spacing/font-size in a
  className flagged at lint time, so type/space rhythm can't drift back to ad-hoc pixels.
  (V2-304)
- **US3.4 (operator):** As the operator, I want every user-facing string forced through
  next-intl and the source-locale copy held to a house style (sentence case, no trailing
  period on labels, house terminology), so the product's voice is consistent and
  translatable. (V2-305)
- **US3.5 (agent):** As the agent, I want an OSS catalog + `/adopt` skill as step 0 of the
  build-vs-buy scan, and the gate extended to `components/shared/**` + `scripts/**`
  requiring a `Considered:` line, so reuse is the default and every new capability names
  what it weighed. (V2-306, V2-309)
- **US3.6 (operator):** As the operator, I want a visual-regression baseline so a stray
  pixel shift produces a red diff at QA time, not a silent regression. (V2-308)

## Scenarios (happy / worst per gate item)

- **Spacing/type lint (V2-304).** Happy: `p-2 text-h4`, `grid-cols-[1fr_auto]`,
  `min-h-[44px]`, `text-[var(--brand)]` all pass. Worst: `p-[13px]`, `text-[15px]` →
  lint error; every off-scale hit in a class string is reported in one pass.
- **Copy lint (V2-305).** Happy: `"Back home"`, `"Search..."`, `"Entity ID"`,
  `"Sign in with Microsoft"` pass; a placeholder routed through `t()` passes. Worst: a
  literal `<button>Save</button>` fails the JSX-literal rule; `"Submit Request."` fails
  the copy check (trailing period + Title Case).
- **Visual loop (V2-301).** Happy: a built screen has a committed capture set + critique
  under `docs/verification/<feature>/`. Worst: affirming a screen with no attached
  captures is invalid.
- **Build-vs-buy (V2-306/309).** Happy: a new `components/shared/*` primitive with a
  ledger `Scope:` + `Considered:` line is allowed. Worst: the same file with no
  `Considered:` line fails the gate.

## Architecture

- **Look layer.** `.claude/rules/design.md` §Visual-iteration-loop (binding) +
  `scripts/capture-screens.mjs` (login → screenshot matrix → `docs/verification/`);
  `docs/design-references.md` (anchors + 10-point rubric); `components/shared/{PageShell,
StatGrid,FormLayout}.tsx` (compose-first primitives) + `docs/design-recipes.md` §1c/§1d;
  `eslint-rules/rules/no-arbitrary-className.mjs` (spacing/type lint).
- **Copy layer.** `eslint-rules/rules/no-literal-jsx-text.mjs` (the chokepoint — literal
  JSX text + user-facing attrs → next-intl) + `scripts/copy-check.mjs` (the house-style
  gate on `messages/*.json`), wired as the `/ship` phase-A `copy` gate. Config/waivers in
  `project.config.json` `copy`.
- **Build-vs-buy layer.** `docs/oss-catalog.md` + `.claude/skills/adopt/**`; the
  `build-vs-buy-gate.mjs` surface extended to `components/shared/**` + `scripts/**` with a
  required `Considered:` line (V2-309). Visual regression (V2-308) over the capture set,
  wired to `/qa`/`uat:full` (not warm `/ship`).
- **Enforcement seam.** New ESLint rules live in the existing local plugin
  (`eslint-rules/index.mjs`, `eslint.config.mjs`), RuleTester-covered in
  `tests/eslint-rules/`; new `/ship` gates are pure sync scanners in `scripts/ship.mjs`
  with negative-test coverage in `tests/harness/`.

## Open questions

- V2-306 `/adopt` end-to-end demo target (which real capability to adopt on the pilot).
- V2-308 tool choice (Lost Pixel vs Argos CE) + where the baseline lives so it doesn't
  bloat the repo.
- Whether the copy-lint terminology map should grow a fuller house glossary (currently a
  tiny safe default + per-fork extension).
