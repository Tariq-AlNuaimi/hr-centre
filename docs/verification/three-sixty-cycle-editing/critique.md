# Visual critique — editing a 360 cycle after creation (V2-301 / V2-307)

Captured against a local build with a real ACTIVE 360 (`npm run db:demo-cycle`: 87 submitted
assessments across 49 ratees, 35 of them short of §9.4's three raters). That state matters — every
control added here only appears once a cycle is live, so a draft-only fixture would have proved
nothing.

Matrix: desktop + mobile × light + dark. English-only fork (`project.config.json` `locales`), so
there is no RTL variant to capture; the markup uses logical properties (`me-2`) throughout.

## Scored 10/10 after one fix

| #   | Point              | Verdict                                                                                                                                                                                                                                                                                    |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Grid alignment     | pass — the two new cards sit on the same rhythm as the existing stat row and Question sets                                                                                                                                                                                                 |
| 2   | Hierarchy          | pass — status stats, then the window, then cycle status, then setup, then coverage: the order HR works in                                                                                                                                                                                  |
| 3   | One primary action | pass — "Save window" is the only filled button; Close cycle / Back to draft / Manage raters are all outline                                                                                                                                                                                |
| 4   | State honesty      | **fixed, see below**                                                                                                                                                                                                                                                                       |
| 5   | Spacing rhythm     | pass                                                                                                                                                                                                                                                                                       |
| 6   | Copy               | **fixed, see below**                                                                                                                                                                                                                                                                       |
| 7   | RTL                | n/a (English-only fork)                                                                                                                                                                                                                                                                    |
| 8   | Dark               | pass — `three-sixty.desktop.dark.png`; disabled inputs and the warning line both hold contrast                                                                                                                                                                                             |
| 9   | Responsive         | pass — `three-sixty.mobile.*.png`; cards stack, the date pair goes single-column, buttons wrap. The coverage table scrolls inside its own container, which is the existing `DataTable` behaviour and not introduced here (the longer "Manage raters" label makes it slightly more visible) |
| 10  | a11y               | pass — every disabled control states its reason in body text, not a tooltip alone; the icon-only discard button carries `aria-label`                                                                                                                                                       |

## The fix the pixels forced

**Found:** on an ACTIVE cycle the coverage warning still read _"35 employees do not yet have three
raters. The cycle cannot be activated until they do."_ — in destructive red. The cycle was already
active; that sentence is simply false there, and it is only visible at all because this feature is
what puts HR on this screen after launch. A draft-only screen never showed it in that state.

**Fixed:** the consequence now follows the cycle's status. A draft keeps the launch-blocking
sentence; a live cycle gets _"35 employees have fewer than three raters. Their 360 score will be
averaged over the assessments they do have (§9.5) — use Manage raters to add someone before the
cycle closes."_ in warning rather than error colour, because on a live cycle it is a thing to act
on, not a thing that is broken. `shortfallHelpLive`, both locales.

This is the class of defect the loop exists to catch: the code was correct, the sentence was not,
and nothing but looking at it would have found it.

## Verified on screen, not just in tests

- The **360 window** card renders on a live cycle (it used to disappear at activation). "Opens" is
  disabled with _"This cycle has already opened, so the opening date is fixed (§9.7)."_; the
  deadline stays editable with _"This cycle is live, so the deadline can be extended but not
  brought forward."_
- **Cycle status** offers "Close cycle" and shows "Back to draft" disabled, with the reason in
  text: _"87 assessments have already been submitted, so this cycle cannot go back to draft. Close
  it instead."_ — which is `statusChangeBlockedReason`'s rule, reached without a round trip.
- **Manage raters** appears per ratee, which is the control the §12.1 departure dialog has been
  promising since it shipped.

## Known, not introduced

"Save window" is enabled on arrival even when nothing has been edited: the stored deadline is a
mid-day instant while the editor normalises to end-of-day, so `unchanged` is false. That is the
F10-era storage quirk, pre-dates this change, and saving is harmless (it normalises). Left alone
rather than widened into a date-storage migration.
