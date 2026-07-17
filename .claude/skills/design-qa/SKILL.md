---
name: design-qa
description: Design-fidelity QA (Tier 1 of the QA system). Drives Chromium (Playwright) to screenshot every screen AND every component state (hover/focus/disabled/loading/empty/error), runs axe for accessibility, and diffs the result against the design source of truth (design/* mockups + tokens.css / the AntD theme). Scores each screen 0-5 on the design-QA heuristics in docs/uat-rubric.md and reports cited, severity-ranked deviations -- per-component first, then per-screen. Use BEFORE functional QA. Trigger phrases: "design qa", "design review", "fidelity check", "does it match the design", "/design-qa", "ui audit", "accessibility audit", "a11y check", "visual regression".
---

# /design-qa — design fidelity, before functional QA

Tier 1 of the QA system (see `docs/uat-rubric.md`). Answers **"does it match the
intended design?"** — _not_ "does it work" (that's `/ship` / functional QA) and _not_
"does it meet the business need" (that's `/uat`). Runs and **reports**; it doesn't
change app code. Owned by the front-end (the agent); it gates the next tier.

> This is the **reactive** half. The **proactive** half is `/design-system` +
> `docs/design-recipes.md` — build to the recipes up front and most of what this
> tier would flag never gets written. If you're seeing many findings here, the fix
> is to start from `/design-system`, not to keep re-auditing.

## During-build mode (V2-301 — the visual iteration loop)

Between "build the screen" and "run the full gated `/design-qa`" there is a **mandatory,
lightweight self-check on the screen you just touched** — you must **look at the pixels**, not
just the code:

1. `npm run capture -- --feature <feature> --routes <p1,p2>` (harness `scripts/capture-screens.mjs`)
   — desktop + mobile × light + dark × every enabled locale, into `docs/verification/<feature>/`.
   Bring an app up locally first (agent-memory "browser QA & egress" native-Postgres recipe) or
   `--base` a deployed URL.
2. **Read the captured images** and score them against the 10-point rubric (V2-307).
3. **Fix + re-capture**; keep the before/after + notes under `docs/verification/<feature>/`.
4. **Affirming a screen without attached captures is invalid** (V2-301) — "looks good" is a claim
   about pixels, provable only by pixels. Worked example: `docs/verification/asset-tracker/`.

This during-build loop is fast (no axe/bridge); the FULL `/design-qa` below (Chromium states, axe,
scored deviations) still runs at QA time. The rule is in `.claude/rules/design.md`.

## Visual regression against a baseline (V2-308)

Once a feature's look is signed off, its captures become a **committed baseline** and the diff runs
at QA time to catch silent pixel drift (a stray 4px misalignment, a token/spacing regression) that
the eyeball pass on a later change might miss:

1. **Establish the baseline** — after sign-off, copy the accepted set into
   `docs/verification/<feature>/baseline/` and commit it (see
   `docs/verification/v2-305-copy/baseline/` for a worked example).
2. **Diff at QA time** — re-capture, then
   `npm run visual-regression -- --baseline docs/verification/<feature>/baseline --current docs/verification/<feature>`.
   A per-image pixel diff beyond the tolerance (default: an absolute 100 differing pixels — resolution-
   independent, catches a real element shift where a % ratio wouldn't — or any dimension change) exits
   non-zero and writes a `*.diff.png` for review — a red diff, not a silent regression.

This runs at **QA time (`/design-qa` / `npm run uat:full`), never in the warm `/ship` loop** — a pixel
diff needs a running app + a fresh capture, which the fast pre-push gate doesn't do. Built on
`pixelmatch` + `pngjs` (`scripts/visual-regression.mjs`); when a diff is an intended redesign, refresh
the baseline in the same change.

## Taste anchors + scored verdict (V2-307)

The verdict is a **numeric 10-point rubric** (grid · hierarchy · one-primary-action · state honesty
· spacing · copy · RTL · dark · responsive · a11y), defined with pass/fail rows in
**`docs/design-references.md`** — which also holds the **taste anchors** (Linear/Vercel/Stripe per
archetype, + the operator's own). Every scored deduction **cites an anchor + a V2-301 capture**
("hierarchy reads flat vs Linear's title/meta split", not "hierarchy could be better"); a finding
with no anchor is a judgment call for the operator, not a deduction. Score → verdict: 10 = ship ·
8–9 = ship + file the nits · ≤7 = red gate. The worked first run (Asset Tracker list) is in
`design-references.md`.

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

> **Web session? Start the browser-egress bridge first.** In a Claude Code web session
> the TLS-MITM egress proxy resets Chromium's ClientHello (`ERR_CONNECTION_RESET`), so
> neither the committed specs nor the Playwright MCP can reach any real site. Run
> `make browser-up` once, then `eval "$(node scripts/browser-bridge.mjs env)"` (the specs
> pick up `PW_PROXY_SERVER`/`PW_EXECUTABLE_PATH`; the MCP servers route through the bridge
> automatically once it's up). Off-platform it's a no-op. See
> `docs/runbooks/browser-egress-in-web-sessions.md`. This is what makes the axe pass run
> against a deployed target instead of failing on every navigation.

4. **Run axe** on each screen (`@axe-core/playwright`); record serious/critical
   violations (unlabeled inputs, contrast, focus order, keyboard traps).
5. **Diff against the design source** — spacing on the token scale? palette colors?
   typography? Compare each screen to its `design/*` mockup. **Baseline = the mockups**
   on the first pass; thereafter the screenshots are the **visual-regression** baseline,
   so unintended drift is caught on every run.
6. **EYEBALL every screenshot — mandatory, never skip.** axe + load checks catch
   crashes + a11y; they are **blind** to _duplicated widgets, a wrong field label, a
   broken layout, a cramped/empty screen, two stacked AI panels._ So **open each
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

## Do not skip this because…

| Rationalization                                                  | Rebuttal                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "axe passed and every route loaded — that's the screen covered." | axe + load checks are **blind** to duplicated widgets, wrong labels, broken layout, two stacked panels (step 6's lesson: a run said "all pass" while the dashboard rendered twice). If you didn't look at the pixels, you didn't do design QA. |
| "It's a prototype — stakeholders won't mind rough UI."           | The shared URL _is_ the product for this audience; a sloppy screen is what a non-developer stakeholder judges. The Tier-0 anti-slop pass exists precisely for prototype-speed output.                                                          |
| "Time pressure — skip the component states, screens are enough." | A broken disabled/empty/error state caught per-component is caught **once**; caught per-screen it's twelve findings later, at higher cost. The per-component pass is the shortcut, not the detour.                                             |
| "The change didn't touch UI files, so tier 1 is moot."           | Shared layout/theme/token changes invalidate every screen without touching a page file. Check what the diff _imports into_, then scope — "moot" is a conclusion the diff has to earn.                                                          |
| "Dark/RTL/mobile are edge cases for this audience."              | They're rubric columns, not extras: `dir="rtl"` mirroring and dark hold are one screenshot each, and the `ar` locale is a first-class deploy target for this template's users.                                                                 |
| "The browser wouldn't launch — mark it green and move on."       | "Could not run" is a **blocked** run, never a pass — that's a named boundary below. Fix the env (creds/DB/seed) or report the block.                                                                                                           |

## Token-thrift (ADR-019)

The captures are committed specs that screenshot to files — but the **ad-hoc MCP
"look at this one screen"** exploration is the token sink. When driving the Playwright
MCP live, prefer **scoped `browser_snapshot` reads + `ref`-based interactions** over
full-page accessibility-tree dumps, **screenshot to a file** (never inline giant
base64 — the screenshots ARE the design-QA evidence), scope axe/assertions to the
**one component or region** under review rather than dumping the whole DOM, and **cap
console/network reads**. The per-component pass keeps this cheap: capture the state,
save the shot, move on.

## Honest boundaries

- Design QA is fidelity, **not** correctness (`/ship`) or acceptance (`/uat`).
- ~80% of "good UI" is measurable here; the residual _taste_ is anchored to named
  **benchmarks** and flagged as judgment calls — the agent does the exhaustive
  evidence pass; the operator adjudicates the close ones.
- Don't call a run green if the browser/creds couldn't launch — that's "could not run."
- Visual-regression needs a baseline: greenfield uses the mockups; never silently
  accept drift as the new baseline without the operator's nod.
