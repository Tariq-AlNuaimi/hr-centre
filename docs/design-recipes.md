# Design recipes — build good UI on the first pass

The **proactive** companion to `docs/uat-rubric.md` (which scores UI _after_ it's
built). `/design-system` drives this doc; `/design-qa` checks the result. Each
recipe is on-token (4px scale + theme tokens), RTL- and dark-correct, and built on
the shipped `components/shared/*` + `components/ui/*` primitives — copy the pattern,
change the content, don't reinvent the layout.

> `docs/recipes.md` is **code** recipes (email, Excel, charts). **This** file is
> **design** recipes (layout, states, a11y). Different ruler, same spirit: reuse the
> blessed pattern instead of improvising.

Market scan (the patterns below are distilled from): Anthropic's `claude-design.md`
agent rules + the frontend-aesthetics cookbook, the design-review skill rubrics,
shadcn/ui + Radix, Material / Polaris / Carbon system guidelines, WCAG 2.2 AA, and the
"AI design slop" tell datasets. **We keep the bans, not the marketing flourish** — an
internal tool wants restrained, familiar dashboard defaults (the shipped shadcn/Radix
primitives already ship them), not characterful display fonts or atmospheric gradients.

---

## 0. The slop gate (self-check before you call UI done)

These are the recognizable AI-generated tells. **Four or more = heavy slop, rebuild.**
Each is also a Tier-1 `/design-qa` finding (anchor: `uat-rubric.md` Tier 0).

- [ ] Untouched framework-default styling (the "I didn't decide anything" look).
- [ ] Purple/violet→blue gradients on buttons/text/backgrounds; neon glow shadows.
- [ ] **Emoji used as icons** (especially in nav). Use `lucide-react` (one family), or
      a local inline `<svg>` — never emoji.
- [ ] Centered-everything: `place-items:center` / `margin:auto` as the default; a
      badge above the H1 + exactly three feature cards.
- [ ] **Nested Cards** (Card-in-Card) or a colored left-border accent on every card.
- [ ] All-caps eyebrow labels on every section; label spam.
- [ ] More than one accent color; five equal-weight primary buttons.
- [ ] Everything animated (bouncing/wiggling/floating) — motion without meaning.
- [ ] Off-scale spacing (`padding:13px`); fake-precise data (`94.2%`); dead controls.

Internal-tools positive direction: **one accent (`bg-primary`), one primary action
per screen, generous-but-on-scale spacing, the primitives' default density unless the
screen is genuinely data-dense, real content over decoration.**

---

## 1. Scale rules (the non-negotiable numbers)

- **Spacing:** every gap/margin/padding is a step on the 4px scale (`--space-*` /
  Tailwind `p-*`/`gap-*`) or a `--density-*` semantic. Group siblings with `gap`
  (flex/grid), never bare margins between inline blocks.
- **Type:** off the type scale (`--font-size-*` / `text-xs…text-h1`); body 14px /
  line-height 1.57 (the base, already set). Make heading→body jumps _large_
  (`text-h3` 24px over body 14px), not timid. `text-wrap: balance` on headings,
  `pretty` on body where supported.
- **Color:** from the semantic utilities (`bg-primary`, `text-foreground`,
  `text-muted-foreground`, `border-border`…) / CSS custom properties only — raw hex is
  an ESLint error. One accent for the whole app; retune it in `brand.config.ts`
  (`brand.primary`, which flows into `--color-primary`/`bg-primary`), never per-screen.
- **Radius/motion:** one radius scale (`rounded-sm/md/lg` off `--radius-*`); motion
  durations off `--motion-*`.

---

## 1b. Figma → on-token screen (design-to-code sub-recipe)

When the design source is a Figma frame, **read it, then re-express it on our
primitives + tokens** — never paste the frame's raw hex/px (that's a `no-raw-hex-color`
ESLint error, ADR-015). Figma is the design; `components/shared/*` + `app/tokens.css`
are the output. Steps:

1. **Pull the frame.** `mcp__Figma__get_design_context` (layout + styling, the
   simplified context) + `mcp__Figma__get_screenshot` (the visual target to match) +
   `mcp__Figma__get_variable_defs` (its variables/styles) + `mcp__Figma__get_metadata`
   (structure). The `/figma-use` skill family wraps these.
2. **Map variables → our tokens, never raw values.** Each Figma variable/style resolves
   to a semantic token, not a literal: colors → `bg-primary`/`text-foreground`/
   `border-border`… (`app/tokens.css` `@theme` + `brand.config.ts`); spacing/radius →
   the 4px scale (`--space-*` / `p-*`, `--radius-*` / `rounded-*`); type → the type scale
   (`--font-size-*` / `text-*`). No off-scale px, no hex outside the token source. If the
   frame uses a value with no token, add it in `brand.config.ts`/`app/tokens.css` — don't
   inline it.
