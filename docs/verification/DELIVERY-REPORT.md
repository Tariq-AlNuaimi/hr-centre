# Delivery report — the PMS against the specification

**Date:** 2026-08-26 · **Commit:** `09289f7` on `main` · **Live:**
<https://rihal-performance-management.vercel.app>
**Specification:** `docs/PMS_Functional_Specification_v1.0.docx` — the operator re-supplied it this
session; `sha256` is byte-identical to the in-repo copy, so the target has not moved since the
2026-08-25 red team measured against it.

## What this report measures, and why that is the whole question

The 2026-08-25 conformance report said §1–§14 and Appendix A were built and marked every clause ✅.
The red team's verdict on it was: **"true as written and misleading as read."** It measured one
thing — does an implementation exist, with a clause-named test — and by that measure it was accurate.
But eleven write endpoints had no caller anywhere in the user interface. The logic was complete,
tested, and unreachable. No employee could fill in a 360, because there was no form.

So this report is built on the second measure, and states it up front:

| Measure         | What it answers                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| **Implemented** | The clause has code and a clause-named test.                                                                 |
| **Reachable**   | The clause's flow can be completed **by the role the clause names**, in a browser, without a database write. |

A test that imports a route module and calls it _supplies the caller whose absence is the defect_, so
no test in this repo can see the second measure. Where this report claims Reachable, it means someone
signed in as that role and did the thing. Where it does not, it says so.

## Verdict

**Every deliverable in §1–§14 and Appendix A is built, and every flow is now reachable by its named
role.** One item is outstanding and it is not code: §5.5's reminders and §9.7's invitations need an
SMTP provider. Three specification ambiguities remain open questions for Rihal, unchanged and
deliberately unresolved.

Two things this verdict does **not** say, and the reason the last report failed is that it blurred
exactly these:

- It does not say the system has been accepted by Rihal. No clause here has been through UAT with the
  HR team who wrote the specification.
- It does not say every screen was exercised on **production**. Production was verified at the
  infrastructure level only — see "What was not verified" below.

## 1. Reachability, mechanically

`scripts/reachability.mjs` (new this session) cross-references every write verb on every API route
against the client call sites, **verb-aware**: a GET caller must not make a POST look reachable, which
is exactly how F11 hid. Run it with `node scripts/reachability.mjs`; it exits non-zero on an
unexplained miss.

```
42 (route, verb) pairs · 40 with a UI caller · 2 cron-only by design · 0 UNREACHABLE
```

The two cron-only routes are `/api/internal/audit-purge` and `/api/internal/cycle-sweep`, allowlisted
**with the name of their non-UI caller** (`crons` in `vercel.json`), so "nothing calls it" can never
be the silent answer.

What this check cannot see, stated so the number is not read as more than it is: it matches paths,
not behaviour. A call site behind a button nobody can reach still counts. It is a floor, not a proof
— the proof is §2 below.

## 2. Reachable by the named role — live evidence

Signed in as six different people against a local Postgres running commit `09289f7` with the full
seed and demo fixture. Not as HR six times: as HR, as HRBP, as an executive viewer, as a line
manager, and as an ordinary employee.

### §4.1's permission matrix, as the product actually behaves

| Signed in as     | `pmsRoles` resolved             | Calibration | Year-end    | Import       | Executive   | Reports     |
| ---------------- | ------------------------------- | ----------- | ----------- | ------------ | ----------- | ----------- |
| Fatma Al-Rashdi  | `HR_SUPER_ADMIN`                | ✅          | ✅          | ✅           | ✅          | ✅          |
| Yousuf Al-Amri   | `HRBP`                          | **refused** | **refused** | ✅ (preview) | ✅          | ✅          |
| Hamed Al-Maskari | `EXECUTIVE_VIEWER`              | **refused** | **refused** | **refused**  | ✅          | ✅          |
| Muna Al-Shukaili | `HR_SUPER_ADMIN` + line manager | ✅          | ✅          | ✅           | ✅          | ✅          |
| Ali Al-Ghafri    | _(none)_ — ordinary employee    | **refused** | —           | **refused**  | **refused** | **refused** |

