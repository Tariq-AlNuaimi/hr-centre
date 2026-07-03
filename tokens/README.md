# Design token pipeline (Style Dictionary) — A5 seed, cat 21

A machine-readable token source that compiles to platform outputs. This is a
**parallel, additive** pipeline: `app/tokens.css` stays the hand-authored source
of truth the app imports; this proves a `tokens.json -> output` path exists so a
fork that later needs multi-platform tokens (JS objects, iOS/Android, a Figma
sync) extends **one** source instead of hand-maintaining N copies of the ruler.

## Files
- `tokens/design-tokens.json` — the token **source**. Mirrors the primitive
  `:root` values in `app/tokens.css` + `brand.config.ts` (spacing, type, radius,
  motion, brand + semantic-surface colors).
- `style-dictionary.config.mjs` — the build config (CSS platform, verbatim
  pass-through so the output faithfully mirrors the CSS ruler).
- `scripts/build-tokens.mjs` — the runner behind `npm run tokens:build`.
- `tokens/build/tokens.generated.css` — **generated** output (gitignored;
  reproduce with the command below).

## Usage
```bash
npm run tokens:build   # -> tokens/build/tokens.generated.css
```
The generated file emits the same `--space-*` / `--font-size-*` / `--radius-*` /
`--surface-*` custom properties as `app/tokens.css`'s primitive block.

## Keeping it in step
`app/tokens.css` remains canonical. When a primitive value changes there, update
`tokens/design-tokens.json` to match (the design-tokens contract test guards the
AntD↔CSS overlap; this JSON tracks the CSS side). When a fork is ready to make
this pipeline canonical (e.g. to add a JS/native platform), point `app/tokens.css`
at the generated output and add the extra platforms to `style-dictionary.config.mjs`.