3. **Rebuild on primitives, not raw divs.** Match the frame's structure to the recipes
   above — `PageHeader`, `DataTable`/`DataView`, the form primitives, `Modal`,
   `StatCard`/`SectionCard` — reuse the pattern; don't reproduce Figma's absolute
   positioning or bespoke boxes.
4. **Run the normal checks.** On-token (no raw hex/off-scale spacing), the slop gate
   (§0), RTL (`ar`, logical properties) + dark hold, and a11y (§8) — the same bar every
   screen clears.
5. **`/design-qa` audits the result** against the Figma screenshot as the fidelity
   target — deviations are findings, same as any other surface.

## 2. Page header — `PageHeader`

The one title pattern: heading + optional one-sentence subtitle on the inline-start,
the screen's **single** primary action on the inline-end. RTL-mirrors automatically.

```tsx
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

<PageHeader
  title={t("cases.title")}
  subtitle={t("cases.subtitle")} // one sentence: what this screen is for
  actions={
    <Button onClick={openNew}>
      <Plus className="h-4 w-4" />
      {t("cases.new")}
    </Button>
  }
/>;
```

Rules: exactly one default-variant (primary) `<Button>` in `actions` — extra actions
are `variant="outline"`/`variant="ghost"`; `level` keeps heading order correct (the app
name is the h1, so a page title is `2`). No eyebrow label above it — the page position
already says what section this is.

## 3. Data table — `DataTable` (+ its empty state)

`DataTable` ships server pagination, debounced search, sort/filter callbacks, and an
`emptyText` slot. **Always pass a real empty state** — a blank table is the top
"unfinished" tell. Columns are plain descriptor objects (`title` / `dataIndex` /
`render` / `sorter` / `filters` / `width` / `align` / `ellipsis`); TypeScript infers the
type from the literal, so no annotation import is needed.

```tsx
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";

const columns = [
  { title: t("cases.title"), dataIndex: "title", sorter: true },
  { title: t("cases.owner"), dataIndex: "owner" },
];

<DataTable<Case>
  columns={columns}
  dataSource={rows}
  rowKey="id"
  total={total}
  page={page}
  pageSize={pageSize}
  onPageChange={setPage}
  searchable
  onSearch={setQuery}
  loading={isLoading} // renders the in-table loading overlay
  emptyText={
    <EmptyState
      description={t("cases.empty")} // WHY it's empty, not just "No data"
      actionLabel={t("cases.new")} // the recommended next action
      onAction={openNew}
    />
  }
/>;
```

Rules: columns emit real `<th>` header cells (scope handled by the table markup); keep
the table chrome calm (the tokens already tune header/row-hover neutrals); don't add a
second pagination or a custom search box — `DataTable` owns both. Empty-state copy is
**encouraging and explanatory**, never blames the user, and offers the primary action.

## 4. Form — vertical layout, one message slot

Default to **vertical** layout (label above field) — most robust to RTL and variable
label width. The **same zod schema that guards the API route** binds as the resolver
(`useZodForm`), so client validation and the server contract can't drift; the message
surfaces at the field. `TextField` is the labelled-input common case; drop to the
`FormField` + `FormItem`/`FormLabel`/`FormControl`/`FormMessage` primitives for anything
richer (a `Select`, a switch, a custom control).

```tsx
import { z } from "zod";
import { useZodForm, Form, TextField } from "@/components/shared/FormField";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const schema = z.object({
  title: z.string().min(1).max(120),
  status: z.enum(["OPEN", "CLOSED"]),
});

const form = useZodForm(schema, { defaultValues: { title: "", status: "OPEN" } });

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-[500px] flex-col gap-4">
    <TextField
      name="title"
      label={t("cases.fields.title")}
      description={t("cases.fields.titleHelp")} // ONE help line; the error replaces it
      maxLength={120}
    />

    <FormField
      name="status"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t("cases.fields.status")}</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="OPEN">{t("status.open")}</SelectItem>
              <SelectItem value="CLOSED">{t("status.closed")}</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />

    {/* primary action inline-start; cancel is secondary/low-emphasis */}
    <div className="flex gap-2">
      <Button type="submit" disabled={submitting}>
        {t("common.save")}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        {t("common.cancel")}
      </Button>
    </div>
  </form>
</Form>;
```

Rules: label→field gap stays on the 4–8px step (`FormItem` uses `gap-1.5`); **don't
stack help text and an error** — `FormMessage` replaces the `FormDescription` line on a
zod error. Required state is conveyed by the mark _and_ the message, never color alone.
One primary submit (`type="submit"`, default variant).

## 5. Filter bar (over a table)

