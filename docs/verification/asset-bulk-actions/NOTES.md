# Visual-iteration critique — Asset bulk actions (OPEN-ITEMS item 6)

V2-301 loop on the asset **list** after adding multi-select + bulk delete (T-app-floor).
Matrix: `{desktop,mobile} × {light,dark} × en`, captured against the local app (native
Postgres `d5fresh`, seeded) at `/en/asset` **with two rows selected** — the stock
`npm run capture` can't show this state (the bar only renders on a non-empty selection), so
the capture script adds a row-selection step before shooting.

## What the captures confirm

- **The bar appears only on selection** — no always-visible disabled control (UI DoD: no dead
  controls). It reads `2 selected` + a single `Delete selected` action.
- **Selection UI works end to end** — per-row checkboxes, the header select-all (indeterminate
  state visible), and selected-row highlighting all come from the shared `DataTable`'s existing
  `rowSelection` support (reused, not rebuilt — build-vs-buy).
- **Dark holds** (`*.dark.png`): bar surface, checkboxes, badges, and the destructive button are
  all on-token in both themes.
- **Responsive**: the mobile captures keep the bar legible above the table.
- Breadcrumb reads **"Asset"** (the item-1 humanization, still correct here).

## 10-point rubric (self-scored 10/10)

Grid alignment · hierarchy · **one primary action** (see the judgment call below) · state honesty ·
spacing rhythm · copy (all six strings through next-intl, `{count}` interpolated) · RTL (en-only
fork, N/A) · **dark** · responsive · a11y (native checkboxes carry labels; the destructive action
is a real `<button>` behind a Radix confirm dialog).

**Judgment call — the red `Delete selected` alongside the blue `New asset`.** Criterion 3 says one
primary action per screen. Kept the solid destructive variant deliberately: the two are not
competing CTAs for the same intent — `New asset` is the screen's standing primary, while the bulk
bar is a **transient, contextual mode** that only exists while a selection does, and a bulk delete
should read unmistakably destructive. Demoting it to an outline would understate a
high-consequence action. (Contrast with the V2-307 EmptyState fix, which demoted a _duplicate_
`New Asset` CTA — that was genuinely the same action twice; this is not.)

## Behavioral proof (not visible in pixels)

The ADR-010 invariant is verified separately at the service layer — 3 assets bulk-deleted →
**3 DELETE `audit_logs` rows** + all three **soft-deleted** (`deletedAt` set, rows still
physically present via `prismaUnfiltered` → recoverable from the recycling bin). A `deleteMany`
would have produced 0 audit rows and hard-deleted them. See the commit message and
`app/api/asset/bulk-delete/route.ts`.

Captures: `asset-list-selected.{desktop,mobile}.{light,dark}.png` beside this file.
