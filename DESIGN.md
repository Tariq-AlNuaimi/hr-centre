# DESIGN.md — Rihal Design System

> Plain-text design-system contract in the [Stitch DESIGN.md format](https://stitch.withgoogle.com/)
> (see [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)): an AI agent —
> or a human — reads this file to generate UI that matches the system, no Figma export required.
> **This file documents; the codebase enforces.** Every value below is bound to a source of truth —
> `brand.config.ts` (brand), `app/tokens.css` (scales + light surfaces), `app/globals.css` (dark
> swap) — and gated by ESLint (`no-raw-hex-color`), `/design-qa`, and the 10-point rubric in
> `docs/design-references.md`. If this file and the token sources ever disagree, the token sources
> win; fix the drift here.

## 1. Visual theme & atmosphere

Calm, precise, operational. This is an **internal-tools register** (Linear / Vercel / Stripe are
the taste anchors, `docs/design-references.md`): dense-but-legible data surfaces, quiet chrome, and
exactly **one accent that points, never decorates**.

- **Light-first**, with a faint cool page ground (`#fbfbfc`) so flat white cards read against it
  without heavy borders. Dark mode is a first-class single-variable swap, not an afterthought.
- **Hairline separation over decoration** — cool-biased 1px borders (`#e6e8ec`) and soft layered
  shadows carry structure; no gradients on product surfaces, ever.
- **Engineered grotesk voice** — Geist for UI, Geist Mono for IDs/codes/metrics. Crisp,
  antialiased, `optimizeLegibility`.
- **Bidirectional by construction** — RTL (`ar`/`he`/`fa`/`ur`) mirrors automatically; nothing may
  assume LTR.
- Feel: a considered instrument panel, not a marketing page. Restraint is the brand.

## 2. Color palette & roles

Colors come **only** from tokens (`no-raw-hex-color` is an `error`). Components use semantic
Tailwind utilities (`bg-card`, `text-foreground`, `border-border`…); the hex below lives solely in
`brand.config.ts` and the token CSS.

### Brand & accent

| Role              | Token / utility                                |     Light | Dark      | Use                                                        |
| ----------------- | ---------------------------------------------- | --------: | --------- | ---------------------------------------------------------- |
| Primary (surface) | `--brand-primary` → `bg-primary`               | `#0165ff` | `#0165ff` | Primary buttons, active states, focus ring — solid royal   |
| Accent            | `--brand-accent` → `text-accent`               | `#0165ff` | `#0165ff` | Highlights, single-series charts (defaults to primary)     |
| Brand as text     | `--primary-emphasis` → `text-primary-emphasis` | `#0b53c9` | `#6ea8ff` | Links, active nav/sort/filter, brand icons — WCAG AA split |
| Accent wash       | `--accent-subtle` → `bg-accent-subtle`         |   12% mix | 12% mix   | Selected-nav fill, KPI icon chips (`color-mix` with card)  |

### Surfaces & text

| Role         | Token → utility                                |     Light |      Dark | Use                                    |
| ------------ | ---------------------------------------------- | --------: | --------: | -------------------------------------- |
| Page ground  | `--background` → `bg-background`               | `#fbfbfc` | `#030712` | The canvas everything sits on          |
| Card         | `--card` → `bg-card`                           | `#ffffff` | `#111827` | Cards, panels, tables                  |
| Overlay      | `--popover` → `bg-popover`                     | `#ffffff` | `#1d2129` | Dropdowns/menus/popovers (above cards) |
| Muted fill   | `--muted` → `bg-muted`                         | `#f3f4f6` | `#1f2937` | Subtle fills, skeletons                |
| Text         | `--foreground` → `text-foreground`             | `#111827` | `#f9fafb` | Primary ink                            |
| Muted text   | `--muted-foreground` → `text-muted-foreground` | `#5b6472` | `#9ca3af` | Secondary ink — AA on muted fills      |
| Border       | `--border` → `border-border`                   | `#e6e8ec` | `#1f2937` | Hairlines                              |
| Input border | `--input` → `border-input`                     | `#d1d5db` | `#374151` | Form control strokes                   |

### Semantic

| Role                  | Token → utility                                        |     Light |      Dark | Use                                           |
| --------------------- | ------------------------------------------------------ | --------: | --------: | --------------------------------------------- |
| Destructive (surface) | `--destructive` → `bg-destructive`                     | `#dc2626` | `#dc2626` | Delete buttons/badges — white foreground, AA  |
| Destructive as text   | `--destructive-emphasis` → `text-destructive-emphasis` | `#dc2626` | `#f87171` | Error messages, destructive menu items        |
| Focus ring            | `--ring` / `--shadow-ring`                             |     royal |     royal | `0 0 0 3px rgba(1,101,255,.24)` visible focus |

**Rules:** the surface/text **split is deliberate** — raw royal and raw red fail AA as text on the
opposite theme, so "as-text" tokens lighten in dark while surfaces hold. Never collapse them. Dark
mode is the `[data-theme="dark"]` variable swap — **never** hand-written `dark:` utility pairs for
surface colors.

## 3. Typography rules

One family, one scale, no exceptions. Family names live **only** in `brand.config.ts`.

- **UI family:** Geist (via `next/font` → `--font-sans` → `font-sans`), system fallback stack
  includes `"Noto Sans Arabic"` for RTL locales.
- **Mono family:** Geist Mono (`--font-mono` → `font-mono`) — reserved for IDs, codes, metrics,
  and code. Never for headings or body prose.

| Token → utility                  | Size | Use                                |
| -------------------------------- | ---: | ---------------------------------- |
| `--font-size-xs` → `text-xs`     | 12px | Meta, captions, kbd hints          |
| `--font-size-base` → `text-base` | 14px | **Body base** — line-height 1.5714 |
| `--font-size-lg` → `text-lg`     | 16px | Emphasized body                    |
| `--font-size-h5` → `text-h5`     | 16px | Minor headings                     |
| `--font-size-h4` → `text-h4`     | 20px | Card/section titles                |
| `--font-size-h3` → `text-h3`     | 24px | Page section headings              |
| `--font-size-h2` → `text-h2`     | 30px | Page titles                        |
| `--font-size-h1` → `text-h1`     | 38px | Rare — top-level hero only         |

**Principles:** 14px body base (internal-tool density, not marketing 16px). Body measure caps at
`--measure-body: 65ch`. Copy is **sentence case**; buttons are **imperative** ("Create asset", not
"Creation"); **no trailing periods on labels**; never render raw enum tokens (`IN_REVIEW`) —
humanize them. Every user-facing string goes through `next-intl` messages.

## 4. Component stylings

Build from the shipped primitives in `components/shared/*` (shadcn/Radix base, ADR-029) — **compose,
don't hand-roll**. Recipes with copy-paste markup: `docs/design-recipes.md`.

- **`PageHeader`** — title (`text-h2`) + optional description + the screen's **one** primary
  action, right-aligned (start-aligned in RTL). Every page starts with it.
- **Button, primary** — `bg-primary text-primary-foreground`, radius `rounded-md` (8px), solid
  royal, no gradient. Exactly **one per screen**.
- **Button, secondary/ghost** — neutral surface + `border-input` hairline; quiet hover via
  `bg-muted`. Destructive actions use `bg-destructive` + `ConfirmAction` (typed confirmation for
  irreversibles).
- **`DataTable`** — flat `bg-card` panel, hairline row separators (no zebra), `text-base` cells,
  mono for IDs/metrics, sort/filter affordances that don't shout; ships with its own empty state.
  List routes paginate or bound — always.
- **`FormField` / forms** — one column, labels **above** fields, one message slot per field fed by
  zod at the boundary; inline validation, one primary submit. Inputs: `bg-card` fill,
  `border-input` stroke, focus = royal ring (`--shadow-ring`), ≥40px tap height.
- **`SectionCard`** — the standard content panel: `bg-card`, `rounded-md`, `shadow-sm`,
  `p-density-card`. **Never nest cards.**
- **`StatCard`** — KPI tile: label (`text-muted-foreground text-xs`), value (`text-h3`,
  `font-mono` for numerics), optional `bg-accent-subtle` icon chip. A calm stat row, never card
  soup.
- **`EmptyState` / `Skeletons` / error states** — the **state triad**: every data surface ships
  real empty (a sentence + one action, never a blank void), loading (skeleton, not spinner-only),
  and error (honest message, no green toast over a failure).
- **Overlays** (dialog/dropdown/popover) — `bg-popover` + `shadow-lg`, radius `rounded-lg` (12px),
  focus-trapped, one primary action per modal.
- **Charts** — recharts via `Chart.tsx` + `chart-palette.ts` only; single-series uses the accent.
- **App chrome** — sidebar nav: active item = `bg-accent-subtle` fill +
  `text-nav-active-foreground`; header carries the ⌘K command-search trigger (collapses to icon on
  narrow screens).

## 5. Layout principles

- **4px base scale** (`--space-1: 4px` … `--space-16: 64px`). Every gap/margin/padding is a step
  on it — `padding: 13px` is a design-QA finding.
- **Density semantics over raw steps** — recurring decisions use the four semantic tokens so a
  fork can retune the whole app in four lines: `--density-page` 24px (page padding, on `<main>`),
  `--density-card` 16px (inside panels), `--density-section-gap` 24px (between sections),
  `--density-control-gap` 8px (between adjacent controls). Utilities: `p-density-page`,
  `gap-density-section-gap`, etc.
- **Declare a page archetype, don't invent a layout** — List / Detail / Form / Dashboard /
  Settings (`docs/design-recipes.md` §1d); each has a vetted skeleton and taste anchors.
- **Hierarchy in one glance** — title → meta → content; no two elements competing at the same
  weight.
- **Logical properties for direction** — spacing/alignment must mirror under `dir="rtl"` (use
  start/end, not left/right).

## 6. Depth & elevation

Soft, layered, restrained — premium depth without heavy drop shadows. Structure comes from the
surface ladder (ground → card → popover) plus hairlines; shadows only confirm it.

| Level | Token → utility             | Light                          | Dark (auto-swapped)         | Use                           |
| ----- | --------------------------- | ------------------------------ | --------------------------- | ----------------------------- |
| 0     | none                        | flat on `bg-background`        | flat                        | Page ground, body text        |
| 1     | `--shadow-sm` → `shadow-sm` | `0 1px 2px rgba(16,24,40,.05)` | deeper black, same geometry | Cards, sticky-header hairline |
| 2     | `--shadow-md` → `shadow-md` | 2-layer, ≤3px blur             | deeper black                | Raised panels, hover lift     |
| 3     | `--shadow-lg` → `shadow-lg` | `0 8px 24px …` + `0 2px 6px …` | deeper black                | Dialogs, dropdowns, popovers  |

Radius is **one scale per app** — `rounded-sm` 6px (kbd, chips), `rounded-md` 8px (**base**:
buttons, inputs, cards), `rounded-lg` 12px (overlays, featured panels). No mixed corner systems.
Motion: `--motion-fast` 0.1s / `--motion-mid` 0.2s / `--motion-slow` 0.3s with the refined
deceleration curve `cubic-bezier(0.22, 1, 0.36, 1)` (`ease-out`).

## 7. Do's and don'ts

**Do**

- Use semantic token utilities for every color, space, radius, shadow, and font.
- Start every screen with `PageHeader`; give it exactly one primary action.
- Ship the state triad (empty/loading/error) on every data surface, honestly.
- Keep tables dense-but-legible: hairline separators, one accent for status.
- Humanize copy: sentence case, imperative buttons, translated via `next-intl`.
- Verify in **both themes, both directions, both breakpoints** before calling it done.

**Don't**

- No raw hex in components (`no-raw-hex-color` blocks it) — token sources only.
- No gradients on product surfaces; the accent is solid royal and **scarce**.
- No second competing primary CTA; no dead controls; no green toast over a failure.
- No nested Cards; no emoji-as-icons; no spinner-only loading; no raw enum text.
- No hand-written `dark:` surface pairs — dark is the `[data-theme="dark"]` swap.
- No ad-hoc spacing (`13px`), no second corner system, no second accent color.

## 8. Responsive behavior

- **Verification matrix is the spec:** desktop + mobile × light + dark × every enabled locale
  (RTL variants included) — captured by `npm run capture`, scored by the rubric. "Usable at the
  mobile breakpoint" is a pass/fail criterion.
- **Collapse, don't hide:** the header search trigger collapses to its icon below 576px (label +
  ⌘K kbd hide); the split-screen auth brand panel drops below 768px so the form owns mobile; card
  grids and stat rows stack to one column.
