# Design recipes — build good UI on the first pass

The **proactive** companion to `docs/uat-rubric.md` (which scores UI *after* it's
built). `/design-system` drives this doc; `/design-qa` checks the result. Each
recipe is on-token (4px scale + theme tokens), RTL- and dark-correct, and built on
the shipped `components/shared/*` primitives — copy the pattern, change the content,
don't reinvent the layout.

> `docs/recipes.md` is **code** recipes (email, Excel, charts). **This** file is
> **design** recipes (layout, states, a11y). Different ruler, same spirit: reuse the
> blessed pattern instead of improvising.

Market scan (the patterns below are distilled from): Anthropic's `claude-design.md`
agent rules + the frontend-aesthetics cookbook, the design-review skill rubrics,
Ant Design / Material / Polaris / Carbon system guidelines, WCAG 2.2 AA, and the
"AI design slop" tell datasets. **We keep the bans, not the marketing flourish** —
an internal tool wants AntD's restrained, familiar dashboard defaults, not
characterful display fonts or atmospheric gradients.

---

## 0. The slop gate (self-check before you call UI done)

These are the recognizable AI-generated tells. **Four or more = heavy slop, rebuild.**
Each is also a Tier-1 `/design-qa` finding (anchor: `uat-rubric.md` Tier 0).

- [ ] Untouched framework-default styling (the "I didn't decide anything" look).
- [ ] Purple/violet→blue gradients on buttons/text/backgrounds; neon glow shadows.
- [ ] **Emoji used as icons** (especially in nav). Use `@ant-design/icons`, one family.
- [ ] Centered-everything: `place-items:center` / `margin:auto` as the default; a
      badge above the H1 + exactly three feature cards.
- [ ] **Nested Cards** (Card-in-Card) or a colored left-border accent on every card.
- [ ] All-caps eyebrow labels on every section; label spam.
- [ ] More than one accent color; five equal-weight primary buttons.
- [ ] Everything animated (bouncing/wiggling/floating) — motion without meaning.
- [ ] Off-scale spacing (`padding:13px`); fake-precise data (`94.2%`); dead controls.

Internal-tools positive direction: **one accent (`colorPrimary`), one primary action
per screen, generous-but-on-scale spacing, AntD's default density unless the screen
is genuinely data-dense, real content over decoration.**

---

## 1. Scale rules (the non-negotiable numbers)

- **Spacing:** every gap/margin/padding is a step on the 4px scale (`--space-*`) or a
  `--density-*` semantic. Group siblings with `gap` (Flex/Space/Grid), never bare
  margins between inline blocks.
- **Type:** off the type scale (`--font-size-*`); body 14px / line-height 1.57 (the
  AntD default, already set). Make heading→body jumps *large* (h3 24px over body 14px),
  not timid. `text-wrap: balance` on headings, `pretty` on body where supported.
- **Color:** from the theme (`colorPrimary`, neutrals) / CSS vars only — raw hex is an
  ESLint error. One accent for the whole app; retune it in `antd-theme.ts`, never
  per-screen.
- **Radius/motion:** one radius scale (`--radius-*`); motion durations off `--motion-*`.

---

## 2. Page header — `PageHeader`

The one title pattern: heading + optional one-sentence subtitle on the inline-start,
the screen's **single** primary action on the inline-end. RTL-mirrors automatically.

```tsx
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "antd";
import { PlusOutlined } from "@ant-design/icons";

<PageHeader
  title={t("cases.title")}
  subtitle={t("cases.subtitle")}            // one sentence: what this screen is for
  actions={
    <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
      {t("cases.new")}
    </Button>
  }
/>
```

Rules: exactly one `type="primary"` in `actions` (extra actions are `default`/`text`);
`level` keeps heading order correct (the app name is the h1, so a page title is `2`).
No eyebrow label above it — the page position already says what section this is.

## 3. Data table — `DataTable` (+ its empty state)

`DataTable` ships server pagination, debounced search, sort/filter callbacks, and an
`emptyText` slot. **Always pass a real empty state** — a blank table is the top
"unfinished" tell.

```tsx
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";

<DataTable<Case>
  columns={columns}
  dataSource={rows}
  rowKey="id"
  total={total} page={page} pageSize={pageSize}
  onPageChange={setPage}
  searchable onSearch={setQuery}
  loading={isLoading}                        // AntD renders its in-table loading
  emptyText={
    <EmptyState
      description={t("cases.empty")}         // WHY it's empty, not just "No data"
      actionLabel={t("cases.new")}           // the recommended next action
      onAction={openNew}
    />
  }
/>
```

Rules: columns use real `Table.Column` headers (scope is handled by AntD); keep the
table chrome calm (the theme already tunes header/row-hover neutrals); don't add a
second pagination or a custom search box — `DataTable` owns both. Empty-state copy is
**encouraging and explanatory**, never blames the user, and offers the primary action.

## 4. Form — vertical layout, one message slot

Default to **vertical** layout (label above field) — most robust to RTL and variable
label width. zod validates at the boundary; surface the message at the field.

