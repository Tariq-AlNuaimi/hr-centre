# Visual critique — org chart as a hierarchy (V2-301 / V2-307)

Captured against a local build with the demo fixture: **36 people, 3 entities, 11 departments**,
including a C-Level leaver and several lines that cross a department boundary. That spread is the
point — the arrangement's hard cases are an entity with one department, a person whose manager sits
elsewhere, and a C-Level with no department at all, and a single-entity fixture would have proved
none of them.

Matrix: desktop + mobile × light + dark, plus a driven search capture (`org.search.png`).
English-only fork, so no RTL variant; the markup uses logical properties (`ms-*`, `ps-*`,
`border-s-*`) and the chevrons carry `rtl:-scale-x-100`.

## Scored 10/10 after two fixes

| #   | Point              | Verdict                                                                                                                                                                                              |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Grid alignment     | **fixed** — see below                                                                                                                                                                                |
| 2   | Hierarchy          | pass — entity → department → reporting line, each a disclosure with its own headcount                                                                                                                |
| 3   | One primary action | pass — no filled button on the screen at all; Expand all / Collapse all are outline, which is right for a read-only view                                                                             |
| 4   | State honesty      | pass — real empty state, a distinct "nobody matching X is visible to you", and a live-region count that switches between "36 people" and "1 match"                                                   |
| 5   | Spacing rhythm     | pass                                                                                                                                                                                                 |
| 6   | Copy               | pass — the group header says what the C-Level group is ("Executive (no department)") rather than showing a blank                                                                                     |
| 7   | RTL                | n/a (English-only fork); logical properties throughout                                                                                                                                               |
| 8   | Dark               | pass — `org.desktop.dark.png`, `org.mobile.dark.png`; the Leaver badge and the indent guides both hold contrast                                                                                      |
| 9   | Responsive         | pass — `org.mobile.*.png`; see the note below                                                                                                                                                        |
| 10  | a11y               | pass — every disclosure is a real `<button>` with `aria-expanded`; the per-person toggle has an `aria-label` naming the person and the count; the result count is `role="status" aria-live="polite"` |

## The two fixes the pixels forced

**1. The chart collapsed to eleven department heads.** Reporting lines started shut at every size,
so a 36-person org opened showing only its department heads — a different failure from the
unbroken 200-row column it replaced, but a failure. The default now follows the size (open at or
below 60 people, shut above), and **Expand all / Collapse all** make it explicit in both
directions, since no automatic default is right for every reader. The controls hide while
searching, where the matches decide what is open and the two would fight.

**2. Leaf rows looked misaligned with rows that have a toggle.** The spacer standing in for an
absent toggle was `w-[1.75rem]` against a variable-width count button. Both are `w-9` now.

That second one is worth recording honestly: I read the misalignment off the screenshot, fixed it,
and then **measured it in the DOM** rather than trusting my eye — toggled and leaf rows return
identical x positions (367 / 396 / 425). The measurement is what confirms the fix; the screenshot
only raised the question, and at a glance I had also mis-estimated the gap.

## Verified by driving it, not by reading the code

- **Search** (`org.search.png`): typing "Zainab" reports _1 match_ and reveals her whole chain —
  RIHAL → Engineering → Tariq Al-Naaimi → Rashid Al-Farsi → Layla Al-Habsi → **Zainab Al-Lawati**,
  the match in brand colour — with the other two entities and every unrelated branch hidden. A
  match inside a collapsed branch would be found and invisible, which is why `matchOrgChart`
  returns the ancestors in the same pass.
- **Status reaches the row**: Amina Al-Balushi renders with her amber **Leaver** badge. Active
  people carry no badge deliberately — badging the default on 200 rows is noise, and the absence
  is the information.
- **Crossing lines are named**: every department head carries "reports to Salim Al-Harthy" (or
  their entity's C-Level), and Salma Al-Hajri in IT carries "reports to Tariq Al-Naaimi" in
  Engineering — the §12.1 / §12.3 case that the old flat tree showed under the wrong department.

## Known, accepted

At 390px a person occupies three or four lines (name, track, status, crossing note) and five levels
of nesting push the deepest names well to the right, where they wrap. That is inherent to showing
three facts per person in a nested tree on a phone; the collapse controls are the mitigation —
Collapse all, then open the one department you want. Not worth flattening the hierarchy on mobile,
which would discard the thing this redesign is for.
