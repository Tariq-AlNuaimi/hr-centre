# Blueprint — JML slice S5: leavers, part 1

Scope: lib/jml/**, lib/validations/jml/**, app/api/jml/**, app/[locale]/(dashboard)/jml/**, components/jml/**, prisma/schema.prisma, prisma/migrations/20261027140000_jml_s5_leavers/**, prisma/seed-jml.ts, prisma/seed-jml-leave.ts, prisma/seed-jml-leave-data.ts, lib/prisma/audit-extension.ts, scripts/neon-sql.mjs, eslint-rules/rules/no-restricted-export-column.mjs, tests/contracts/jml-leavers.test.ts

Status: part of `docs/blueprints/jml.md` (slice 5). Decisions D3 (one asset/access register),
D6 (one notification mechanism), D7 (departure milestones — applied in S6), D13 (the line
manager is an employee), D14 (leaver money is Restricted). Port spec: HR Offboarding §1–§2.16.

## What this slice delivers

- **Schema:** `LeaveCaseDetail` (exit type/subtype, Omani/expatriate branch, the three-date
  model + departure date, notice and its override reason — now stored, documentation refs,
  backfill/rehire, snapshots of the employee at exit, re-key and departure milestones),
  `JmlApproval` + `JmlApprovalAuthority` (five §4.3 types; delegates are employees),
  `JmlAssetType`, `JmlAsset` (issued on one case, returned on another; deduction amount sealed),
  `JmlAccessChecklistItem`, `JmlAccessItem` (GRANT/REVOKE), `LeaveGateRecord`,
  `LeaveComplianceIncident`. CHECKs: notice days 0–365, LPWD ≥ notice start, LDS ≥ LPWD,
  departure only for expatriates, gate ids C1–C11.
- **Seed (real config, idempotent):** "Baseline offboarding — Full" (50 tasks) and "— Light"
  (47; F24), the 26-item access checklist, the two asset types. No cases.
- **Exit drafts:** the employee is picked; job, grade, placement, employment type, nationality
  branch and line manager come from the record and are snapshotted (refreshed at activation).
  `EXIT-YYYY-NNNN` at creation. A draft generates nothing (AC-1.1).
- **Activation:** every blocker at once (F12: date rules re-run), owner from the assignment
  rule, FULL/LIGHT by employment type and nationality scope (F11), tasks on the working
  calendar, one REVOKE item per active checklist row due the LPWD (decision date for a summary
  dismissal), the employee's outstanding assets attached for return, CASE_ACTIVATED (F3).
- **Dates:** change on draft or live; only open tasks on a moved basis recalculate; revocation
  items and asset due dates follow the LPWD; moving only the LPWD needs early release approved
  (flag, or the granted Early Release approval); RECALCULATION_NOTICE to the owners. Exit type,
  branch and notice are written (the source validated and dropped them).
- **Approvals (F5):** all five types requestable and decidable; HR records the holder's
  decision with a reference (grant) or reason (refusal); delegate / second-level claims checked
  against the authority; Final Settlement Approval is two rows (read by S6).
- **Compliance gates C1–C11:** record satisfied with a reference, or override (`jml.overrideGates`,
  reason, own audit row); C8 needs the position classification; monthly override report.
- **Register (D3):** assets and access on any case — issued/granted on a joiner, returned/revoked
  on a leaver; deduction amount only by `jml.manageSettlement`, sealed (SALARY keyring, AAD
  `jml:asset:<id>:deductionAmount`), read back only with `jml.viewSettlement`; write-off (F6);
  asset types served to every HR user (F7); rotation items cannot close by another account's
  disablement.
- **Withdraw:** open tasks cancelled, `REV-<code>` reversal tasks with `reversalOfId` set (F13)
  workable on the cancelled case, a departure already applied undone via `reverseDeparture`, a
  login revoked at the LPWD restored. Archive (soft, F1) refused while reversals are open.
- **Re-key (§26.1):** a back-dated draft (notice start ≤ 365 days ago) activates with every
  task already due answered — done on a real date, not applicable with a reason, or still
  outstanding.
- **Sweep (F3/F4/F16):** hourly case health (RAG; AT_RISK when > 3 working days late or a
  statutory deadline breached; PENDING_SETTLEMENT at Stage 4 with a settlement); at 08:00
  Muscat the leaver overdue digest, > 3-day escalations to owner + senior, statutory watch
  (visa cancellation ≤ 3 working days) to owner + HR managers, approval reminders > 2 working
  days, and the incident scan (C7 now; C5 joins with the settlement in S6). Stages already
  advance from blocking tasks (S2).
- **Screens:** Leavers list + Open an exit; case tabs Approvals, Compliance, Assets & access;
  Overview with exit dates/details dialogs, activation panel and re-key; Withdraw; settings for
  approval authority, asset types and the access checklist; the override report.

## Scenarios

- Happy: resignation keyed with 60 days' notice → activate → 47/50 tasks, 26 revocation items,
  the laptop issued at joining attached for return → LPWD moved later → 12 due dates move and
  the owners are told.
- Worst: summary dismissal without the three references and both signatures → activation lists
  all four blockers; LPWD moved earlier without early release → 422 naming the approval;
  Junior HR sends a deduction amount → 403; a rotation item "covered by AD disablement" → 422;
  withdraw after revocations → reversal tasks, archive refused until they are done.

## Deferred to S6

Closure (gates + settlement + departure), the LPWD login revocation and LDS departure, the
settlement/gratuity, exit interview, documents, historical import and reports R1–R8.
