# F11 + F12 — the last two unreachable write endpoints

**Date:** 2026-08-26 · **Findings:** `docs/verification/SPEC-REDTEAM.md` F11 (CRITICAL, §5.1) and
F12 (MEDIUM, §3).

Both came out of a full write-endpoint reachability sweep — 43 endpoints, every one checked for a
caller in the user interface. These were the two that had none.

## What was broken

**F11 — §5.1's lock had no key.** `POST /api/cycles/[id]/participants/[participantId]/approve` was
complete, idempotent and tested, and nothing in the product called it. The only other writer of
`goalsApprovedAt` was `prisma/seed-demo-cycle.ts:397`, writing straight to the database — the same
trap as F1–F6, and the fixture is again what made the screens look finished. The consequence is not
confined to §5: `app/api/year-end-signoffs/route.ts:115` refuses without an HR-approved baseline
("no HR-approved baseline… §5.1"), so **§7 → §8 → §10 → §11 → §13 were shut for the whole company
behind a lock nobody could turn.**

**F12 — HR could not fix a record.** `PUT /api/employees/[id]` had no caller either, though
`lib/validations/employee.ts` opens by saying its schemas guard "the hand-editing paths (HR fixing
one record in the UI)". A misspelt name, a wrong department, a role track that did not match the job
could only be corrected by re-importing — and an import creates an `importBatch`, which makes
`seed-demo-cycle` refuse forever. HR's smallest correction was the product's most expensive act.

## What was built

- `components/pms/HrApprovalPanel.tsx` on the goal-setting participant screen, below the sign-off
  panel (§5.1's own order: agreement, then HR's approval as the lock). HR-only, guarded, with a
  confirmation that states what the lock costs rather than asking "are you sure?".
- `components/pms/EmployeeEditForm.tsx` on `/people/[id]`, HR Super Admin only (§4.1's configure
  column), offering six fields and carrying the rest of the row through unchanged.

Two decisions worth keeping:

1. **Neither screen re-derives its gate.** The approval panel is handed `hrApprovalDecision`'s own
   sentence, computed in the server component by the same function the route calls; the edit form
   binds `updateEmployeeSchema` — the route's schema — as its resolver. Neither has a second copy of
   a rule that could drift from the boundary's.
2. **`PUT` is a full replace, so the form carries every field, and TypeScript enforces that.** The
   payload is typed `UpdateEmployeeInput`, whose every key is required, so a field the form forgets
   to hold is a build error rather than a silently wiped column. Salary is the one that matters:
   omitting it would encrypt `null` over a real figure and §11 would pay the wrong bonus for a year.

## A dead compensation card, found on the way

`/people/[id]` was the only employee read in the app that did not go through `serializeEmployee`. It
tested `"basicSalary" in employee` — a key `employeeSelect` has not returned since ADR-067 moved
compensation to an encrypted envelope (it selects `basicSalaryEnc`). So the whole compensation
section was dead: **HR saw no salary on any individual record.** It type-checked because `in`
narrows on any key, and no test covered the page. Fixed by routing the read through the serializer
like every other caller. It is in this change because F12 needs the plaintext to round-trip it.

## Also: one seam, four copies

Four screens had written the `canViewEmployee` descendant-set precondition as the same
byte-identical four-line ternary chain. It is now `visibilityDescendants` in `lib/pms/org-tree.ts`.
Four copies of a permission precondition is one copy away from a fifth that forgets the
`employeeId` guard and walks the org tree from `null`.

## Verified by using the product

Against a local Postgres with `prisma/seed.ts` + `prisma/demo-cycle.ts`, driven in a real browser as
the HR Super Admin. Not a test calling a route module — the finding class here is precisely one that
supplying your own caller cannot see.

### F11 — all three states

| Participant     | State set up                                   | What the screen did                                                                                                                                                     |
| --------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aisha Al-Hinai  | both parties signed, no approval               | basis `BOTH_SIGNED`, button enabled → confirmed → `goals_approved_at` and `goals_approved_by_id` written, panel flipped to "Locked as the agreed baseline", toast fired |
| Ali Al-Ghafri   | manager signed, employee did not, stage LOCKED | basis `HR_REVIEW_EMPLOYEE_UNSIGNED` — the §5.4 sentence, distinct from a mutual agreement, stated **before** the click                                                  |
| Adil Al-Mahrizi | employee signed, manager did not               | button disabled, `hrApprovalDecision`'s sentence quoted verbatim: "The line manager has not signed (§5.1). A missed manager sign-off escalates…"                        |

### F12

| Case                                                          | Result                                                                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit a name (Aisha Al-Hinai, LEAD)                            | saved; `basicSalaryEnc`, status, department, manager, `pmsRoles` all unchanged; the salary re-rendered as `1900`, so the fresh ciphertext decrypts |
| Edit an email on an HR Super Admin's record (Fatma Al-Rashdi) | saved; `pmsRoles` still `{HR_SUPER_ADMIN}` — the highest-stakes carried field survives                                                             |
| A C-Level record (Salim Al-Harthy)                            | no department control at all (not a disabled one — there is no value to set); manager help reads "Optional for C-Level"                            |
| C-Level → Lead, saved with neither department nor manager     | both refusals fired on their own field paths, in `applyOrgInvariants`' own words; the record was **not** written                                   |
| Compensation card                                             | now renders (`1900`) where before the whole section was absent                                                                                     |

### Captures

`*.desktop.{light,dark}.png` and `*.mobile.{light,dark}.png` for both screens, English only (the
fork is English-only; `messages/ar.json` was still updated in step with `en.json`, as the
`i18n-keys` contract test requires).

Read against the 10-point rubric: on-token surfaces throughout (no raw hex — both components use
`SectionCard` / `Dialog` / `Form` / `Button`), dark holds on both screens, mobile reflows without a
horizontal scroll, one primary action per screen, and the states are honest — a blocked approval
says which rule blocks it rather than hiding the control.

**Not run here:** the axe layer. `axe-core` is not installed in this checkout, so the accessibility
audit is `/design-qa`'s at QA time. The new markup composes the shipped primitives, uses
`role="status"` / `role="alert"` on the live regions, and labels every control through
`FormLabel`/`FormControl` — but that is a reasoned expectation, not a measurement.
