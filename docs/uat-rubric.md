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
(the app's master data) · **Design handoff** (`design/*` mockups + `tokens.css` / the
AntD theme). No anchor → it's an opinion; flag it as a *judgment call* for the
operator, don't bury it as a finding.

---

## Tier 0 — Design direction (generation-time; before code is written)
The gate below *catches* slop; this section *prevents* it. Before building a new
screen or surface, the agent declares a **one-line design read** in the response
(not a file): *"Building \<surface\> for \<audience\>; tone \<calm | dense-data |
form-heavy | …\>; density \<default | compact\>; accent = `colorPrimary`."* Then
commit to it — consistency comes from the declared system, not restraint in the
moment.

**The ruler:** `app/tokens.css` (spacing/type/density/radius scale) +
`components/layout/antd-theme.ts` (the AntD side; lockstep-tested). Spacing comes
off the 4px scale or a `--density-*` semantic; type comes off the type scale —
ad-hoc values are Tier-1 findings.

**Anti-slop defaults** — the recognizable AI tells, banned unless the brief
explicitly asks (each is a Tier-1 finding citing this section as anchor):
- **One accent per app** — `colorPrimary` is the accent; no per-screen hues, no
  purple→blue gradient panels, no glow shadows.
- **One primary action per screen** — a single `type="primary"` button; five
  equal blue buttons is a hierarchy fail.
- **No nested Cards** (Card inside Card) — group with spacing, `Divider`, or
  plain sections instead of stacking chrome.
- **No emoji as icons** — `@ant-design/icons` only; one icon family, one weight.
- **No label/eyebrow spam** — not every heading needs a small uppercase label;
  the page position already categorizes a section.
- **No gray-on-colored text** — copy passes WCAG AA against its actual background.
- **Honest demo data** — no fake-precise numbers (`94.2%`, `4.8×`) in seeds or
  empty-state copy unless real or marked as sample.
- **No dead chrome** — every control does something; no decorative buttons,
  no filler sections to make a screen look "designed."
- **Density picked once** — `default` or `compact` (AntD algorithm/`size`) per
  app, not per screen.

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
