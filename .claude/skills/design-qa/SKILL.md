---
name: design-qa
description: Design-fidelity QA (Tier 1 of the QA system). Drives Chromium (Playwright) to screenshot every screen AND every component state (hover/focus/disabled/loading/empty/error), runs axe for accessibility, and diffs the result against the design source of truth (design/* mockups + tokens.css / the AntD theme). Scores each screen 0-5 on the design-QA heuristics in docs/uat-rubric.md and reports cited, severity-ranked deviations -- per-component first, then per-screen. Use BEFORE functional QA. Trigger phrases: "design qa", "design review", "fidelity check", "does it match the design", "/design-qa", "ui audit", "accessibility audit", "a11y check", "visual regression".
---

# /design-qa — design fidelity, before functional QA

Tier 1 of the QA system (see `docs/uat-rubric.md`). Answers **"does it match the
intended design?"** — *not* "does it work" (that's `/ship` / functional QA) and *not*
"does it meet the business need" (that's `/uat`). Runs and **reports**; it doesn't
change app code. Owned by the front-end (the agent); it gates the next tier.

**Every finding cites a pillar + an anchor** (`docs/uat-rubric.md`) — design-token
violation, axe rule, or "Greenhouse does X here and we don't." No anchor → mark it a
**judgment call** for the operator, don't bury it as a finding.

## What it checks (per the rubric's Tier-1 heuristics)
Score each screen **0–5** on: spacing & rhythm · alignment & grid · visual hierarchy
· color & token adherence · density & whitespace · **state coverage**
(hover/focus/disabled/loading/empty/error) · consistency · responsive + RTL + dark ·
**a11y (axe)**. The rubric table defines what "5" vs "fail" looks like for each.
Plus the rubric's **Tier-0 anti-slop defaults** (defined in `docs/uat-rubric.md` →
**Tier-0**, where each tell is caught) — each tell found is a finding citing
`docs/uat-rubric.md` Tier-0 as its anchor.

## Method — per-component first, then per-screen
1. **Discover the surface** (app-agnostic, never hardcoded): reuse `/uat`'s
   `tests/uat/_discover.ts` (`discoverAllScreens()`) for routes; for a foreign/deployed
   target, DOM-crawl the nav. Discover the design source: `design/**/*` mockups +
   `app/globals.css` / `tokens.css` + the AntD theme tokens.
2. **Per component** — enumerate the surface from two sources so coverage is complete:
   the shared primitives in `components/shared/*` **plus** the per-entity components
   (`components/**/<Entity>*`). Render **each one** in **all six states**
   (hover/focus/disabled/loading/empty/error) and screenshot every state. A component
   missing a state is itself a finding. Catching a broken variant once is cheaper than
   catching it on twelve screens.
3. **Per screen** — drive Playwright,
   screenshot each route at desktop + a mobile breakpoint, in **light and dark**, and
   with `ar` (RTL) to confirm `dir="rtl"` mirrors.

> **Canonical Playwright workflow.** Author the design-QA captures as specs under
> `tests/uat/` (e.g. `design.uat.ts`), **reusing `/uat`'s `auth.setup.ts`** so the same
> `UAT_EMAIL`/`UAT_PASSWORD` env creds and saved storage state log you in — never a
> separate auth path. This is the one pattern: committed specs over the `/uat` backbone.
> The Playwright **MCP** is for ad-hoc "look at this one screen with me now" exploration
> only — keep the repeatable captures in `tests/uat/`.
4. **Run axe** on each screen (`@axe-core/playwright`); record serious/critical
   violations (unlabeled inputs, contrast, focus order, keyboard traps).
5. **Diff against the design source** — spacing on the token scale? palette colors?
   typography? Compare each screen to its `design/*` mockup. **Baseline = the mockups**
   on the first pass; thereafter the screenshots are the **visual-regression** baseline,
   so unintended drift is caught on every run.
6. **EYEBALL every screenshot — mandatory, never skip.** axe + load checks catch
   crashes + a11y; they are **blind** to *duplicated widgets, a wrong field label, a
   broken layout, a cramped/empty screen, two stacked AI panels.* So **open each
   screenshot and actually look at it** against the heuristics + the mockup. (Lesson:
   a run once reported "all screens pass" while the dashboard showed its KPI strip and
   funnel twice — only the visual pass caught it.) If you didn't look at the pixels,
   you didn't do design QA. While looking, sweep for the rubric's **Tier-0 slop
   tells**: off-accent hues / gradient panels, more than one primary button, nested
   Cards, emoji-as-icons, eyebrow-label spam, gray-on-colored text, fake-precise
   demo numbers, dead controls, density flipping between screens.
7. **Score + report** — emit one **scorecard per screen** (rubric template): the 0–5s,
   the cited deviations ranked by severity, the axe violations, and the benchmark shot
   next to ours where look-and-feel is contested.

## Gate
**Entry:** the build is green. **Exit:** no fidelity or a11y **criticals** (serious axe
violations, broken states, off-design primitives). A red gate **stops the line** and
reports — functional QA shouldn't test flows on a visually-broken screen.

## Honest boundaries
- Design QA is fidelity, **not** correctness (`/ship`) or acceptance (`/uat`).
- ~80% of "good UI" is measurable here; the residual *taste* is anchored to named
  **benchmarks** and flagged as judgment calls — the agent does the exhaustive
  evidence pass; the operator adjudicates the close ones.
- Don't call a run green if the browser/creds couldn't launch — that's "could not run."
- Visual-regression needs a baseline: greenfield uses the mockups; never silently
  accept drift as the new baseline without the operator's nod.
