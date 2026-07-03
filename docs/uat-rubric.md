# QA Rubric — the data-driven quality bar

This is the **single source of truth** for "is it good enough?" across the three QA
tiers. It exists so QA findings are **grounded in evidence, not opinion** — every
finding cites a **pillar** and an **anchor**, never "I think it's dull."

`/qa` (the orchestrator) runs the tiers against this rubric; `/design-qa`,
`/ship` (functional), and `/uat` each own one tier. Use it the same way for *any*
fork — the heuristics are app-agnostic; the benchmark set + acceptance criteria are
per-domain.

---

## The 5 governing pillars (every finding justifies against these)
1. **Speed** — RSC reads, no needless round-trips, debounced inputs, bounded payloads. *(Formerly "Fast".)*
2. **Secure** — auth wrappers + zod on every route; Restricted data gated; audit on; no secret/PII leakage.
3. **Maintainable** — reuses existing primitives/services; typed; no dead code; small, forward-compatible migrations.
4. **Scalable** — handles growth (bulk paths not N×1; pagination; rate-limit-aware; no N+1).
5. **High-Quality** — the polish pillar a finding cites when it isn't one of the four above: correctness + UX fidelity, automated gates (CI / pre-push / axe / coverage), honest empty/loading/error states, and no deprecation drift.

## The anchors (a finding cites at least one)
**Objectives** (what this screen/feature is for) · **Scope** (in/out of bounds) ·
**Benchmark** (how a named peer product does this exact thing) · **Knowledge Base**
(the app's master data) · **Design handoff** (`design/*` mockups + `tokens.css` — the
`@theme` tokens + the `[data-theme]` dark swap). No anchor → it's an opinion; flag it as a *judgment call* for the
operator, don't bury it as a finding.

---

## Tier 0 — Design direction (generation-time; before code is written)
The gate below *catches* slop; this section *prevents* it. Before building a new
screen or surface, the agent declares a **one-line design read** in the response
(not a file): *"Building \<surface\> for \<audience\>; tone \<calm | dense-data |
form-heavy | …\>; density \<default | compact\>; accent = `bg-primary` (`brand.primary`)."* Then
commit to it — consistency comes from the declared system, not restraint in the
moment. **This is a required step, not optional** — `/blueprint` and
`/design-system` both enforce it. Build from the vetted patterns in
`docs/design-recipes.md` (the proactive recipes) on the shipped
`components/shared/*` primitives; improvising the layout is what produces the
findings the tiers below then have to catch.

**The ruler:** `app/tokens.css` (spacing/type/density/radius scale + the semantic
surface colors, exposed as Tailwind utilities via `@theme`; dark-swapped in
`app/globals.css`). Spacing comes off the 4px scale or a `--density-*` semantic; type
comes off the type scale — ad-hoc values are Tier-1 findings.

**Anti-slop defaults** — the recognizable AI tells, banned unless the brief
explicitly asks (each is a Tier-1 finding citing this section as anchor):
- **One accent per app** — `bg-primary` is the accent; no per-screen hues, no
  purple→blue gradient panels, no glow shadows.
- **One primary action per screen** — a single default-variant `<Button>`; five
  equal blue buttons is a hierarchy fail.
- **No nested Cards** (Card inside Card) — group with spacing, a `Separator`, or
  plain sections instead of stacking chrome.
- **No emoji as icons** — `lucide-react` only; one icon family, one weight.
- **No label/eyebrow spam** — not every heading needs a small uppercase label;
  the page position already categorizes a section.
- **No gray-on-colored text** — copy passes WCAG AA against its actual background.
- **Honest demo data** — no fake-precise numbers (`94.2%`, `4.8×`) in seeds or
  empty-state copy unless real or marked as sample.
- **No dead chrome** — every control does something; no decorative buttons,
  no filler sections to make a screen look "designed."
