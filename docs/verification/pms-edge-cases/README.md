# Verification — §12's manual departure and transfer (red-team F4)

Date: 2026-08-25 · Spec: §12.1, §12.2, §12.3 · Fixes: `docs/verification/SPEC-REDTEAM.md` F4

`POST /api/leavers` and `POST /api/transfers` had no callers — `/admin/edge-cases` only ever read
them. §12.1 is explicit that leaver status is "settable by import **or manually** (immediate one-off
resignations)", and the manual half did not exist. §12.3's transfer — the whole split-year mechanism
with its day-weighted score — could only be created by writing to the database.

## 1. Result

| Check                                                        | Result                |
| ------------------------------------------------------------ | --------------------- |
| Departure recorded through the UI                            | **passes** (§3 below) |
| Transfer recorded through the UI                             | **passes** (§3 below) |
| Split years moved by the recorded transfer                   | 1 → 2                 |
| axe serious/critical (WCAG 2.0/2.1 A + AA), 8 runs           | **0**                 |
| Runs = {en, ar} × {light, dark} × {desktop 1440, mobile 390} | 8                     |
| `npm run ship`                                               | green                 |

## 2. What was built

`components/pms/LeaverRecorder.tsx` and `components/pms/TransferRecorder.tsx`, at the top of `/admin/edge-cases` — above the roll-up and
split-year tables, because these are what produce the rows below them.

- **Record a departure** (§12.1) — employee, last working day, an optional note that lands on the
  audit trail rather than the employee record (the route's own choice, mirrored in the label).
- **Record a transfer** (§12.3) — employee, transfer date, new department, optional new manager.
  The date carries a line saying it is an input to the score, not an administrative detail: §12.3
  weights each period by days ÷ 365.
- **Both state their consequences before the click**, not after. Recording a departure rolls every
  direct report up a level, stops pending actions chasing them, and flags any 360 they were rating
  for reassignment; a transfer splits the year and hands each portion to a different manager.
  Neither has an undo in the product, so the screen says what will happen while it can still matter.
  That is §13.2's instinct about publishing, applied at a smaller scale.

### A shared picker, extracted rather than copied a fourth time

Three screens now search the employee directory (§9.6's rater editor, §9.6's project mapping, and
these two forms). `components/pms/EmployeePicker.tsx` is that control, extracted at the third use
and retro-fitted to the first two in the same commit. It offers ACTIVE employees only — a leaver is
neither a rater (§12.1) nor a transfer subject — and deliberately does nothing else: it is a
directory search, not a rules engine, and the routes stay the control.

## 3. The journeys, driven end to end

| Step                                    | Expected                           | Result |
| --------------------------------------- | ---------------------------------- | ------ |
| Open `/admin/edge-cases`                | both recorders present             | ✅     |
| Departure, nothing chosen               | button **disabled**                | ✅     |
| Pick a person, set the last working day | button **enabled**                 | ✅     |
| Record                                  | accepted; employee is now a LEAVER | ✅     |
| Transfer, nothing chosen                | button **disabled**                | ✅     |
| Pick person, date, new department       | button **enabled**                 | ✅     |
| Record                                  | accepted; **Split years 1 → 2**    | ✅     |

Confirmed in the database, not only on screen: `employees` gained a second `LEAVER` row carrying the
last working day entered on the form.

## 4. Note on what did not move

Recording the departure left **Open roll-ups at 5**. That is correct: §12.1 rolls up _direct
reports_, and the person chosen by the driver had none. A roll-up appearing for someone with no
reports would have been the bug.

## 5. Still open from the red-team report

F1, F2, F3, F4 and F5 are closed. F6 (individual 360 reports, §9.8), F8 (the silent sub-three-rater
360, §9.5) and F9 (no notification sends without SMTP) remain as registered in
`docs/findings-register.md`.
