---
name: design-system
description: Build good UI on the FIRST pass instead of fixing it at QA. The proactive front half of the design system -- declare the design read, pick the right pattern from the vetted recipes, and emit on-token, RTL/dark-correct, accessible markup using the shipped shared primitives. Use BEFORE building or changing any screen/component, when the user says "build the UI for X", "make this screen", "the design looks bad", "/design-system", "design this", or whenever scaffolding a page. The reactive complement is /design-qa (audits after); this prevents the findings /design-qa would raise.
---

# /design-system — design it right the first time

`/design-qa` catches slop *after* it's built; this skill *prevents* it. The
template already locks the **ruler** (tokens, theme, the `no-raw-hex-color` rule)
and the **anti-slop rules** (`docs/uat-rubric.md` Tier 0). What was missing is the
*proactive* half: a repeatable way to produce a good screen on the first pass.
That's the recipes + this checklist.

**Use it before writing UI, not after.** A screen built to the recipes lands
clean through `/design-qa`; a screen improvised does not (that's the "UI is
horrible" complaint).

## 1. Declare the design read (one line, mandatory — Tier 0)

Before any markup, state it in the response (not a file):
> Building **\<surface\>** for **\<audience\>**; tone **\<calm | dense-data | form-heavy | …\>**; density **\<default | compact\>**; the ONE primary action is **\<X\>**; accent = `bg-primary` (`brand.primary`).

This is the same declaration the blueprint lightweight track asks for — if you
came from `/blueprint`, reuse it. Consistency comes from committing to a declared
system, not from taste in the moment.

## 2. Build from the vetted recipes, not from scratch

`docs/design-recipes.md` has the copy-paste pattern for each recurring surface —
**page header, data table, form, filter bar, modal/dialog, and the empty/loading/
error states** — each already on-token, RTL- and dark-correct, and axe-clean.
Pick the matching recipe and adapt its content; don't reinvent the layout. Each
recipe is built on the shipped primitives — **reuse these, don't hand-roll**:

| Need | Use | Not |
|------|-----|-----|
| Page title + the one primary action | `PageHeader` (`components/shared/PageHeader.tsx`) | a hand-rolled `Space + Title + Button` with ad-hoc margins |
| A list/table | `DataTable` (server pagination, debounced search, `emptyText`) | a bare `<table>` |
| Nothing-here state | `EmptyState` (`description` + optional `actionLabel`/`onAction`) | a centered gray `<p>No data</p>` |
| Loading | `PageSkeleton` / `TableSkeleton` / `FormSkeleton` (`Skeletons.tsx`) | a bare spinner, or worse, nothing |
| Destructive confirm | `ConfirmAction` (Radix Dialog confirm) | a custom modal per delete |
| Chart | `Chart` (uses `chartPalette` from `components/shared/chart-palette.ts`) | raw recharts with hardcoded hex |
| Kanban | `KanbanBoard` | a bespoke dnd surface |

## Figma → on-token screen (design-to-code sub-recipe)

When the design source is a **Figma frame** (a pasted `figma.com` link or a
selection), don't paste what Figma emits — raw hex/px would trip `no-raw-hex-color`
(ADR-015) and land off-system. Use the Figma MCP (`mcp__Figma__get_design_context`,
`get_screenshot`, `get_variable_defs`, `get_metadata`; the `/figma-use` family) to
*read* the frame, then **re-express** it on our primitives with Figma variables mapped
to our tokens — the same discipline this skill already enforces, applied at the Figma
seam. Figma is the design source; `components/shared/*` + `app/tokens.css` are the
output ruler. The concrete step pattern (pull → map variables to tokens → rebuild on
primitives → on-token/RTL/dark/a11y checks → `/design-qa`) is the **"Figma → on-token
screen"** recipe in `docs/design-recipes.md`.

## 3. The non-negotiables (these are what make it look considered)

Pulled from `docs/uat-rubric.md` Tier 0 + the recipes; violating any is a
`/design-qa` finding, so honor them up front:
- **Spacing** off the 4px scale (`--space-*`) or a `--density-*` semantic — never
  `padding: 13px`. **Color** from the semantic utilities / CSS vars — never a raw hex
  (ESLint blocks it).
- **One accent** (`bg-primary`), **one primary action per screen**, **no nested
  Cards**, **no emoji-as-icons** (`lucide-react` only), **no dead controls**,
  **density picked once**.
- **Every screen ships its real empty, loading, AND error states** — not just the
  happy full-data view. This is the single biggest "looks unfinished" tell.
- **RTL + dark hold:** test `ar` (`dir="rtl"`) and dark mode; use logical
  properties (Tailwind logical utilities: `ms-*`/`me-*`/`ps-*`/`pe-*`/`text-start`,
  and flexbox, which mirrors automatically), never hardcoded left/right.
- **Accessibility:** labels associated with inputs, visible focus, logical heading
  order (`PageHeader level`), AA contrast. See the a11y rules in the recipes.

## 4. Hand off to QA

After building, run `/design-qa` on the new surface — it should pass, because you
built to its rubric. If it raises findings, fix them now; a finding you choose to
defer goes in `docs/findings-register.md` (a logged wave-off, not a silent skip).
For a living component showcase to diff against, the Storybook DX recipe
(`docs/recipes/dx/1-storybook.md`, via `/scale-up`) renders each primitive in all
its states.

## Related
- `docs/design-recipes.md` — the copy-paste patterns (the heart of this skill).
- `docs/uat-rubric.md` Tier 0 — the anti-slop rules this enforces.
- `/design-qa` — the reactive audit; `/blueprint` — where the design read starts.
- `app/tokens.css` (the `@theme` tokens + `[data-theme]` dark swap) — the ruler.