The refusals are sentences, not blank screens: "Calibration is HR Super Admin only — HRBP does not run
calibration"; "Employee import is available to HR only"; "This dashboard is for HR and top
management — your own team's status is on the My team screen." The sidebar is trimmed to match, so an
ordinary employee sees five entries where HR sees seventeen.

§4.1's hardest line holds: **HRBP is refused calibration and the master export while keeping org-wide
sight**, which is the one place the two HR roles diverge.

> **A correction worth recording.** My first automated pass reported an ordinary employee reaching
> `/executive` and `/admin/import` "ok", and HR being refused `/admin/roles`. Both were artefacts of a
> crude text heuristic — the roles screen contains the words "HR super admin" as a _table value_, and
> the refusal pages phrase themselves in words my pattern missed. I read the actual rendered pages
> before writing this table. An automated permission sweep that greps for refusal words will lie to
> you in both directions.

### The flow the red team called the sharpest failure

§9.7 — "no employee can fill in a 360; there is no form" — performed end to end **as the rater**:

1. Layla Al-Habsi signs in. Her home page carries **"360 assessment of Zainab Al-Lawati · Locks
   10/10/26 · HR asked you to assess them"** — §4.4's "driven by assignment, not hierarchy", which was
   finding F7.
2. She opens it from there, and gets §9.2's four scored questions plus one open-ended, on §9.3's
   **four-point scale with no middle option** ("Strongly disagree / Disagree / Agree / Strongly
   agree").
3. She answers, comments, submits.
4. A second attempt is refused: **"This assessment has already been submitted (§9.7)"** — the clause's
   own duplicate-submission rule.
5. The database holds five responses and one comment, and the audit row reads
   `Assignment · UPDATE · layla.alhabsi@rihal.example · {status: NOT_STARTED → SUBMITTED, submittedAt: …}`.

That last line is worth pausing on. Until this session that audit row recorded `changes: null` — the
route writes inside a transaction, and the audit extension wrote on the wrong client. §12.2's trail
now says _what moved and who moved it_ for the exact write it previously could not describe.

### §13.2's publish gate, from the employee's side

Ali Al-Ghafri's scorecard reads **"Results are not out yet — HR releases everyone's results at the
same time. Nothing is shown until then."** No score, no band, no partial figure. §13.2's "hidden
entirely until HR Super Admin explicitly publishes" is a property of what the server sends, not of
what the screen draws.

## 3. Deliverables, section by section

| §        | Deliverable                                                      | Built       | Reachable by          | Evidence                                                                                                                       |
| -------- | ---------------------------------------------------------------- | ----------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| §1.2     | Three entities, department⇒entity, C-Level tagged direct         | ✅          | HR                    | Org setup; §1.2's exclusive-or enforced in schema, zod and a DB CHECK                                                          |
| §1.3     | Five role tracks drive the formula                               | ✅          | HR                    | `roleTrack` on the employee record; §8.3's weight table keyed on it                                                            |
| §2       | Annual cycle, three touchpoints, HR sets hard-lock deadlines     | ✅          | HR                    | `/admin/cycles`                                                                                                                |
| §3.1–3.2 | Excel source of truth; Odoo ID the permanent key                 | ✅          | HR                    | `/admin/import`; `odooId` absent from the update schema by design                                                              |
| §3.3     | Every required employee field                                    | ✅          | HR                    | **Date of Joining was write-only via import until this session (F13)** — now on the record and editable                        |
| §3.4     | Six import validation rules, row-level rejection                 | ✅          | HR                    | Import preview reports per-row failures                                                                                        |
| §3.5     | Re-import: new → create+enrol, changed → update, absent → no-op  | ✅          | HR                    | Appendix A's "silence is never destructive"                                                                                    |
| §4.1     | Role matrix, additive roles                                      | ✅          | all five roles        | §2's matrix above — measured, not read                                                                                         |
| §4.2     | Hierarchical visibility; act only on direct reports              | ✅          | line manager          | `visibilityDescendants` + `canActOnEmployee`; 404-not-403 so ids are not an existence oracle                                   |
| §4.4     | My Tasks driven by assignment                                    | ✅          | employee, rater       | §2 above (F7)                                                                                                                  |
| §4.5     | Salary visible to HR + executives only                           | ✅          | —                     | Enforced in the `select`, so an unentitled payload never carries it; **also encrypted at rest** (ADR-067, stronger than asked) |
| §5.1     | Draft → both sign → **HR approves → HR approval is the lock**    | ✅          | manager, employee, HR | **F11 — the approve button did not exist until this session**                                                                  |
| §5.2     | Six texts per KPI                                                | ✅          | manager               | KPI form                                                                                                                       |
| §5.3     | No reject button; exactly 100% to sign                           | ✅          | employee              | Unsigned state is the signal; the 100% gate is the server's boolean, never a client re-sum                                     |
| §5.4     | Hard locks; "Employee did not sign" → HR review                  | ✅          | HR                    | The approval panel names this basis **before** the click                                                                       |
| §5.5     | Escalation ladder, skip-level, HR                                | ✅ (logged) | —                     | **Notifications need SMTP — see "Outstanding"**                                                                                |
| §5.6     | Manager compliance record                                        | ✅          | HR                    | `/reports`                                                                                                                     |
| §6       | Mid-year change request, multi-edit, mandatory rejection reason  | ✅          | manager, HR           | `/mid-year`; §6.3's version history archived, never overwritten                                                                |
| §7       | Self-assessment, manager rating, divergence reason, both sign    | ✅          | employee, manager     | `/year-end`                                                                                                                    |
| §8       | Weight table, 1–5 scale, band mapping                            | ✅          | HR                    | Exact per §8.3/§8.7; `Decimal` throughout                                                                                      |
| §9       | 360: cycle, templates, mapping, assignment, execution, results   | ✅          | HR, rater             | §2 above                                                                                                                       |
| §9.5     | Average the ratios × 5                                           | ✅          | —                     | **How many raters it averaged is now stored** (F8) and shown at calibration                                                    |
| §10      | Target distribution, curve guidance, manual override with reason | ✅          | HR Super Admin        | Raw score never overwritten (§10.1); HRBP refused                                                                              |
| §11      | Eligibility gate, coefficients, pro-ration, confidentiality      | ✅          | HR                    | §11.7 flags a missing Date of Joining rather than guessing                                                                     |
| §12      | Leaver, manager change, transfer split                           | ✅          | HR                    | `/admin/edge-cases`                                                                                                            |
| §13      | Scorecard, publish gate, manager workspace, reports, executive   | ✅          | all                   | §2 above                                                                                                                       |
| §14      | v1 Excel in / Excel out, no Odoo                                 | ✅          | HR                    | `read-excel-file` / `write-excel-file` (ADR-066)                                                                               |
| App. A   | Ten design invariants                                            | ✅          | —                     | Each is enforced somewhere specific; "audit everything sensitive" is what ADR-068 closed this session                          |

## 4. What this session changed

| Finding        | Severity      | Was                                                                                                                                                                         | Now                                                                                                                                                      |
| -------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F11**        | CRITICAL §5.1 | HR approval had no button. `year-end-signoffs` refuses without it, so §7→§8→§10→§11→§13 were shut for the whole company.                                                    | Approve panel, guarded, naming which of §5.1's two routes to a lock applies.                                                                             |
| **F12**        | MEDIUM §3     | `PUT /api/employees/[id]` had no caller. HR could not fix a name without a re-import.                                                                                       | Edit form bound to the route's own schema.                                                                                                               |
| **F13**        | HIGH §3.3     | Date of Joining had one writer — the import. Invisible on every screen, while §11.7 refuses a bonus without it.                                                             | On the record, editable, with the DB's own CHECK constraints mirrored as field messages.                                                                 |
| **F8**         | MEDIUM §9.5   | A score from one rater was indistinguishable from one from three.                                                                                                           | `threeSixtyRaterCount` stored; on the §13.5 export and as a caution at calibration. Not on the employee's scorecard — §13.1 forbids component breakdown. |
| **F7**         | MEDIUM §4.4   | My Tasks omitted 360 assignments.                                                                                                                                           | Fixed; verified as the rater. This document had it marked open after the fix; corrected.                                                                 |
| **ADR-068**    | —             | An audit row survived a rolled-back transaction; a **soft delete inside a transaction wrote its data outside it**.                                                          | Both extensions write on the transaction. A fourteenth ESLint rule makes the bare `$transaction` an error.                                               |
| audit symmetry | —             | Five `recordAudit` callers named fields on one side only, so §6.2's decider and §13.2's reversal reason never reached `changes`. One asserted a column that does not exist. | Symmetric; pinned by assertions verified to fail against the old code.                                                                                   |

## 5. Outstanding

**§5.5's reminders and §9.7's invitations need an SMTP provider.** This is the only outstanding
deliverable and it is not code. Verified against a local SMTP sink this session: with the five
variables set, `isEmailEnabled()` returns true, the transport connects, and the message is delivered
with correct headers. The compliance record is written either way, so the current degradation is "the
log is right, nobody was told". Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and
`SMTP_FROM` on the deployment; nothing in the repo changes.

## 6. What was NOT verified — read this before trusting the rest

- **Production was verified at the infrastructure level only.** The build log shows all 18 migrations
  applied (`20260826120000_pms_three_sixty_rater_count` applied on the `9d2f5ec` deploy; the
  production build reports "No pending migrations to apply"), `/api/health` returns `db: ok`, and the
  login page serves. **No flow in §2 was driven against production** — every browser result in this
  report is from a local server running the same commit. The operator chose this rather than put
  production credentials in an agent session. A production UAT is a separate, deliberate act.
- **No accessibility audit was run this session.** `axe-core` is not installed in this checkout. The
  new markup composes primitives that passed a prior axe pass and uses `role="status"`/`role="alert"`
  on live regions, but that is a reasoned expectation, not a measurement. `/design-qa` is the tier.
- **Mobile viewports were captured, not audited.** Dark and light at desktop and mobile exist for the
  two screens this session added; the rest of the product has not had a viewport pass.
- **SSO is built but has never authenticated anybody.** The Entra provider added in §7 is registered
  only when its three env vars are set, and no environment this session could reach has an IdP. What
  is verified is the claim mapping (unit test), the provider's absence when unset, and the existing
  soft-deleted-user guard. Whether Rihal's tenant issues the group claims `mapSsoRole` reads is
  unknown until IT configures it.
- **No load, concurrency or data-volume testing.** The fixture is 37 people. §10.3's curve, §13.5's
  export and the score run have never been exercised at, say, 500.
- **"Verified" here means implemented, tested, reviewed, and driven by the named role.** It does not
  mean accepted by Rihal.

## 7. A gap this pass raised — and then closed: employees could not sign in

Not a specification violation, but it was the largest practical gap between this build and use, and
it is the reason the previous conformance report could say "every screen-run was an HR Super Admin".

**What was wrong.** The system was credentials-only (SSO providers were removed on 2026-08-21). A
person could sign in only if a `User` row existed, and the only things that created one were the
bootstrap seed and `POST /api/users` — one person at a time through `/users/new`. **Applying an
employee import created no logins.** In the 37-person fixture exactly one person could sign in until
this session provisioned five more by hand. §3.3 lists Email as "for login/notifications"; §4.4's My
Tasks, §13.1's scorecard and §9.7's rater invitations each presuppose an account.

**What the operator decided** ("fix it ofcurse and add sso, also we have two useres, hr users and
normal users i think this is also a gap") and what now ships — ADR-069:

|                   | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                       | Verified by                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Import provisions | Every employee the apply CREATES gets a linked `User`, in the same `auditedTransaction` — a failed apply provisions nobody                                                                                                                                                                                                                                                                                      | `pms-import-provisioning.test.ts` case 1, mutation-checked |
| No password       | `passwordHash` stays null. `authorize()` returns null without a hash, so credentials sign-in is _impossible_ for these accounts, not weakly possible                                                                                                                                                                                                                                                            | same test, asserted explicitly                             |
| Least privilege   | `role: "VIEWER"`. Appearing in an HR spreadsheet never mints a platform administrator; §4.1 authority stays a deliberate grant at `/admin/roles`                                                                                                                                                                                                                                                                | same test                                                  |
| LEAVERs excluded  | §12.1 preserves a leaver's record and history, not their access                                                                                                                                                                                                                                                                                                                                                 | case 2                                                     |
| Re-import safe    | A hand-made ADMIN account keeps its role, its password and its link through an import (§3.5 makes re-importing routine); a soft-deleted (off-boarded) account neither collides with the unique email index nor gets resurrected                                                                                                                                                                                 | cases 3 and 4, both mutation-checked                       |
| SSO               | Microsoft Entra, registered only when all three of `AUTH_ENTRA_ID`, `AUTH_ENTRA_SECRET`, `AUTH_ENTRA_TENANT_ID` are set — an unconfigured deployment is byte-for-byte unchanged. `mapSsoRole` promotes only on explicit group membership, else `VIEWER`, and only for an account SSO itself creates — an existing account keeps its stored role, so a misconfigured group list cannot demote the administrators | `sso-role-map.test.ts`, 6 cases                            |
| The second gap    | The two role systems stay two (ADR-065 was right); what was missing is that the rule was never written and neither screen showed the other's fact. `/admin/roles` now carries a **Can sign in** column                                                                                                                                                                                                          | ADR-069 §7; `hasLogin` on the employee serialiser          |

The demo fixture is **seeded**, not imported, so `prisma/seed-pms.ts` provisions on the same rule — a
re-seed of the local database created 22 logins on the first run and 0 on the second. The rule is a
property of an employee record existing, not of the route that created it.

**The honest residual, and what it means for next week.** With no IdP configured and no SMTP (F9), a
provisioned account is a _shell_: the row exists, nothing can authenticate against it, and that is
deliberate — seeding thirty-six shared passwords to make a demo convenient is the one thing this must
not do. So the gap closes the day IT points the app at Entra, and not before. **For the demo, sign-in
for the cast needs one of two things first:** the three `AUTH_ENTRA_*` variables set on the
deployment, or a platform admin setting a password at `/users` for each of the four or five people
who will be shown signing in. That is stated here rather than discovered on stage.

## 8. Still open for Rihal — three deliberate ambiguities

Unchanged, and each is flagged in the code where it applies (full table in `SPEC-CONFORMANCE.md`).

1. **§6.2 — re-signing after an approved mid-year change.** The spec is silent. No re-sign was
   invented; instead `SignOff.kpiSetHash` surfaces that a signature predates the current set.
2. **§7.1 — a divergent manager rating requires a reason.** The spec does not ask for this. It was
   added; Rihal should confirm they want it.
3. **§8.7 — band boundaries.** Printed as `4.00–4.49` and `4.50–5.00`, which leaves 4.495 in no band.
   Implemented as `>=` thresholds. Rihal should confirm, along with whether scores are rounded before
   banding.

_Deviation 8 (the clamped score on §13.1's scorecard) was the fourth open question and was settled by
the operator on 2026-08-26: the clamped score stays._

## How to re-run this

```bash
node scripts/reachability.mjs          # §1 — exits non-zero if any write becomes unreachable
npm run ship                           # typecheck, lint, 574 contract + 18 lint-rule tests, build, gitleaks, npm audit
npm run test:integration               # 92 DB-backed tests against a real Postgres
npm run db:demo-cycle                  # the fixture §2's evidence was produced against
```
