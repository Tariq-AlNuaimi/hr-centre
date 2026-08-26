# Verification — §9.1/§9.2's 360 setup screen (red-team F3)

Date: 2026-08-25 · Spec: §9.1, §9.2, §9.4, §9.6, §9.7 · Fixes:
`docs/verification/SPEC-REDTEAM.md` F3

`POST /api/three-sixty` had no caller. The 360 console could read a cycle, regenerate assignments
and activate — but nothing in the product could **create** the cycle, and there was no
question-authoring surface anywhere. §9 is the largest single piece of the specification and its
first step was missing.

It also left the §9.7 answering form built in the previous commit unreachable in a real deployment:
a form can only be answered once a cycle and its templates exist, and until now only the demo seeder
could produce them.

## 1. Result

| Check                                                        | Result                |
| ------------------------------------------------------------ | --------------------- |
| Setup journey driven from **no 360 cycle at all**            | **passes** (§3 below) |
| Full §9.1 → §9.2 → §9.6 → §9.7 chain driven                  | **passes** (§4 below) |
| axe serious/critical (WCAG 2.0/2.1 A + AA), 8 runs           | **0**                 |
| Runs = {en, ar} × {light, dark} × {desktop 1440, mobile 390} | 8                     |
| Contract tests added                                         | 4                     |
| `npm run ship`                                               | green                 |

## 2. What was built

`components/pms/ThreeSixtySetup.tsx`, shown on `/three-sixty` whenever the selected performance year
has no 360 cycle yet.

- **§9.1's window** — opens and deadline, with the "deadline must fall after it opens" rule stated
  on the screen as it is typed rather than only on submit.
- **§9.2's three question sets**, one per relationship direction, each with add/remove and a **kind**
  per question: scored (1–4) or open-ended. The distinction is not cosmetic and the screen says why —
  §9.5 divides the answered scores by the form's **maximum**, so an open-ended question must sit
  outside that maximum rather than count as a zero. A set with no scored question at all is called
  out, because it would produce no ratio.
- **A starter set**, loadable and then freely editable or deletable. The specification does not
  dictate question wording — that is Rihal's — but fifteen empty boxes is a poor way to ask for it.
  It is labelled "a starting point, not a recommendation" on the screen, not just in the code.
- **A "what happens after this" card** — Create → Generate raters → Activate — because creating the
  cycle invites nobody, and an HR user who assumed otherwise would wait for responses that were
  never requested.

## 3. The setup journey, driven end to end

Starting from an empty `three_sixty_cycles` table:

| Step                                     | Expected                                | Result |
| ---------------------------------------- | --------------------------------------- | ------ |
| Open `/three-sixty` with no 360          | the setup screen is offered             | ✅     |
| Nothing filled in                        | Create **disabled**                     | ✅     |
| Load the starter set, no dates           | still **disabled**                      | ✅     |
| Deadline before it opens                 | rule stated, Create **disabled** (§9.1) | ✅     |
| Fix the dates, edit one starter question | Create **enabled**                      | ✅     |
| Create                                   | console shows the cycle, status Draft   | ✅     |
| The edited question                      | stored as edited, not the starter text  | ✅     |

## 4. The rest of §9, on the cycle this screen produced

The point of F3 is not the form — it is whether what it writes is usable by the rest of the module:

| Step                        | Expected                                           | Result |
| --------------------------- | -------------------------------------------------- | ------ |
| Generate assignments (§9.6) | coverage table populates from the reporting lines  | ✅     |
| §9.4's rule                 | shortfalls named — "do not yet have three raters"  | ✅     |
| Activate (§9.7)             | **disabled** while anyone is short of three raters | ✅     |

## 5. An honest limit of this fixture, and a real one for small orgs

Activation is **blocked** in the demo org, correctly: 26 of 33 ratees cannot reach §9.4's three
raters because the fixture's departments hold two or three people, so there are not three eligible
colleagues to draw from. The auto-generated mapping would usually satisfy §9.4 in a real org with
larger departments.

But when it does not, **HR currently has no way to fix it**: `POST /api/three-sixty/assignments`
(set one ratee's raters by hand) still has no UI — that is red-team **F5**. So the honest statement
is: F3 opens 360 setup and gets a cycle to the activation gate; F5 is what gets a small or
awkwardly-shaped org _through_ it. Worth knowing before this reaches a department of three.

## 6. One asymmetry, found in self-review and left deliberate

**A template of nothing but open-ended questions is blocked by this screen, not by the route.**
`createThreeSixtyCycleSchema` asks only for at least one question of any kind, but §9.5 computes the
ratio as answered scores over the form's maximum — so a template with no scored question yields no
ratio at all, and every rater on it would silently contribute nothing to the ratee's 360.

Create is therefore disabled until each of the three sets holds at least one scored question. That
makes the screen the only thing enforcing it, which is the reverse of this codebase's usual shape
("the screen is guidance, the route is the control"). It is recorded here rather than quietly
accepted: the durable fix is a refine on the schema, and that belongs in a change to the write
contract rather than bundled into the screen that exposed it.

## 7. A capture artifact, not a bug

The full-page screenshots show the app bar painted a second time part-way down the page. That is a
Playwright full-page-capture artifact with a `position: sticky` header on a tall page, not a layout
defect: the DOM holds exactly one `<header>`, computed `position: sticky`, `top: 0`, and its
bounding rect sits at 0. `05-viewport-top.en.light.png` is a viewport-only capture showing it
correctly. Recorded so the next reader does not chase it.

## 8. Still open from the red-team report

F1, F2 and F3 are closed. F4 (manual leaver and transfer, §12.1/§12.3), F5 (per-ratee rater editing
and projects, §9.6 — see §5 above), F6 (individual 360 reports, §9.8), F8 (the silent sub-three-rater
360, §9.5) and F9 (no notification sends without SMTP) remain as registered in
`docs/findings-register.md`.