- **Density picked once** — `default` or `compact` (the `--density-*` semantics /
  a component's `size` prop) per app, not per screen.

## Tier 1 — Design QA (fidelity): does it match the intended design?
Owner: front-end (the agent). Gate: **before** functional QA. Tool: `/design-qa`.
Per-**component** first (catch a broken variant once), then per-**screen**.

Score each screen **0–5** on these heuristics (cite the anchor):
| Heuristic | What "5" looks like | Common "fail" |
|---|---|---|
| **Spacing & rhythm** | gaps on the token scale (4/8px, `--density-*`) | ad-hoc margins; cramped or huge dead space |
| **Alignment & grid** | a consistent column grid | fields floating at random widths |
| **Visual hierarchy** | eye lands on the one primary action first | five equal blue buttons |
| **Color & token adherence** | palette colors only; contrast ≥ WCAG AA | off-palette hues; low contrast |
| **Density & whitespace** | balanced content-to-chrome | sparse/cramped |
| **State coverage** | hover / focus / disabled / **loading** / **empty** / **error** all designed | blank shell; spinner-forever; raw error |
| **Consistency** | same card/chip/badge/empty-state everywhere | one-off components |
| **Responsive + RTL + dark** | reflows; `dir="rtl"` mirrors; dark tokens hold | breaks at breakpoints; LTR-only |
| **A11y (axe)** | 0 serious/critical violations; labels; focus order; keyboard nav | unlabeled inputs; no focus ring |

**Method:** drive Playwright → screenshot each route **and each component state** →
run **axe** → diff against `tokens.css` + the `design/*` mockups. Baseline =
the mockups on first pass; screenshots become the **visual-regression** baseline
after. **Gate exit:** no fidelity/a11y **criticals**.

### Tier 1a — Slop-gate checklist (explicit, traceable)
The Tier-0 anti-slop defaults above are the *rules*; this is the *gate* — a flat
checklist `/design-qa` traces item-by-item per surface, so "no slop" is provable,
not vibes. Each **unchecked** box that isn't a brief-sanctioned exception is a
Tier-1 finding citing the Tier-0 anchor. (An exception the brief explicitly asks
for is checked with a one-line "brief sanctions: …" note, not silently skipped.)

- [ ] **One accent** — only `bg-primary` as accent; no per-screen hues, gradient panels, or glow shadows.
- [ ] **One primary action per screen** — exactly one default-variant `<Button>`; secondary actions are visually subordinate.
- [ ] **No nested Cards** — grouping via spacing / a `Separator` / plain sections, not Card-in-Card chrome.
- [ ] **Icons from one family** — `lucide-react` only; no emoji-as-icon; one weight.
- [ ] **No label/eyebrow spam** — small uppercase labels used only where position doesn't already categorize.
- [ ] **No gray-on-colored text** — every copy/background pair passes WCAG AA (see manual a11y below).
- [ ] **Honest demo data** — no fake-precise numbers in seeds/empty copy unless real or marked "sample".
- [ ] **No dead chrome** — every control does something; no decorative buttons/filler sections.
- [ ] **Density picked once** — one `default`/`compact` choice app-wide, not per screen.
- [ ] **On-token spacing/type/radius** — values off the 4px scale / `--density-*` / type scale; no ad-hoc px.
- [ ] **Real state triad** — honest empty / loading / error states (no blank shell, spinner-forever, or raw error dump).

### Tier 1b — Manual a11y criteria (WCAG 2.2 AA — what axe cannot see)
axe (Tier 1 row) catches the machine-checkable slice (labels, roles, contrast on
solid backgrounds). It **cannot** verify operability, focus behavior, or intent —
those need a manual keyboard-and-screen pass, driven in `/design-qa` (and
`/manual-uat` for live flows). Each item is pass/fail per surface; a fail on a
**core interactive flow** (auth, forms, tables, modals) is a Tier-1 critical that
stops the gate, same as an axe critical.

- [ ] **Keyboard-only operable** — every action reachable and triggerable with Tab/Shift-Tab/Enter/Space/Esc/arrows; no mouse-only control (WCAG 2.1.1).
- [ ] **Focus order is logical** — Tab order follows reading/DOM order; no jumps into or out of off-screen/hidden content (WCAG 2.4.3).
- [ ] **Focus is always visible** — a clear focus ring on every focusable element (the `--ring` token); never `outline:none` without a replacement (WCAG 2.4.7 / 2.4.11 not-obscured).
- [ ] **No keyboard trap** — focus can always leave a widget/modal; Esc closes overlays and returns focus to the trigger (WCAG 2.1.2).
- [ ] **Modal/drawer focus management** — focus moves into the overlay on open, is contained while open, and restores to the opener on close.
- [ ] **ARIA landmarks present** — one `main`, plus `nav` / `banner` / `contentinfo` as applicable, so screen-reader users can jump regions (WCAG 1.3.1).
- [ ] **Live regions for async feedback** — toasts, inline validation, and async row/status changes announce via `aria-live` (sonner's `useNotify()` toasts do; `FormMessage` renders `role="alert"`); a green toast over a failure is both a slop and an a11y fail.
- [ ] **Accessible names on icon-only controls** — every icon-only button/link has an `aria-label` or visually-hidden text; no naked glyph.
- [ ] **Manual contrast on the hard cases** — text over images/gradients, disabled text, placeholder text, and state colors (success/warning/error) meet AA (4.5:1 body / 3:1 large + UI components 1.4.11); these are the cases axe under-reports.
- [ ] **Reduced-motion honored** — non-essential animation/transition is gated behind `@media (prefers-reduced-motion: reduce)`; nothing auto-animates for a user who opted out (WCAG 2.3.3).
- [ ] **Target size ≥ 24×24 CSS px** — interactive targets meet the WCAG 2.2 minimum (2.5.8), with spacing where they're smaller.
- [ ] **RTL + dark hold under keyboard** — focus ring, order, and landmarks stay correct in `dir="rtl"` (`ar`) and dark mode, not just LTR light.

**Method (manual pass):** unplug the mouse — Tab through each surface; confirm the
ring is visible and order is sane; open/close each modal and check focus in/out;
trigger a validation error and a success and confirm each is announced; toggle OS
reduced-motion + dark + RTL and re-walk one core flow. Cite the WCAG SC on any fail.

## Tier 2 — Functional QA (correctness): does it work, for all the cases?
Owner: dev + QA (the agent). Folds into **`/ship`** + a **risk-based case matrix**.
Gate: design-QA passed → regression green, no open criticals, high-risk covered.

- **Test pyramid:** many `node:test` contract/unit tests → fewer integration → a *thin*
  Playwright E2E top. Heavy-E2E is a smell that the lower layers are missing.
- **Risk-based:** weight effort by *likelihood × business impact*. **Auth, data-integrity,
  Restricted/comp, money/approvals = exhaustive**; a settings toggle = smoke.
- **Case matrix per function** (don't say "works 100%" without enumerating the cases).
  Derive cases from the spec **+ the benchmark's behavior**. Template:

  | Function | Input / case | Expected | Result | Evidence |
  |---|---|---|---|---|
  | CV upload | clean PDF / scanned PDF / .docx / corrupt / 0-byte | parse or graceful error | pass/fail | screenshot / test |

- **Exploratory** alongside scripted: scripted confirms the expected; exploratory finds
  the unscripted. **Gate exit:** regression suite green; no open criticals; high-risk covered.

## Tier 3 — UAT (acceptance): does it meet the business need?
Owner: **the operator** (business). Agent produces the evidence pack; operator accepts.
Tool: **`/uat`** (FULL). Gate: functional-QA passed → acceptance threshold met → go-live.

- **Scenarios derive from acceptance criteria**, with a **traceability matrix**
  (every requirement → ≥1 scenario → pass/fail, so coverage is provable). Template:

  | Req ID | Acceptance criterion | Scenario | Pass/Fail | Defect (sev) |
  |---|---|---|---|---|

- **Prod-like env + realistic seed data** (not dev junk). Real users / delegates run
  scripted scenarios **+ free-form** use.
- **Formal sign-off** is the deliverable: each scenario pass/fail, defects triaged by
  severity, a named owner accepts. **Entry** = functional QA passed; **exit** = acceptance
  threshold met. Don't let UAT slide into a second bug-hunt.

---

## Benchmark set (the "data" behind look-and-feel + journey findings)
Pick the set for the fork's **domain** (infer from entities + schema), web-search how
each does the *same* screen/flow, capture a shot/note, and compare. Don't reinvent a
solved pattern unless there's a breakthrough reason.

- **ATS / recruitment:** Greenhouse, Lever, Ashby, Workday Recruiting, SmartRecruiters.
- **Generic SaaS admin/CRUD:** Linear, Notion, Stripe Dashboard, Retool, Airtable.

(Per-fork: extend `uat-results/benchmark.json` — `/uat` P6 already loads/validates it.)

---

## Release-readiness definition (one bar across all three tiers)
Ship only when **all** hold:
- [ ] **Design QA:** no fidelity/a11y criticals; states covered; on-token.
- [ ] **Functional QA:** `/ship` green; risk-based case matrix passed; high-risk exhaustive.
- [ ] **UAT:** acceptance scenarios traced + passed at threshold; operator sign-off.
- [ ] **4 pillars** upheld; **security floor** intact (auth/zod/audit/no leakage).

## Scorecard template (one per screen / feature; `/qa` collects these)
```
Screen: <name>   Anchors: <objectives|scope|benchmark:<peer>|kb|design>
Design QA   spacing _/5 align _/5 hierarchy _/5 color _/5 density _/5 states _/5 consistency _/5 responsive+rtl+dark _/5 a11y _/5
Functional  matrix: <n> cases, <n> pass; criticals: <n>; high-risk covered: y/n
UAT         reqs traced: <n>/<n>; scenarios pass: <n>/<n>; sign-off: pending/accepted
Findings    [pillar][anchor] severity — description — file:line / screenshot
Verdict     ship / fix-first (list blockers)
```
