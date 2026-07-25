# Visual-iteration critique — Asset fields (items 4/5 + item 1 follow-up)

V2-301 loop on the Asset create/edit form after adding the **location** (T4) and
**warranty** (T6: expires + terms) fields. Matrix: `{desktop,mobile} × {light,dark} × en`
against the local app (native Postgres `d5fresh`, seeded), routes `/asset/new`.

## What the loop caught (and fixed)

1. **Breadcrumb dead-code bug (item 1).** The first capture showed the breadcrumb still
   rendering the **raw lowercase segment `asset`** — the item-1 `humanizeSegment` helper had
   been added but never wired into the fallback branch (`label = segment` was left in place;
   a `replace_all` missed the second, differently-indented occurrence). Fixed by pointing the
   `else` branch at `humanizeSegment` — the breadcrumb now reads **"Asset / Create"**. This is
   exactly the failure the "you MUST look at the pixels" rule exists to catch: item 1 had
   shipped green but visibly did nothing.
2. **New fields render correctly.** `Location` (text), `Warranty expires` (date), `Warranty
terms` (text) appear in the intended order (after Serial / after Purchased at), on the shared
   `TextField` primitive, in both themes.

## 10-point rubric (self-scored 10/10 after the fix)

- Grid alignment · hierarchy · **one primary action** (Save is the single blue CTA; Cancel is
  secondary) · state honesty (honest empty form) · spacing rhythm (consistent `gap-4`) · **copy**
  (humanized labels + enum labels "In stock"/"Laptop", no raw tokens) · RTL (en-only fork, N/A) ·
  **dark** (confirmed in `asset-new.desktop.dark.png`) · responsive (mobile captures present) ·
  a11y (every input carries an associated `FormLabel`).

Note: the "Cost center" / "Warranty expiry" inputs at the bottom are seeded **custom fields**
(T9 `CustomFieldDef`s in the throwaway DB), not the new native columns — unrelated seed data.

Captures: `asset-new.{desktop,mobile}.{light,dark}.png` beside this file.
