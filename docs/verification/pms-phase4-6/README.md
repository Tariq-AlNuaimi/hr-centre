# Verification — PMS Phases 4–6, browser + axe pass

Date: 2026-08-25 · Spec: §8 scoring, §9 the 360, §10 calibration, §11 bonus, §12 edge cases,
§13 reports and publication

This is the tier Phases 4–6 had never had: a person looking at the screens. Everything below was
**executed** against a production build (`next build` + `next start`) on a PostgreSQL 16 database
built from the full migration chain, at 1440×900, light and dark, in both locales.

It found four defects. Three of them were invisible to all 540 contract tests and all 88
integration tests, and one of them made a screen unusable.

## 1. Result

| Measure                                               | Result                     |
| ----------------------------------------------------- | -------------------------- |
| Screens audited                                       | 8                          |
| Screen-runs (8 × light/dark × en/ar)                  | **32**                     |
| axe serious/critical violations (WCAG 2.0/2.1 A + AA) | **0**, after the fixes     |
| Screens reachable and rendering                       | **32 / 32**                |
| `npm run ship`                                        | green                      |
| Contract tests                                        | 542 passing (2 added here) |

Raw axe output per screen-run is committed: `axe-results.en.json` and `axe-results.ar.json`.

The 34 PNG captures are **not** committed — `.gitignore` excludes `docs/verification/**/*.png`, and
Phase 3a set the same precedent. They are reproducible: seed with `npm run db:demo-cycle`, run the
score run and publish from the calibration screen, then capture at 1440×900 across
`{light,dark} × {en,ar}`. The axe JSON above is the part that carries the verdict.

## 2. The pass could not start: every screen was empty

`prisma/seed-pms.ts` seeds the ORG — 3 entities, 11 departments, 36 people, the reporting edges —
and stops. It creates no `PerformanceCycle`, so **all eight screens rendered their empty state**:
"No performance cycles yet." The first run of this audit therefore proved only that eight empty
states are accessible, which is worth something and is not the audit that was asked for.

It is also what anyone opening the deployed URL saw. A cycle cannot be conjured: it is built by
walking December's goal-setting, June's mid-year and November's year-end in sequence, as a dozen
different people. So `prisma/seed-demo-cycle.ts` (`npm run db:demo-cycle`) now builds one year's
**inputs** in a pass: KPIs at §5.3's exact 100, §5.1's lock and both signatures, §7.1's year-end
ratings with §7.2's mandatory reason on a divergence, §8.4's Strategy scores, a closed §9 360 with
every form submitted, §10.2's target distribution, and §12's leaver and mid-year transfer.

It stops deliberately short of the score run — see §3 — and it refuses to touch a real deployment:
it writes appraisal ratings, so it goes silent if any employee import has ever run, or if headcount
is not fixture-sized.

## 3. Defect 1 — §8's score calculation had no trigger anywhere in the product

`POST /api/scores` was called by **no screen, no server action and no cron**. Confirmed by search
across `app/**` and `components/**`, and against `vercel.json`'s two cron entries.

It is not an optional route. §10.7 sequences it between "assessments completed & signed" and the
calibration gate, and both downstream gates depend on it: calibration refuses while anyone is
unscored, and §13.2's publish refuses without a score run. So an HR Super Admin could key every
input the specification asks for and then had **no way to produce a single score** — the calibration
screen said "no raw score" and the publish gate said "not ready", both correctly, and neither said
what to do, because the thing to do had no button.

Every test missed it because contract and integration tests import the route module and call it
directly. Reachability is not something a test that supplies its own caller can observe.

