# Design-system replacement & verification

Replaced the template-default design system (indigo `#4f46e5`, Inter) with the
**Rihal Design System** (royal `#0165ff`, Geist / Geist Mono, neutral surfaces,
dark via the single `[data-theme="dark"]` swap) — a **value migration into the
existing typed token architecture** (all `brand.config` consumers + the
`design-tokens` contract test stay green).

## The flagship showcase: `/design-system` (the "Manzil" landing)

`app/[locale]/design-system/page.tsx` — the branded design-system landing from the
original mockup, now a **real, full-bleed Next.js route** (authed, outside the
dashboard `AppShell`; blueprint: `docs/blueprints/design-system-showcase.md`). It
reproduces the living hero + AI contract-review card, and the Why / Color / Type /
Components / **AI-patterns (built on `components/shared/ai/*`)** / Adoption sections
— all on the royal/Geist tokens, every printed hex read from `brand.config.ts`. It
is gated by the same browser-parity spec (axe both themes + ≤1.5% visual-diff;
baselines `design-system-{light,dark}-chromium-linux.png`). Rendered captures:
`showcase-route-{light,dark}.png`.

The `/style-guide` route below stays the utilitarian component reference; the two
are complementary.

## Source of truth: the real app route (not a generated file)

The design-system showcase is the live, on-stack **`/style-guide`** route
(`app/[locale]/(dashboard)/style-guide/page.tsx`) — a real Next.js page on the
shipped shadcn/Tailwind primitives + tokens. Every displayed value is **computed
from the token source at render time** (imports `brand.config.ts` /
`chart-palette.ts`), so a swatch fill and its printed hex are the _same_ value
and cannot drift. Hover / focus / dark are genuinely live (real CSS, not inert
attributes), and assets resolve because it runs inside the app.

> An earlier iteration emitted a standalone `.dc.html` via a scratch generator.
> That was retired: this repo has no Design-Component runtime (stack is locked to
> Next.js + shadcn + Tailwind, ADR-001), and a code-gen'd artifact re-introduces
> the whole class of drift bugs (`undefined` interpolation, inert `style-hover`,
> missing assets). Rendering the design system _through the app_ removes them by
> construction. `token-parity.md` (24/24) is kept as the token-contract proof.

## The two gates (correct-by-construction, enforced)

Browser gates live in the `/qa`·`uat` tier by constitutional design (warm `/ship`
is deliberately DB-free); the source invariants run in warm `/ship`. So the
enforcement is split to match the architecture:

| Gate               | File                                          | Runs in                                 | Enforces                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Static drift**   | `tests/contracts/design-system-drift.test.ts` | warm `/ship` (contract phase)           | font family is single-source (no hardcoded name in tokens/globals — P1.4); chart series-1 == brand; brand-as-text ≠ raw brand; no `undefined/null/NaN` in token CSS; non-empty font fallback (P0.1/P1.5)                                     |
| **Browser parity** | `tests/uat/design-system.uat.ts`              | `npm run uat` · `/qa` · **`ship:full`** | mounts clean (no console errors); printed hex == token value (P1.5); **hover changes paint** (P0.2); **`[data-theme]` flips `--background`**; **axe** serious/critical == 0 both themes (P3.10); **≤1.5% visual-diff** vs committed baseline |

Baselines: `tests/uat/design-system.uat.ts-snapshots/style-guide-{light,dark}-chromium-linux.png`.

`ship:full` (used by `/deploy`, `/handoff`, CI) runs the browser parity as a phase-B
gate (`npm run design-parity`), degrading to an honest SKIP when no app is reachable
(probes `UAT_BASE_URL` / `localhost:3000`) — same pattern as the docker + integration
gates, so it never false-REDs a DB-less run, and is RED only on a genuine parity
failure where an app IS up.

## AI-pattern primitives (`components/shared/ai/*`)

The MIGRATION.md shared AI contract, now real components (build-vs-buy ledger,
2026-07-18): `AiAssistPanel` (advisory frame + ✦ mark), `AiStreaming` (honest
loading), `ConfidenceChip` (bars + number from one value), `CitationLink`,
`ResponsibleAiBanner`, `AgentActivity` (AI vs Human). Prop-driven (callers
localize), on-token, a11y/RTL-safe. Demoed in the `/style-guide` "AI patterns"
section; the command palette (⌘K) already lives in `components/layout/`.

