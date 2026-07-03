# `design/` — the design handoff source of truth

`/design-qa` scores screens against this directory plus the design tokens. **The
template ships no mockups on purpose** — it is a generic starter, not a branded
product, so there is no per-screen visual baseline to diff against yet.

## What the baseline IS, out of the box

Until a fork adds mockups here, the design source of truth is the **token layer**,
which `/design-qa` reads directly:

- **`app/tokens.css`** — spacing scale, density semantics, type scale, radii, and the
  semantic surface colors, exposed as Tailwind utilities via the `@theme` block.
- **`app/globals.css`** — the `[data-theme="dark"]` variable swap (dark-mode colors +
  shadows) that restyles every token utility at once.
- **`components/shared/chart-palette.ts`** — the categorical chart-series palette.
- **`docs/uat-rubric.md`** — the heuristics every finding cites a pillar + anchor against.

With no mockups present, `/design-qa` falls back to **token-fidelity + heuristic**
scoring (on-token spacing/color/type, one accent, real empty/loading/error states,
RTL + dark, axe clean). A deviation is cited against a token or a rubric heuristic,
never against a missing mockup — and a missing mockup is **not** itself a finding.

## What a fork adds here

When a fork has real screens, drop the design handoff in this directory so
`/design-qa` can diff against it:

```
design/
  <screen-or-flow>.png        # exported mockup / Figma frame
  <screen-or-flow>.notes.md   # intent, states, edge cases (optional)
```

Then the design-QA tier diffs the built screen against `design/<screen>.*` in
addition to the token layer. Keep filenames aligned with route/screen names so the
mapping is obvious.
