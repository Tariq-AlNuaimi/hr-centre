# V2-305 — visual verification (copy chokepoint + copy lint)

**Change:** wired `no-literal-jsx-text` (the 13th ESLint rule, chokepoint → next-intl) + the
`/ship` `copy` gate, and migrated 22 Title-case labels in `messages/en.json` to sentence case. The
copy migration is the only visible change (values only; no layout/color).

## Captures (desktop + mobile × light + dark; en-only fork)

`/users` and `/audit-log` exercise the migrated strings in the sidebar chrome + page bodies:

- **Sidebar nav** — "Home", "Users", **"Audit log"**, "Assets", **"Recycling bin"**, "Settings":
  sentence case, consistent, light + dark.
- **Primary action** — "**+ Create user**" (was "Create User") — sentence case, one primary per
  screen.
- **Table headers** — "**Last login**" (was "Last Login"); "**Entity ID**" correctly preserved
  (acronym, not Title Case).
- **Filter bar** — "Filter by entity" / "Filter by action" already sentence case; hold.
- **State honesty** — "No data found" empty state on the audit log; honest.

## 10-point self-critique (the altered surface)

grid ✓ · hierarchy ✓ · one-primary ✓ ("+ Create user") · state-honesty ✓ (empty state) ·
spacing-rhythm ✓ · **copy ✓ (the point — sentence case is now consistent across nav, headers,
buttons, columns; matches the Linear/Vercel voice in `design-references.md`)** · RTL N/A (en-only) ·
dark ✓ (tokens hold, copy identical) · responsive ✓ (mobile captured) · a11y — floating "1 Issue"
chip is the Next dev overlay, not app UI.

**Verdict:** no regression; the copy reads as one consistent sentence-case voice. `no-literal-jsx-text`
lands at 0 product-code violations (app already fully next-intl'd), and the `/ship` `copy` gate is
green on the migrated `messages/en.json`. Copy gate RED-proof (`"Submit Request."` → 2 findings)
verified separately and reverted clean.