**Fixed** — `components/pms/ScoreRunPanel.tsx`, on the calibration screen, above the readiness card
(the card's complaint is missing scores; the answer to it now sits directly above). It renders the
run's skipped list as the §10.7 worklist rather than as an error, and states that a re-run writes a
new `ScoreRun` and never overwrites a raw score (§10.1), because "recalculate" is the button an
operator hesitates over after an afternoon of moving bands.

**Verified end to end through the UI**, not by calling the route: signed in as HR Super Admin,
clicked the button, and the run scored **36 of 36**, opening §10.7's gate. Then published through
§13.2's typed confirmation and confirmed the employee scorecard renders the released result.
`calibration-before-run.en.light.png` and `calibration-after-run.en.light.png` are that pair.

## 4. Defect 2 — the 360 console crashed on every populated cycle

`/three-sixty` rendered "Something went wrong" the moment the 360 had templates — which is every
360 that exists, because §9.2 creates them with the cycle. The empty-state run passed it, because
with no cycle there was nothing to map over.

```
TypeError: Cannot read properties of undefined (reading 'questions')
```

The page's hand-written response interface claimed `templates[].\_count.questions`. The route
returns each template's `questions` array; the `_count` on that payload belongs to the **cycle** and
holds `assignments`. `apiClient.get<T>` is an unchecked cast, so TypeScript could not catch the
mismatch and the screen died on `_count` being undefined.

**Fixed** — the interface now describes what the route actually returns, and the count comes from
`template.questions.length`. The comment on the type records why, since the next person to edit it
will be looking at the same unchecked cast.

**Swept for the same class**: every other `_count` in the UI (`org-setup`, `CycleList`) was checked
against its route's `select` and is correctly declared. This was the only mismatch.

## 5. Defect 3 — red text failed AA contrast on every dark surface

axe, once the 360 screen rendered: `color-contrast`, serious — `#dc2626` on `#111827`, ratio
**3.67** against a required 4.5.

The design system had already solved this. `app/tokens.css` carries two red tokens with the reason
written on them: `--destructive` is the destructive **surface** (`bg-destructive`, white foreground),
and `--destructive-emphasis` is red **as text**, which `globals.css` lightens to `#f87171` in dark
mode precisely so it clears AA. The shared `ui/` primitives (`form.tsx`, `dropdown-menu.tsx`) use the
emphasis token correctly.

**20 app-level and PMS-component sites used the surface token as a text colour**, in 14 files. All
of them fail AA on dark. axe caught exactly one, because the other 19 are error and alert states
that render only when something has gone wrong — none were triggered during a capture.

**Fixed** in all 14 files: `text-destructive` → `text-destructive-emphasis` wherever it colours text,
leaving `bg-destructive` and `text-destructive-foreground` untouched.

## 6. Defect 4 — two independent sums of the bonus, one of them in floating point

`app/api/reports/executive/route.ts` folded the payroll total with `Prisma.Decimal`, under a comment
warning that "two independent sums of 'the bonus' would eventually disagree, and the one an
executive sees should never be the one that is wrong."

`components/pms/BonusReport.tsx` was the second sum, and it disagreed by construction:

```ts
const total = data.rows.reduce((sum, row) => sum + Number(row.bonus ?? 0), 0);
```

`Number` on money, summed in binary floating point, in the browser — the exact thing
`schema.prisma`'s "Decimal not Float: these are summed and compared" comment forbids. The route
returned only eligible/ineligible **counts**, so the screen had invented the money figure itself.

**Fixed** — the fold moved to `bonusTotals()` in `lib/pms/bonus-report.ts`, beside the `bonusRows`
both callers already shared. `/api/bonus` now returns the total; the report renders it; the
executive dashboard calls the same function. One sum.

Pinned by two contract tests in `tests/contracts/pms-bonus-calibration.test.ts`, including one that
asserts the float sum these rows used to produce is _not_ the number they add up to — the reason
for the fold, stated as an assertion rather than a comment.

## 7. What the pass confirmed, by looking

- **§12.3's day-weighting is right end to end.** `/admin/edge-cases` shows the split year as
  0.4137 (151 days) + 0.5863 (214 days) = 1.0000, each period carrying its own 3-KPI set and its own
  department's manager.
- **§13.1's anonymity holds.** The published scorecard shows the consolidated 360 figure and the
  written feedback with no attribution, exactly as the clause requires.
- **§8.3's C-Level path is visible.** `/reports` shows "C-Level (no department) — 0% (0/0)" for
  goal-setting and year-end: exempt, and shown as exempt rather than as missing.
- **RTL and dark hold on all eight screens.** See the `.ar.dark.png` set.

## 8. One open question this raised, for Rihal

**Who runs the score calculation — HR Super Admin only, or HRBPs too?**

`POST /api/scores` admits `isHr(actor)`, which is HR Super Admin **or** HRBP. The new trigger sits
on the calibration screen, which §10.6 gates to HR Super Admin alone ("HRBP does not touch
calibration"). So an HRBP the route would allow to run scoring has no button for it.

That is deliberate rather than overlooked: §10.7 frames the run as the step that opens the HR Super
Admin's calibration gate, and putting the control anywhere else would give an HRBP a way to
recalculate underneath a calibration in progress. But the route and the screen now disagree about
who may do it, and the disagreement should be settled by Rihal rather than by whichever of the two
someone reads first. **Nothing was widened to resolve it** — the route is unchanged.

## 8. Honest limitations

- **Arabic is not enabled in this fork.** `project.config.json` ships `"locales": ["en"]`, so
  `/ar/...` is not routable: it redirects to `/en/ar/...` and 404s. The Arabic captures here were
  taken with `locales` temporarily set to `["en","ar"]` and a rebuild; **the flag is committed
  back at `["en"]`**, which is what ships. The specification never mentions Arabic, so English-only
  is not a spec deviation — but earlier verification documents in this repo (the §1 evidence table
  in `SPEC-CONFORMANCE.md`, and `pms-phase3a/README.md` §6) claim axe passes "en + ar" without
  recording that the locale had to be enabled to produce them. Those claims are corrected in
  `SPEC-CONFORMANCE.md` alongside this report.
- **The demo org is too small to satisfy §9.4.** 36 people across 11 departments leaves most people
  without three available raters — 26 of 33 are short, which `/three-sixty` reports plainly. The
  fixture therefore closes the 360 directly rather than passing §9.7's activation gate. That is a
  property of a 36-person fixture, not of the code; Rihal's real org will not have it.
- **The score run's skipped list is only shown for a run just performed.** The reasons come from the
  route's response; re-deriving them on read would be a second implementation of the scoring rules,
  free to disagree with the one that produced the scores.
- **Not audited here**: mobile viewports (this pass is 1440×900 only), and the permission matrix
  across roles — every screen-run above is an HR Super Admin. `/uat` is the tier that covers both.
