# Blueprint — JML slice S6: leavers, part 2

Scope: lib/jml/**, lib/validations/jml/**, app/api/jml/**, app/[locale]/(dashboard)/jml/**, components/jml/**, prisma/schema.prisma, prisma/migrations/20261027150000_jml_s6_settlement/**, prisma/migrations/20261027160000_jml_s6_documents/**, prisma/seed-jml.ts, prisma/seed-jml-documents.ts, prisma/jml-docs/**, scripts/jml-author-docs.mjs, lib/prisma/audit-extension.ts, scripts/neon-sql.mjs, eslint-rules/rules/no-restricted-export-column.mjs, tests/contracts/jml-settlement.test.ts, tests/contracts/jml-documents.test.ts, tests/contracts/jml-leave-reports.test.ts, docs/decisions/ADR-083-jml-word-documents.md, package.json, package-lock.json

Status: part of `docs/blueprints/jml.md` (slice 6), shipped in three PRs (S6a settlement,
interview and closure; S6b documents; S6c historical import, reports and the exit calendar).
Port spec: HR Offboarding §2.10–2.13, §2.17–2.21.

## S6a — settlement, interview, departure, closure

- **Settlement (§16.1, C2–C5):** gratuity ported exactly (four agreed conventions; T11–T13
  are contract tests), leave at the last day of service (negative = deduction, T16),
  outstanding salary, gross/net. Hire date and basic wage come from the core record (F18).
  All figures sealed in one envelope (`figuresEnc`, SALARY keyring, AAD bound to the case);
  lines sealed per line. Only `jml.viewSettlement` reads money; `jml.manageSettlement`
  calculates, adds lines and confirms payment; `jml.approveSettlement` approves — and only
  with verified statutory values (AC-10.8), referenced deductions (C4), every asset settled
  (AC-10.6) and BOTH Final Settlement Approval signatures (F5). F14: the O2 factor is
  effective-dated and counts toward "provisional".
- **Interview (§12.3–12.4):** codes validated against the configured taxonomy (F9: an
  admin-added code works, a deactivated one is refused); narrative sealed and never reported;
  assessment by `jml.assessExits`; changing the coded reasons clears the assessment.
- **Departure (D7):** the sweep revokes the login once the LPWD has ended and applies the core
  departure once the LDS has ended (`Employee.lastWorkingDay` = LDS, reports roll up);
  migrated history never departs anyone; withdraw undoes it (S5).
- **Closure:** gates satisfied/overridden + settlement approved and paid + departure applied
  (applied at closure when the LDS has passed). CASE_CLOSED.
- **Incidents (F16):** the daily scan now logs C5 too (calendar days from the LDS, one
  days-late function — F15).
- **Screens:** Interview and Settlement tabs, Close exit with its blockers listed, the exit
  reasons settings screen.

## Scenarios

- Happy: resignation, 1,887 days' service spanning the split → pre 798.904 + post split →
  line added → recalculated → both signatures → verified parameters → approved → paid →
  gates recorded → the sweep departs the employee → closed.
- Worst: Junior HR calculates → 403; approval with unverified parameters → refused naming
  them; a line after calculation → approval refused until recalculated; a code under the wrong
  category → refused naming its real parent; closing before the LDS → refused.

S6b (documents) is specified in `docs/blueprints/jml-s6b-documents.md`.