```tsx
import { Form, Input, Button } from "antd";

<Form layout="vertical" form={form} onFinish={onFinish} requiredMark>
  <Form.Item
    name="title"
    label={t("cases.fields.title")}
    rules={[{ required: true, message: t("validation.titleRequired") }]}
    extra={t("cases.fields.titleHelp")}      // ONE help line; error replaces it inline
  >
    <Input maxLength={120} showCount />
  </Form.Item>

  {/* primary action bottom-inline-start; cancel is secondary/low-emphasis */}
  <Form.Item>
    <Button type="primary" htmlType="submit" loading={submitting}>
      {t("common.save")}
    </Button>
    <Button type="text" onClick={onCancel} style={{ marginInlineStart: "var(--space-2)" }}>
      {t("common.cancel")}
    </Button>
  </Form.Item>
</Form>
```

Rules: label→field gap stays on the 4–8px step (AntD vertical handles it); **don't
stack help text and an error** — the error replaces the help line. Required state is
conveyed by the mark *and* the message, never color alone. One primary submit.

## 5. Filter bar (over a table)

A single aligned row of filters above the table — not a wall of stacked controls.
Space them on `--density-control-gap`; a clear/reset is `text` type. The table's own
search lives in `DataTable searchable`; the filter bar is for structured filters
(status, owner, date range).

```tsx
import { Flex, Select, DatePicker, Button } from "antd";

<Flex gap="var(--density-control-gap)" wrap align="center" style={{ marginBlockEnd: "var(--space-4)" }}>
  <Select placeholder={t("filters.status")} options={statusOptions} allowClear style={{ minWidth: 160 }} />
  <Select placeholder={t("filters.owner")} options={ownerOptions} allowClear showSearch style={{ minWidth: 180 }} />
  <DatePicker.RangePicker />
  {hasActiveFilters && <Button type="text" onClick={clearFilters}>{t("filters.clear")}</Button>}
</Flex>
```

## 6. Modal / dialog — focus-correct, one primary action

```tsx
import { Modal } from "antd";

<Modal
  open={open}
  title={t("cases.editTitle")}
  onOk={form.submit} okText={t("common.save")}     // ONE primary action
  onCancel={close} cancelText={t("common.cancel")} // secondary, low-emphasis
  confirmLoading={submitting}
  destroyOnClose                                    // reset form state per open
>
  {/* form body */}
</Modal>
```

AntD Modal already traps focus, closes on Esc, and returns focus to the trigger —
**don't hand-roll a dialog** (a custom one usually breaks all three). For a
destructive confirm inline (delete a row), use `ConfirmAction` (Popconfirm wrapper),
not a bespoke modal.

## 7. The state triad — every data surface ships all three

Loading, empty, AND error — not just the happy full-data view. This is the single
biggest "looks unfinished" fix.

```tsx
import { PageSkeleton, TableSkeleton, FormSkeleton } from "@/components/shared/Skeletons";
import { EmptyState } from "@/components/shared/EmptyState";

if (isLoading) return <TableSkeleton rows={8} />;     // skeleton, not a bare spinner
if (error)     return <EmptyState description={t("common.loadError")} actionLabel={t("common.retry")} onAction={refetch} />;
if (!rows.length) return <EmptyState description={t("cases.empty")} actionLabel={t("cases.new")} onAction={openNew} />;
// ...the table
```

Rules: loading is a **skeleton** matching the eventual layout (`PageSkeleton` /
`TableSkeleton` / `FormSkeleton`), never a centered spinner on a blank page. Error
states name the cause and offer **retry** — never a green success toast over a failed
request (honest feedback).

---

## 8. Accessibility rules an axe scan won't fully catch

axe catches missing labels and text contrast; it does **not** catch these — check them
by hand (they're frequent `/design-qa` misses):

- **Contrast:** body/UI text ≥ **4.5:1**; large text (≥24px or ≥18.66px bold) ≥ **3:1**;
  **non-text** (icon glyphs that carry meaning, input borders, focus rings, chart
  strokes) ≥ **3:1**. axe skips the non-text cases — verify icons and state borders.
- **Focus visible (WCAG 2.2):** the focus ring is ≥2px, ≥3:1 against the unfocused
  state, and the focused control isn't hidden behind a sticky header/footer. Keep
  AntD's focus styles; don't `outline:none` them away.
- **Focus order + trap:** tab order matches visual order; in a modal, focus enters on
  open, is trapped, Esc closes, focus returns to the trigger. Test by keyboard — axe
  can't. (AntD `Modal` does this; custom dialogs usually don't.)
- **Keyboard operability:** every control reachable and operable by keyboard; custom
  widgets handle arrow keys. No keyboard trap outside an intended modal.
- **Labels:** every input has a programmatic label (AntD `Form.Item label` wires it);
  placeholder text is NOT a label. Required is conveyed by mark + message, not color.
  Errors are linked and announced (AntD does this when you use `Form.Item`).
- **Tables:** real header cells (AntD `Table` columns emit `<th>`); don't convey
  header→cell association by visual alignment alone.

---

## 9. Living showcase (states baseline for `/design-qa`)

For a rendered catalog of every primitive in all its states to diff against, add the
**Storybook DX recipe** (`docs/recipes/dx/1-storybook.md`) via `/scale-up` — it wires
the AntD `ConfigProvider` + `next-intl` decorators so stories render on-theme,
on-locale. Kept out of the lean base (ADR-014); add it when a fork's component set
grows enough to warrant a showcase.
