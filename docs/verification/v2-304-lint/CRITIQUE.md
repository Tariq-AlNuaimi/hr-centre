# V2-304 — visual verification (spacing/typography lint)

**Change:** wired `rihal-template/no-arbitrary-className` at `error` and resolved the 3 pre-existing
arbitrary font-size hits. Two are legit sub-scale one-offs (escape-hatched, no pixels changed); one
was pulled onto the type scale.

| File                                      | Before                    | After              | Kind                                                                                     |
| ----------------------------------------- | ------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `components/layout/OrgSwitcher.tsx`       | `text-[15px]` monogram    | `text-base` (14px) | **on-scale token swap** (1px, imperceptible)                                             |
| `components/shared/BrandedStatus.tsx`     | `text-[56px]` hero code   | unchanged          | escape hatch — outsize display numeral, no token above `text-h1` (38px)                  |
| `components/layout/NotificationsMenu.tsx` | `text-[10px]` count badge | unchanged          | escape hatch — 10px keeps a 2-digit count inside a 16px dot; `text-xs` (12px) would clip |

## Captures (desktop + mobile × light + dark; en-only fork)

`/style-guide` exercises **all three** components in context:

- **OrgSwitcher** — top-left "M" monogram: balanced and legible at 14px, light + dark.
- **BrandedStatus** — "Status pages" section: **404** / **403** hero numerals render large and
  dominant (the escape-hatched `text-[56px]`), light + dark.
- **NotificationsMenu** — header bell; count badge unchanged.

(A `/dashboard` capture attempt 404'd — no such path; routes live under the `(dashboard)` group at
other paths — so only the `/style-guide` set is kept. That 404 page is itself `BrandedStatus
code="404"`, which the style-guide "Status pages" section already demonstrates.)

## 10-point self-critique (style-guide, the altered surface)

grid ✓ · hierarchy ✓ (404/403 dominate their cards) · one-primary N/A (reference page) ·
state-honesty ✓ (empty/error states shown) · spacing-rhythm ✓ (on-scale) · copy ✓ · RTL N/A
(en-only) · dark ✓ (tokens hold) · responsive ✓ (mobile captured) · a11y — the floating "1 Issue"
chip is the Next.js dev overlay, not app UI.

**Verdict:** no visual regression. The monogram token swap is imperceptible and on-scale; the two
escape-hatched values are unchanged and justified inline. Gate is live at `error` with 0 residual
violations.