A single aligned row of filters above the table — not a wall of stacked controls.
Space them with `gap-2` (or `gap-density-control-gap`); a clear/reset is
`variant="ghost"`. The table's own search lives in `DataTable searchable`; the filter
bar is for structured filters (status, owner, date range). The `Select` primitive is
placeholder-driven — pass `placeholder` on `<SelectValue>`, and pair a controlled
empty-string value with a small ghost clear button for the "allow clear" affordance
(the pattern the audit-log filter ships).

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

<div className="mb-4 flex flex-wrap items-center gap-2">
  <Select value={status ?? ""} onValueChange={setStatus}>
    <SelectTrigger aria-label={t("filters.status")} className="w-40">
      <SelectValue placeholder={t("filters.status")} />
    </SelectTrigger>
    <SelectContent>
      {statusOptions.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>

  <Input
    type="date"
    aria-label={t("filters.from")}
    className="w-40"
    onChange={(e) => setFrom(e.target.value)}
  />

  {hasActiveFilters && (
    <Button variant="ghost" onClick={clearFilters}>
      {t("filters.clear")}
    </Button>
  )}
</div>;
```

## 6. Modal / dialog — focus-correct, one primary action

`Modal` (`components/shared/Modal.tsx`) wraps the Radix Dialog: pass `open` +
`onOpenChange` for imperative flows (or a `trigger` for open-on-click), a `title`, and a
`footer` action row. Radix owns the focus trap, Esc-to-close, scroll lock and aria.

```tsx
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/ui/button";

<Modal
  open={open}
  onOpenChange={setOpen}
  title={t("cases.editTitle")}
  footer={
    <>
      <Button variant="outline" onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </Button>
      <Button type="submit" form="case-form" disabled={submitting}>
        {t("common.save")}
      </Button>
    </>
  }
>
  {/* form body — give the <form> an id and point the footer submit at it via form="…" */}
</Modal>;
```

Radix already traps focus, closes on Esc, and returns focus to the trigger —
**don't hand-roll a dialog** (a custom one usually breaks all three). For a destructive
confirm inline (delete a row), use `ConfirmAction` — not a bespoke modal:

```tsx
import { ConfirmAction } from "@/components/shared/ConfirmAction";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

<ConfirmAction title={t("cases.deleteConfirm")} okType="danger" onConfirm={() => remove(row.id)}>
  <Button variant="ghost" size="icon" aria-label={t("common.delete")}>
    <Trash2 className="h-4 w-4" />
  </Button>
</ConfirmAction>;
```

## 7. The state triad — every data surface ships all three

Loading, empty, AND error — not just the happy full-data view. This is the single
biggest "looks unfinished" fix.

```tsx
import { PageSkeleton, TableSkeleton, FormSkeleton } from "@/components/shared/Skeletons";
import { EmptyState } from "@/components/shared/EmptyState";

if (isLoading) return <TableSkeleton rows={8} />; // skeleton, not a bare spinner
if (error)
  return (
    <EmptyState
      description={t("common.loadError")}
      actionLabel={t("common.retry")}
      onAction={refetch}
    />
  );
if (!rows.length)
  return (
    <EmptyState description={t("cases.empty")} actionLabel={t("cases.new")} onAction={openNew} />
  );
// ...the table
```

Rules: loading is a **skeleton** matching the eventual layout (`PageSkeleton` /
`TableSkeleton` / `FormSkeleton`), never a centered spinner on a blank page. Error
states name the cause and offer **retry** — never a green success toast over a failed
request (honest feedback). Toasts come from `useNotify()`:
`const { success, error } = useNotify()`; call `error(...)` on a failed request, never
`success(...)`.

---

## 8. Accessibility rules an axe scan won't fully catch

axe catches missing labels and text contrast; it does **not** catch these — check them
by hand (they're frequent `/design-qa` misses):

- **Contrast:** body/UI text ≥ **4.5:1**; large text (≥24px or ≥18.66px bold) ≥ **3:1**;
  **non-text** (icon glyphs that carry meaning, input borders, focus rings, chart
  strokes) ≥ **3:1**. axe skips the non-text cases — verify icons and state borders.
- **Focus visible (WCAG 2.2):** the focus ring is ≥2px, ≥3:1 against the unfocused
  state, and the focused control isn't hidden behind a sticky header/footer. Keep the
  primitives' `focus-visible:ring-*` styles; don't `outline:none` them away.
- **Focus order + trap:** tab order matches visual order; in a modal, focus enters on
  open, is trapped, Esc closes, focus returns to the trigger. Test by keyboard — axe
  can't. (Radix `Dialog`/`Modal`/`ConfirmAction` do this; custom dialogs usually don't.)
- **Keyboard operability:** every control reachable and operable by keyboard; the Radix
  `Select` handles type-ahead + arrow keys for you. No keyboard trap outside an intended
  modal.
- **Labels:** every input has a programmatic label (`FormLabel`/`TextField` wire
  `htmlFor` → the control id); placeholder text is NOT a label. A bare `SelectTrigger`
  in a filter bar needs an `aria-label`. Required is conveyed by mark + message, not
  color. Errors are linked and announced — `FormControl` sets `aria-invalid` +
  `aria-describedby`, and `FormMessage` renders `role="alert"`.
- **Tables:** real header cells (`DataTable` columns emit `<th>`); don't convey
  header→cell association by visual alignment alone.

---

## 9. Brand contract — `brand.config.ts` (white-label)

One file owns the fork's identity: app name, brand colors, radius, density, and the
UI font. `app/tokens.css`, the layout, and the chrome all derive from it — **rebrand
here, never per-component**. `app/[locale]/layout.tsx` emits `brand.primary`/`accent`
as CSS custom properties (`--brand-primary`, `--brand-accent`) on `<html>`, and the
`@theme` block in `app/tokens.css` maps them to the `bg-primary` / `text-accent`
utilities. The font is loaded (Inter via `next/font`); to swap it, change the
`next/font` import in `app/[locale]/layout.tsx` AND `brand.font` (next/font needs a
literal `variable`; a lockstep test guards the pair). Brand hex lives in
`brand.config.ts` only — everything else pulls from the semantic utilities /
`app/tokens.css` custom properties (raw hex outside the token source is
`no-raw-hex-color`). Chart **series** colors are the one categorical palette that lives
apart, in `components/shared/chart-palette.ts` (ADR-029).

## 10. Branded data + detail components

Build list/detail screens from these, not raw primitives — they carry the brand + the
state chrome a "finished" app needs (all in `components/shared/*`):

```tsx
import { StatCard } from "@/components/shared/StatCard"; // KPI: chip + value + trend
import { SectionCard } from "@/components/shared/SectionCard"; // titled panel + subtitle + actions
import { DataView } from "@/components/shared/DataView"; // DataTable + toolbar + bulk + columns
import { DescriptionList } from "@/components/shared/DescriptionList"; // key/value detail
import { Toolbar } from "@/components/shared/Toolbar"; // filters (start) + actions (end)
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

<DataView<Case>
  columns={columns}
  dataSource={rows}
  rowKey="id"
  searchable
  onSearch={setQuery}
  total={total}
  page={page}
  pageSize={pageSize}
  onPageChange={setPage}
  toolbarActions={
    <Button onClick={openNew}>
      <Plus className="h-4 w-4" />
      {t("new")}
    </Button>
  }
  bulkActions={({ selectedRowKeys, clear }) => (
    <Button
      variant="destructive"
      onClick={() => {
        bulkDelete(selectedRowKeys);
        clear();
      }}
    >
      {t("delete")} {selectedRowKeys.length}
    </Button>
  )}
/>;
```

`DataView` composes `DataTable` (server pagination/search/sort) and adds a toolbar,
row selection with a bulk-action bar that appears on selection, and a column-visibility
control — don't hand-roll those on a bare `DataTable`. `StatCard` is the KPI card (chip +
value + trend pill); `SectionCard` is the titled panel when you need a subtitle or header
actions (never nest one Card inside another).

## 11. Branded status screens — `BrandedStatus`

404 / 403 / 500 / maintenance all render through one primitive (brand mark + headline +
copy + actions), so they stay consistent and rebrandable. The pages already exist
(`app/[locale]/not-found.tsx`, `forbidden/`, `maintenance/`, the dashboard `error.tsx`).
Reuse `BrandedStatus` for any new dead-end state instead of a bare, unbranded result
panel.

## 12. Product chrome (the app shell)

`AppShell` mounts the chrome: a ⌘K **command palette** (`CommandPalette`, also opened
from the header search button via the `OPEN_COMMAND_PALETTE` event), a **notifications**
bell (honest empty state until a feed is wired), and a single-tenant **workspace
switcher**. Auth pages use the branded **split-screen** layout. Don't rebuild these per
screen — they live in the shell.

## 13. Living showcase (states baseline for `/design-qa`)

The `/<locale>/style-guide` page is the living gallery: every primitive + the branded
components above, in one screen, viewed across the theme toggle (light/dark) and the
locale switch (LTR/RTL when `ar` is enabled). It's the `/design-qa` fidelity target.
For a fuller per-component catalog, add the **Storybook DX recipe**
(`docs/recipes/dx/1-storybook.md`) via `/scale-up` — it wires the theme (the
`app/tokens.css` tokens + the `[data-theme]` swap) and `next-intl` decorators so stories
render on-theme, on-locale. Kept out of the lean base (ADR-014); add it when a fork's
component set grows enough to warrant it.