- **Touch targets:** interactive controls ≥40px tap height; focus states always visible (royal
  ring), never suppressed.
- **Tables** scroll horizontally inside their panel on narrow screens rather than reflowing into
  ambiguity; the page body never scrolls sideways.
- **RTL is a responsive axis too:** every layout must mirror under `dir="rtl"` with no LTR
  bleed-through or clipping.

## 9. Agent prompt guide

When generating UI for this codebase:

1. **Read the rails first:** `docs/rules/design.md` (Definition of Done) →
   `docs/design-recipes.md` (vetted patterns + slop gate) → this file. Run `/design-system` before
   building any screen; `/design-qa` audits after.
2. **Compose from `components/shared/*`** — `PageHeader`, `DataTable`, `FormField`, `SectionCard`,
   `StatCard`, `EmptyState`, `Skeletons`, `ConfirmAction`, `Chart`. Reach for a recipe before
   writing new markup; never install a UI library (stack is locked, ADR-001/029).
3. **Tokens only.** Tailwind semantic utilities (`bg-card`, `text-muted-foreground`,
   `p-density-card`, `shadow-sm`, `rounded-md`, `text-h4`…). If you typed a hex or a raw pixel
   value in a component, you've already failed the gate.
4. **Declare before you build:** surface, audience, tone, density, and the page archetype — then
   use that archetype's skeleton. One accent; one primary action.
5. **Prove it with pixels:** capture desktop/mobile × light/dark (× RTL when enabled), look at the
   images, self-score the 10-point rubric (`docs/design-references.md`), fix, re-capture.
   "Looks good" claimed from code alone is invalid.
6. **A11y floor:** axe-clean of serious/critical; labels and focus order correct; AA contrast is
   pre-solved by the token pairs above — don't invent new color combinations.