## Verification run (this session)

```
tests/contracts/design-system-drift.test.ts   → 7/7 pass (warm /ship)
tests/uat/design-system.uat.ts                → 9/9 pass (authed dev app):
  ✓ mounts clean, no console errors
  ✓ displayed hex values ARE the token-source values
  ✓ primary button hover is live (paint changes)
  ✓ dark swap is live: [data-theme] flips --background
  ✓ axe clean (serious/critical) — light
  ✓ axe clean (serious/critical) — dark
  ✓ visual parity vs baseline (≤1.5%) — light
  ✓ visual parity vs baseline (≤1.5%) — dark
```

The rendered light + dark route are the committed baseline PNGs above (viewed and
self-critiqued during the run).

## V2-301 capture matrix (2026-07-18) — the layout-primitive visual evidence

Closes the V2-302 gap the harness re-audit named: the shared layout primitives
existed and were ledger-covered, but had no committed **full** visual-iteration
matrix (the prior `showcase-route-{light,dark}.png` were desktop-only, light+dark,
en-only). Captured via `npm run capture -- --feature design-system --routes
/design-system` against the authed dev app (native PG recipe), across the full
V2-301 matrix — `{desktop, mobile} × {light, dark} × {en, ar}`:

```
design-system.desktop.light.en.png   design-system.desktop.dark.en.png
design-system.mobile.light.en.png    design-system.mobile.dark.en.png
design-system.desktop.light.ar.png   design-system.desktop.dark.ar.png   (RTL)
design-system.mobile.light.ar.png    design-system.mobile.dark.ar.png    (RTL)
```

`ar` was enabled only for the capture run (`project.config.json` `locales`
temporarily `["en","ar"]`, then reverted to the shipped English-only `["en"]`);
`messages/ar.json` + the RTL code ship inert, so this proves the primitives' RTL
capability without changing the fork's shipped locale set.

### Self-critique vs the 10-point rubric (V2-307)

Viewed all four corners of the matrix (en light/dark desktop, en light mobile, ar
dark desktop). Score **9/10**:

1. **Grid alignment** ✓ — consistent left rail + gutter; section eyebrows align.
2. **Hierarchy** ✓ — h1 / eyebrow / body ladder is unambiguous.
3. **One primary action** ✓ — hero pairs one primary ("Try the command bar") with
   one secondary ("See the AI patterns").
4. **State honesty** ✓ — real primitive states shown: Primary→Disabled buttons,
   focus ring, error input, streaming skeleton, StatGrid, DataTable rows.
5. **Spacing rhythm** ✓ — section rhythm holds on the 4px scale at both breakpoints.
6. **Copy** ✓ — sentence case, no trailing periods on labels.
7. **RTL** ✓ — `ar` variant fully mirrors: brand/nav to the right, hero
   right-aligned, StatGrid + DataTable column order reversed, buttons mirrored.
   Confirms the primitives use direction-aware logical properties, not hardcoded
   left/right. (English glyphs stay LTR inside the RTL container — expected bidi;
   the page copy is next-intl-exempt by design.)
8. **Dark** ✓ — `[data-theme="dark"]` swap holds; accent + surfaces correct.
9. **Responsive** ✓ — mobile collapses grids to 1–2 columns; nav + StatGrid reflow.
10. **a11y** — not scored from pixels here; covered by the axe gate above
    (serious/critical == 0 both themes). Focus ring is visibly on-token.

Single deduction is a11y-from-pixels (deferred to the axe gate, which passes). The
one non-design artifact in the frames — the red "2 Issues" badge, left-center — is
the **Next.js dev-tools overlay** (dev-mode only), not part of the design.

## Reproduce

```
npx tsx --test tests/contracts/design-system-drift.test.ts        # static gate
# browser gate needs the app: native PG (docs/agent-memory.md recipe) + npm run dev, then:
UAT_EMAIL=admin@example.com UAT_PASSWORD=changeme \
  npx playwright test tests/uat/design-system.uat.ts              # 9/9
# V2-301 capture matrix (temporarily enable ar in project.config.json for the RTL cells):
npm run capture -- --feature design-system --routes /design-system
```
