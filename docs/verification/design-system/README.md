# Design-system replacement — verification

**Change:** replaced the template-default design system (indigo `#4f46e5`, Inter)
with the **Rihal Design System** (royal `#0165ff`, Geist / Geist Mono, neutral
surfaces, dark via the single `[data-theme="dark"]` swap) from the attached
drop-in files (`brand.config.ts` + `tokens.css` + `globals.css` + `MIGRATION.md`).

Per `MIGRATION.md`'s `fullstack-vibe-template` checklist this is a **value
migration into the existing typed token architecture** (keeping all 7
`brand.config` consumers + the `design-tokens` contract test green), not a
structural file swap.

## What changed in the repo

| File                                 | Change                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand.config.ts`                    | `primary`/`accent` → `#0165ff`; `themeColor` → `#0165ff`; font → `Geist` + `Geist Mono`; added `colors.primaryEmphasis` (light `#0b53c9` / dark `#6ea8ff`) + `font.mono`/`monoCssVar` |
| `app/[locale]/layout.tsx`            | `Inter` → `Geist` + `Geist_Mono` via `next/font/google`; bind `--font-sans` + `--font-mono`; emit `--brand-primary-emphasis`                                                          |
| `app/tokens.css`                     | royal focus ring (`--shadow-ring`); `--primary-emphasis` / `--nav-active-foreground` are now AA-safe brand-as-text; added the `font-mono` utility                                     |
| `app/globals.css`                    | royal `::selection`; dark `--primary-emphasis` + `--nav-active-foreground` → `#6ea8ff`; Noto Sans Arabic in the body fallback                                                         |
| `components/shared/chart-palette.ts` | Rihal chart palette (royal series 1)                                                                                                                                                  |

## Test 1 — token parity vs the attached files

`token-parity.md` — a normalized value diff of the repo's three design files
against the three attached drop-in files. **Result: 24 / 24 exact match, 0
mismatches.** Every shared token (brand, brand-as-text emphasis, dark surfaces,
radius scale, shadow ring, fonts, chart brand) is identical.

## Test 2 — render the showcase & compare to the attached

`showcase.html` is the attached `Rihal_Design_System.dc.html` re-generated as a
static, browser-renderable page (Design-Craft `{{ }}` placeholders resolved to
their finished state, `<sc-if>` conditionals expanded, the DC runtime wrapper
stripped; the token style block kept verbatim). Rendered in Chromium at 1200px:

- `generated-light.png` — light mode
- `generated-dark.png` — dark mode (`[data-theme="dark"]`)

Both match the attached design: royal `#0165ff` as the single accent, Geist type
on a 4px grid, the color/type/component/AI-pattern/adoption sections, honest
status colors, and a clean dark swap. (The top-left logo is a broken image only
because the `assets/rihal-logo-*.png` files are not part of the token drop-in.)

Note: `showcase.html` keeps the attached demo's inlined token block verbatim, so
it proves the _target_ renders — not yet that the repo's tokens produce it. Test
3 closes that gap.

## Test 3 — the showcase generated FROM the repo's own design system

`showcase-from-system.html` is the same markup, but its styling is **driven by
the repo's real design files, read at generation time**: `app/tokens.css` and the
`[data-theme="dark"]` swap from `app/globals.css` are inlined verbatim, the brand
vars are emitted from `brand.config.ts` exactly as `app/[locale]/layout.tsx` does
on `<html>`, and the showcase's own variable names (`--brand`, `--fg`, `--r-md`,
`--sh-md`, the status palette, …) are **bridged onto those tokens**. The few
extended demo shades the template's lean semantic layer doesn't name (brand
hover/press/soft, faint, border-soft, grid, `r-xl`/`2xl`/`pill`, `sh-xl`) are
**derived from `--brand-primary` / the neutral scale via `color-mix`**, so they
track the brand too. Change a token in the repo and re-run — the showcase changes
with it.

- `from-system-light.png` — light mode
- `from-system-dark.png` — dark mode

Both render identically to Test 2's reference — confirming the repo's design
system reproduces the attached showcase, not just a copy of its values.

## Reproduce

```
# from repo root, with the scratch scripts:
node build-showcase.mjs        # → showcase.html            (attached, made renderable)
node gen-from-system.mjs       # → showcase-from-system.html (driven by the repo tokens)
node parity.mjs                # → token-parity.md          (24/24 value match)
npx tsx --test tests/contracts/design-tokens.test.ts   # 9/9 pass
```
