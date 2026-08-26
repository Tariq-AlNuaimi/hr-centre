# Verification — §9.6's rater editing and project mapping (red-team F5)

Date: 2026-08-25 · Spec: §9.4, §9.6, §9.7 · Fixes: `docs/verification/SPEC-REDTEAM.md` F5

§9.6 says "HR reviews and **edits** assignments before launch". The edit half did not exist:
`POST /api/three-sixty/assignments` (set one ratee's raters) had no caller, and
`GET`/`POST /api/projects` had none at all. HR could regenerate the whole mapping or accept what it
produced — nothing in between.

That mattered more than it sounds. §9.4 wants exactly three raters each, §9.7 refuses to activate
while anyone is short, and the generator can only draw peers from the ratee's own department or a
shared project. In a department of three there are not three eligible colleagues, so the cycle
reached the activation gate and stopped with no way through. The previous commit's evidence
(`pms-360-setup/README.md` §5) named this as the thing that would block a real small department.

## 1. Result

| Check                                                        | Result                |
| ------------------------------------------------------------ | --------------------- |
| Rater editing driven end to end                              | **passes** (§3 below) |
| Org-wide shortfall moved by a hand edit                      | 27 → 26               |
| axe serious/critical (WCAG 2.0/2.1 A + AA), 8 runs           | **0**                 |
| Runs = {en, ar} × {light, dark} × {desktop 1440, mobile 390} | 8                     |
| `npm run ship`                                               | green                 |

## 2. What was built

- **`components/pms/RaterEditor.tsx`** — a dialog per coverage row: who is assigned, remove, and a
  search to add. The route takes the whole list and **replaces** it, so the dialog edits a list
  rather than offering add and remove as separate acts — what is on screen is what will exist,
  rather than the outcome of a sequence that can half-apply.
- **`components/pms/ProjectMap.tsx`** — §9.6's optional project mapping, name plus membership and
  nothing else. §14 hands projects to a separate system in v2, so anything more here is work thrown
  away. Membership is replaced on save, for the same reason as above.
- The coverage table gains a **Manage** column, shown only while the cycle is `DRAFT` — the same
  window the route enforces (§9.6 puts HR's review _before_ launch).

The dialog filters the obvious ineligibles out of the picker but does **not** re-implement the
rules: self-assessment (§7.1), C-Level (§8.3) and leavers (§12.1) are all refused by the route, and
the screen says so in as many words rather than implying it decides.

## 3. The journey, driven end to end

Starting from a cycle created through the §9.1 setup screen and a mapping generated from the
reporting lines:

| Step                                 | Expected                                    | Result |
| ------------------------------------ | ------------------------------------------- | ------ |
| Open `/three-sixty`                  | 27 employees reported short of three raters | ✅     |
| Open Manage on the first short ratee | dialog names them, "1 of 3"                 | ✅     |
| Search and add two colleagues        | count reaches "3 of 3", badge turns green   | ✅     |
| Save                                 | accepted, no error                          | ✅     |
| Back on the console                  | shortfall drops to **26**                   | ✅     |

That last row is the point: before this, the number could only move by regenerating the whole
mapping, which produces the same shortfall again.

## 4. What this does not do

**It does not get the 36-person demo org through the gate on its own.** 26 ratees are still short,
and clearing them all by hand is 26 dialogs — correct behaviour for a fixture whose departments hold
two or three people, and the reason §9.6 offers projects as the other lever: linking people who
worked together widens the peer pool for everyone at once, rather than one ratee at a time. Both
levers now exist; which one an HR team reaches for is theirs to decide.

## 5. A harness note, not a product note

The first drive script failed on a locator inside the dialog while a direct probe of the same page
found the element present and visible (`count=1 visible=true` for three different selectors). The
product was never at fault; the script was rewritten around the probe that worked. Recorded because
"the test could not find it" is worth separating from "the app did not render it" — the first
session-level instinct was to suspect the component.

## 6. Still open from the red-team report

F1, F2, F3 and F5 are closed. F4 (manual leaver and transfer, §12.1/§12.3), F6 (individual 360
reports, §9.8), F8 (the silent sub-three-rater 360, §9.5) and F9 (no notification sends without
SMTP) remain as registered in `docs/findings-register.md`.
