# Verification — §10.2's target-distribution editor (red-team F2)

Date: 2026-08-25 · Spec: §10.2, §10.3, §10.4, §10.7, §13.2 · Fixes:
`docs/verification/SPEC-REDTEAM.md` F2

`PUT /api/calibration` had no caller. The calibration screen read the target distribution and drew
every gap against it, but nothing in the product could set one — and §10.7's readiness check refuses
calibration without a target. The gate was shut with no key: a cycle could reach "every raw score is
in" and stop there permanently.

## 1. Result

| Check                                                        | Result                           |
| ------------------------------------------------------------ | -------------------------------- |
| Journey driven in a browser, starting from **no target**     | **passes** (§3 below)            |
| axe serious/critical (WCAG 2.0/2.1 A + AA), 8 runs           | **0**                            |
| Runs = {en, ar} × {light, dark} × {desktop 1440, mobile 390} | 8                                |
| Contract tests added                                         | 3 (§10.2 total, §10.3 threshold) |
| `npm run ship`                                               | green                            |

## 2. What was built

`components/pms/CalibrationTargetEditor.tsx`, on the calibration screen above the gap tables it
governs — the tables have nothing to compare against until it is set.

- **§10.2's five percentages**, with a live running total and Save disabled off 100. The zod schema
  refuses an off-100 distribution regardless: the screen is guidance so an operator learns the rule
  by reading rather than by being rejected, and the route remains the control.
- **§10.3's editable threshold** — "the threshold (5) is an editable setting controlled by HR Super
  Admin" — with a line saying what changing it does: departments below it keep their raw scores as
  final, and an individual can still be moved by hand.
- **An empty state that names the consequence**, not just the absence: "calibration cannot start and
  results cannot be released. Set one to open the gate."
- **It moves nobody.** §10.4 is explicit that calibration is "guided, not forced" and that the
  system "does not mathematically force people into bands". Setting a target changes what the gap
  says; the band moves stay the adjustment rows below, each carrying §10.5's mandatory reason.

Authority is unchanged: the screen is gated on `runCalibration` and the route checks
`isHrSuperAdmin` for itself — §10.6, "HRBP does not touch calibration".

## 3. The journey, driven end to end

Starting from an empty `calibration_targets` table — the state that was previously a dead end:

| Step                                   | Expected                                          | Result |
| -------------------------------------- | ------------------------------------------------- | ------ |
| Open `/calibration` with no target     | empty state naming the blocked gate               | ✅     |
| …and the readiness card                | reports the missing target (§10.7)                | ✅     |
| Open the editor, set Outstanding to 15 | total reads 105.00%, Save **disabled** (§10.2)    | ✅     |
| Put it back to 10 / 20 / 40 / 20 / 10  | Save **enabled**                                  | ✅     |
| Save                                   | target stored; gap tables now measured against it | ✅     |
| The readiness card                     | **gone** — §10.7's gate is open                   | ✅     |
| §13.2's release card                   | no longer reports "no target distribution set"    | ✅     |

## 4. A defect the driving caught, fixed

**The publish gate kept reporting a blocker the operator had just cleared.** §13.2's readiness
counts "no target distribution set" among its blockers, and `PublishGate` holds its own query. After
saving a target, the calibration tables updated and the readiness card disappeared, but two cards
further down the same screen the release panel still said the target was missing — the operator's
own fix, reported back to them as still outstanding.

Fixed by invalidating `["pms", "publish", cycleId]` alongside the calibration query, the same way
`ScoreRunPanel` already does. Caught only because the journey was driven to the bottom of the page
rather than stopping at the card that had changed.

## 5. Note on the Prisma boundary

The editor declares §8.7's band order locally rather than importing `BANDS` from
`lib/pms/calibration`: that module imports `Prisma` for `Decimal`, which drags the Postgres client
into the browser bundle. The calibration page already keeps its own list for the same reason. The
§9.7 form hit the identical trap earlier in this session and was fixed by splitting
`lib/pms/three-sixty-scale.ts` out as a leaf module — worth remembering as a shape, not two
coincidences.

## 6. Still open from the red-team report

F1 and F2 — both CRITICAL — are now closed. F3–F6 and F8–F9 remain as registered in
`docs/findings-register.md`: 360 cycle/template creation (§9.1/§9.2), manual leaver and transfer
(§12.1/§12.3), per-ratee rater editing and projects (§9.6), individual 360 reports (§9.8), the
silent sub-three-rater 360 (§9.5), and SMTP-less notifications (§5.5/§9.7).
