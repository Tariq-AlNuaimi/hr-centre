# Design-system replacement & verification

Replaced the template-default design system (indigo `#4f46e5`, Inter) with the
**Rihal Design System** (royal `#0165ff`, Geist / Geist Mono, neutral surfaces,
dark via the single `[data-theme="dark"]` swap) — a **value migration into the
existing typed token architecture** (all `brand.config` consumers + the
`design-tokens` contract test stay green).

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

| Gate               | File                                          | Runs in                       | Enforces                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Static drift**   | `tests/contracts/design-system-drift.test.ts` | warm `/ship` (contract phase) | font family is single-source (no hardcoded name in tokens/globals — P1.4); chart series-1 == brand; brand-as-text ≠ raw brand; no `undefined/null/NaN` in token CSS; non-empty font fallback (P0.1/P1.5)                                     |
| **Browser parity** | `tests/uat/design-system.uat.ts`              | `npm run uat` · `/qa`         | mounts clean (no console errors); printed hex == token value (P1.5); **hover changes paint** (P0.2); **`[data-theme]` flips `--background`**; **axe** serious/critical == 0 both themes (P3.10); **≤1.5% visual-diff** vs committed baseline |

Baselines: `tests/uat/design-system.uat.ts-snapshots/style-guide-{light,dark}-chromium-linux.png`.

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

## Reproduce

```
npx tsx --test tests/contracts/design-system-drift.test.ts        # static gate
# browser gate needs the app: native PG (docs/agent-memory.md recipe) + npm run dev, then:
UAT_EMAIL=admin@example.com UAT_PASSWORD=changeme \
  npx playwright test tests/uat/design-system.uat.ts              # 9/9
```
