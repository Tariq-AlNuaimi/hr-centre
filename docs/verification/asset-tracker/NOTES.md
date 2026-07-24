# Visual-iteration critique — Asset Tracker (V2-301 evidence)

The V2-301 loop on the pilot's list + create-form screens: **capture → view → critique →
fix → re-capture**. Two distinct capture sets live beside this file (en only — `ar` inert per
`project.config.json` `locales: ["en"]`):

- **Full matrix (top level of this dir):** `{asset,asset-new} × {desktop,mobile} × {light,dark}`
  — 8 files (`asset.desktop.light.png`, `asset.mobile.dark.png`, …). This is the complete
  V2-301 matrix for the pilot.
- **Focused before/after subset (`before/`, `after/`):** the DESKTOP-only pair used for the
  specific enum-humanization fix comparison — `before/` = 2 files (`asset.desktop.light`,
  `asset-new.desktop.light`), `after/` = 3 (`asset.desktop.{light,dark}`, `asset-new.desktop.light`).
  These are deliberately a subset — one change, held to the desktop cells where the enum tokens
  were visible — NOT the full matrix.

Produced by `npm run capture -- --feature asset-tracker/<phase> --routes /asset,/asset/new`
against a locally-run app (agent-memory "browser QA & egress" 2026-07-17 recipe).

## Self-critique of the BEFORE captures (10-point rubric, V2-307)

Scored the `before/` set against the rubric. The one clear, high-value defect:

- **Copy (FAIL → fixed):** the Status/Category controls surfaced **raw enum tokens** —
  `IN_STOCK`, `LAPTOP`, `ASSIGNED`, … — in the create-form selects (`before/asset-new.*`) and
  (with data) the list badges. Users must never see DB enum spelling.
- Grid/hierarchy/one-primary-action/state-honesty/spacing/dark/responsive: **PASS** — the
  scaffolded screens compose the shared `DataTable`/`PageHeader`/form primitives correctly;
  honest empty state; one primary action; dark + mobile hold.
- **a11y:** not axe-scanned in this pass (deferred to `/design-qa` Tier-1 with the bridge).

## The fix (AFTER)

`components/asset/asset-labels.ts` — a humanized label map (`IN_STOCK → "In stock"`,
`LAPTOP → "Laptop"`, …) applied in `AssetColumns.tsx` (badges + filter text) and
`AssetForm.tsx` (select options). DB/API keep the enum values; only display is humanized.

- `after/asset-new.desktop.light.png` — Status now reads **"In stock"**, Category **"Laptop"**.
- `after/asset.desktop.{light,dark}.png` — list badges read **Assigned / In stock / In repair /
  Retired** and **Laptop / Monitor / Phone**, tone-colored, in both themes (4 seeded rows).

## Residual (logged, not fixed here — kept the before/after to one change)

- Breadcrumb shows the raw route segment `asset` (lowercase) instead of a label like "Assets" —
  a route-segment humanization, tracked as a follow-up (findings register).
- The enum-humanization should ideally be **scaffold-emitted** (so every generated entity gets
  it) and eventually flow through next-intl messages (V2-305 copy chokepoint) — follow-up.
- The `1 Issue` chip bottom-left is the Next.js dev overlay (dev-only), not shippable UI.
