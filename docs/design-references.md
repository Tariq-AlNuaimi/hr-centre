# Design references — taste anchors (V2-307)

The exemplar products `/design-qa` scores new screens against. Each **archetype** (V2-303) gets
2–3 anchors + **what to emulate** (not "copy it" — the specific quality to reach for). Operator
picks, 2026-07-17: **Linear / Vercel / Stripe** as the defaults, with a slot per archetype for the
operator's own additions (RSP/aptitude house style — fill the "Operator adds" rows as they land).

> How this is used: the `/design-qa` scored rubric (below) cites an anchor per finding — "hierarchy
> reads flat vs Linear's clear title/meta split" beats "hierarchy could be better". A finding with
> no anchor is a **judgment call** for the operator, not a scored deduction. Captures come from the
> V2-301 loop (`docs/verification/<feature>/`).

## Anchors per archetype

| Archetype     | Primary anchor                          | What to emulate                                                                                                                           | Secondary anchor            | Operator adds                   |
| ------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------- |
| **List**      | **Linear** (issues list)                | dense-but-legible rows, quiet zebra-free separators, one accent for status, sort/filter affordances that don't shout, instant empty state | **Stripe** (payments table) | _(RSP/aptitude list ref — TBD)_ |
| **Detail**    | **Linear** (issue detail)               | title + meta strip + primary content, right-rail secondary facts, no nested cards, generous line-height                                   | **Stripe** (payment detail) | _(TBD)_                         |
| **Form**      | **Stripe** (checkout / dashboard forms) | one column, labels above fields, clear required affordance, inline validation, one primary button, humane copy                            | **Linear** (settings forms) | _(TBD)_                         |
| **Dashboard** | **Vercel** (project overview)           | a calm stat row (no card soup), one chart with breathing room, real empty/loading states, restrained color                                | **Stripe** (home)           | _(TBD)_                         |
| **Settings**  | **Vercel** (project settings)           | sectioned groups, description under each control, destructive actions visually separated + confirmed, no dead toggles                     | **Linear** (settings)       | _(TBD)_                         |

## Cross-archetype anchors (all screens)

- **One accent, one primary action per screen** (Linear/Stripe are disciplined here — resist a
  second competing CTA; the V2-210 pilot's dual "New Asset" is the anti-pattern to avoid).
- **State honesty** — every list/detail has real empty + loading + error states (Vercel's empties
  are the bar: a sentence + one action, never a blank void).
- **Token-scale spacing, no arbitrary values** (enforced by V2-304); **copy through messages**,
  sentence case, imperative buttons, no trailing periods on labels (enforced by V2-305).
- **RTL + dark hold** — anchors are LTR/light products, so for `ar`/dark the bar is "does it stay
  coherent", judged from the V2-301 captures, not the anchor.

## The scored rubric (`/design-qa` verdict — 10 points)

Each screen scores **0–1 per criterion, 10 total** (was a prose verdict; V2-307 makes it numeric so
runs are comparable and a regression is visible). Cite a capture + an anchor per deduction.

| #   | Criterion          | 1 (pass)                                                           | 0 (fail)                                         |
| --- | ------------------ | ------------------------------------------------------------------ | ------------------------------------------------ |
| 1   | Grid & alignment   | on a consistent grid; nothing visually off-axis                    | ragged columns, misaligned controls              |
| 2   | Hierarchy          | title → meta → content reads in one glance                         | flat; everything the same weight                 |
| 3   | One primary action | exactly one primary CTA per screen                                 | two+ competing primaries                         |
| 4   | State honesty      | real empty/loading/error                                           | blank void / spinner-only / raw error            |
| 5   | Spacing rhythm     | token-scale, consistent gaps                                       | arbitrary/off-scale spacing                      |
| 6   | Copy               | sentence case, imperative buttons, no enum tokens/trailing periods | raw enums, Title Case buttons, "Submit Request." |
| 7   | RTL                | `dir="rtl"` mirrors correctly (ar/he/fa/ur)                        | LTR bleed-through / clipped                      |
| 8   | Dark               | holds in dark theme                                                | contrast / token breakage                        |
| 9   | Responsive         | usable at mobile breakpoint                                        | overflow / unusable controls                     |
| 10  | a11y               | axe-clean (no serious/critical); labels + focus order              | serious/critical axe findings                    |

**Score → verdict:** 10 = ship · 8–9 = ship with the noted nits filed · ≤7 = a red gate (fix the
0-scored criteria before the next QA tier). A scored run cites `docs/verification/<feature>/`.

### Worked scored run — Asset Tracker list (V2-301 captures, after the enum fix)

Scored `docs/verification/asset-tracker/after/asset.desktop.{light,dark}.png`: 1 grid ✓ · 2
hierarchy ✓ · 3 one-primary ✗ (two "New Asset" CTAs — filed) · 4 state ✓ (honest empty) · 5 spacing
✓ · 6 copy ✓ (enums humanized this pass) · 7 RTL n/a (en-only fork) · 8 dark ✓ · 9 responsive ✓
(mobile captured) · 10 a11y — not axe-scanned in the during-build loop (deferred to gated
`/design-qa`). **Score 8/9 applicable** (RTL n/a) → ship with the dual-CTA nit filed
(findings-register). This is the first numeric `/design-qa` verdict (V2-307 acceptance).
