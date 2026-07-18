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

## Reproduce

```
# from repo root, with the two scratch scripts:
node build-showcase.mjs      # → docs/verification/design-system/showcase.html
node parity.mjs              # → docs/verification/design-system/token-parity.md
npx tsx --test tests/contracts/design-tokens.test.ts   # 9/9 pass
```
