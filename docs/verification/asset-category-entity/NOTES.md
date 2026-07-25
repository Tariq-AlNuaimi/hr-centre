# Visual-iteration critique — Category enum axis retired (OPEN-ITEMS item 7)

V2-301 loop on the asset **list** + **create form** after removing the legacy `category` enum
axis, leaving the `Category` **entity** (via `Asset.model → AssetModel.category`) as the single
source of truth. Matrix: `{desktop,mobile} × {light,dark} × en`, local app (native Postgres
`d5fresh`, seeded catalog: Laptop / Monitor / Phone).

## What the captures confirm

**List (`asset.*.png`)** — the Category column is now **derived from the catalog**:

- `MON-0001` → **Monitor**, `LAP-0001` / `LAP-0002` → **Laptop** — read through
  `model → AssetModel.category → Category`, not from any column on the asset.
- `SEL-001/2/3` (seeded without a model) → **"-"**. This is the honest consequence of the change
  and is deliberately NOT papered over: an asset with no model genuinely has no category now.
  Previously every asset carried a `LAPTOP` default whether or not it meant anything — a value
  that looked like data but wasn't.
- The column **lost its sort arrows** (correct: `SORTABLE_COLUMNS` covers scalar columns only,
  and `category` is no longer one) and **kept its filter icon**, now backed by the Category
  entities fetched from `/api/category`.
- Category badges render **untoned** (neutral) while Status keeps its semantic tones — catalog
  categories are operator-authored and open-ended, so a fixed tone map would be arbitrary.
- CSV hint updated to `Columns: assetTag, name, serial, status` (no `category`).

**Form (`asset-new.*.png`)** — the enum `Category` select is **gone**. The remaining path is the
single catalog cascade: `Model category → Model manufacturer → Model`. One category axis, not two.

## 10-point rubric (self-scored 10/10)

Grid alignment · hierarchy · one primary action (Save / New asset unchanged) · **state honesty**
(the `-` for model-less assets is the point, not a gap) · spacing rhythm · copy (all through
next-intl; the CSV hint no longer advertises a removed column) · RTL (en-only fork, N/A) ·
**dark** (confirmed in `*.dark.png`) · responsive (mobile captures) · a11y (unchanged primitives).

## Behavioral verification (not visible in pixels)

Against the live DB:

- Derived category resolves: `LAP-0001 → Laptop`, `LAP-0002 → Laptop`, `MON-0001 → Monitor`.
- The new server-side filter shape `where: { model: { categoryId } }` returns exactly
  `LAP-0001, LAP-0002` for the **Laptop** category — correctly excluding the monitor.
- `/api/category` GET is `withAuth` (not admin-gated), so the filter options populate for every
  authenticated role, including VIEWER.

## Deliberately NOT done here — phase 2

The `Asset.category` **column still exists in the database**. This change is phase 1 of an
expand/contract migration (stop reading/writing). Dropping the column in the same release would
break any instance still running the previous code mid-deploy, because `vercel.json` runs
`prisma migrate deploy` on **every** build. Phase 2 — delete the field + the `AssetCategory` enum
and ship the `DROP COLUMN` — is tracked as an open item in `docs/findings-register.md`. Until
then new rows simply take the column's `@default(LAPTOP)`, which nothing reads.

Captures: `asset.{desktop,mobile}.{light,dark}.png` + `asset-new.{desktop,mobile}.{light,dark}.png`.
