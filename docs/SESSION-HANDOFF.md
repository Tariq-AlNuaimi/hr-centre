# Session handoff

Goal — close the QA "Next steps": run /design-qa on a local carbon-copy, fix or
wave-off, /ship, push. **DONE.**

State — branch `claude/template-qa-next-steps-2rbwtw`, tip `2aa5056`, in sync with
origin (0 unpushed). `/ship` GREEN. NOT landed on main (task branch rules say push
to the designated branch only; ask the operator before FF to `main`).

## Done this session (design-QA a11y tier)
Brought up a local authenticated carbon-copy (Postgres 16 :5433, seeded admin,
`next dev`) and ran the axe gate (`tests/uat/a11y.full.uat.ts`, full mode) on all 6
dashboard screens. Started RED (every screen had serious/critical axe violations);
ended GREEN on all 6. Eyeballed every screen light + dark — clean.

- `c3b2af2` fix(a11y): darkened AntD muted-text tokens (colorTextTertiary/Description/
  Placeholder) light+dark in `antd-theme.ts`; lifted empty-table/placeholder text in
  `globals.css` (mode-aware); aria-labels (audit-log Selects, style-guide inputs +
  Switches, DataView checkboxes via getCheckboxProps, DataTable search); named recharts
  pie `<Cell>`s + dropped pie `label`; data.selectRow in en+ar; scoped color-contrast
  OFF for the style-guide token-showroom route only.
- `2aa5056` fix(a11y): anchored the style-guide axe exemption to the depth-1 route
  (`^/[a-z-]+/style-guide/?$`) per senior review; documented 2 intentional trade-offs.

Senior-code-reviewer ran post-push: PASS (all contrast math confirmed AA; one Low =
the regex, now fixed). No open findings.

## Wave-offs / trade-offs (documented in docs/findings-register.md, none open/blocking)
- style-guide route is color-contrast-exempt (deliberate token showroom; product
  screens have NO exemption and are fully axe-clean).
- disabled-placeholder contrast now matches active (AA-first; state still signalled by
  border/bg). DataView checkbox label is generic "Select row" (not row-unique) — future pass.
- dashboard pie pac-man wedge = degenerate single-role seed artifact, not a defect.

## Next steps
1. **Operator decision (still open):** review the style-guide contrast exemption decision;
   if it should be landed on `main`, FF `claude/...` → main (verify origin/main is an
   ancestor first). Operator signs off UAT. — *Not actionable without operator sign-off;
   task-branch rules forbid touching `main` autonomously.*
2. ~~Optional: full UAT roles.setup EDITOR/VIEWER "DB upsert failed".~~ **RESOLVED this
   session.** Root cause: `uat:full` provisions role fixtures via Prisma *inside the
   Playwright process*, which reads `DATABASE_URL` from env — on a local carbon-copy that
   still pointed at the remote/unreachable DB, so the upsert failed and EDITOR/VIEWER were
   skipped. Fix: export the local `DATABASE_URL` to the `uat:full` command (now documented
   in `tests/uat/README.md`), and `roles.setup.ts`'s warning now names `DATABASE_URL` as
   the cause. Verified: stood up the local carbon-copy (PG :5433, migrated + seeded) and
   ran `--project=roles-setup` in full mode — EDITOR + VIEWER provisioned + authenticated
   (editor.json/viewer.json written), 4 passed, no "DB upsert failed".
3. Local carbon-copy recipe + landmines: docs/agent-memory.md (Postgres :5433, drive via
   `npm run uat` not the Playwright MCP, container restarts kill bg servers).
