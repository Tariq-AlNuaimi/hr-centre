# Red team: the 2026-08-26 delivery report, and the app it describes

**Date:** 2026-08-26 · **Target:** `docs/verification/DELIVERY-REPORT.md` at `46ea120` on `main`,
and the running product · **Live:** <https://rihal-performance-management.vercel.app>

The operator asked for this: _"then run red team analysis on the report and the app, to vlidate the
report."_ The last conformance report was found to be **"true as written and misleading as read"** —
so the question here is not whether the new report's sentences are defensible, but whether a reader
who acts on them would be right.

## Verdict

**The report's central claim survives.** Every deliverable in §1–§14 and Appendix A is built, and
each flow is reachable by the role its clause names. I re-derived the reachability number by hand,
re-checked the authority gates at the route rather than the screen, and re-ran the claims I could
execute. Nothing in §3's deliverables table is overstated.

**Three things were wrong, and one of them matters a great deal.**

| #      | Severity            | What                                                                                                                   | State                                             |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **R1** | MEDIUM (instrument) | The reachability checker could not see three of the product's write handlers at all                                    | **FIXED** — 45 pairs, not 42                      |
| **R2** | HIGH (operational)  | The employee import cannot finish for a real organisation. The 5 s default and a 10 s platform ceiling, vs 10,000 rows | **FIXED** in code; one lever left to the operator |
| **R3** | MEDIUM (§13.1)      | A 360 with one submitted form publishes that rater's comments to the employee, and §9.4 names who the raters are       | **OPEN** — a decision, recorded                   |

And one claim the report was too modest about: **SSO's env gate is now verified by execution, in
production**, not "by construction".

---

## R1 — the instrument was weaker than the number it printed

`scripts/reachability.mjs` is the report's §1 evidence, and its headline is `0 UNREACHABLE`. It
detected write handlers with `export const POST` — and nothing else.

```
$ grep -rn "export async function (POST|PUT|PATCH|DELETE)" app/api --include=route.ts
app/api/auth/forgot-password/route.ts:24
app/api/auth/[...nextauth]/route.ts:9
app/api/auth/reset-password/route.ts:19
```

Three write endpoints, invisible to a checker whose whole purpose is to notice a write nobody can
reach. **The verdict held** — all three have UI callers, in `forgot-password/page.tsx`,
`reset-password/page.tsx` and `LoginForm.tsx` — but it held by luck, not by measurement. A checker
that cannot see a handler cannot report it missing, and "0 unreachable" read as a proof it was not.

A second, quieter defect underneath it: `/api/auth/[...nextauth]` was credited to the
forgot-password page, because the dynamic-segment prefix match reaches `/api/auth` and stops. A true
verdict for a false reason is how F11 hid in the first place.

**Fixed.** The detector now matches both declaration forms, and the allowlist — renamed from
`NO_UI_CALLER` to `NAMED_CALLER` — takes precedence over pattern matching, so the catch-all is
credited to next-auth's own `signIn()` by name rather than to whichever caller the prefix happened to
find.

```
45 (route, verb) pairs · 42 with a UI caller · 3 with an explicitly named non-apiClient caller · 0 UNREACHABLE
```

The report's §1 numbers are corrected to these.

---

## R2 — the import cannot onboard the company it is for

This is the finding worth the exercise. It is not a specification violation and no test could see it:
every §3 test runs against a fixture of a few dozen rows.

`applyImport` does all of its work in **one transaction** — correctly, because §3.5's all-or-nothing
and Appendix A's "silence is never destructive" are what make the preview worth reading. It passed
**no timeout**, so it ran on Prisma's default: **5 seconds**. The loader accepts **`MAX_ROWS =
10,000`**.

I measured it rather than reasoned about it, on a loopback Postgres — the friendliest possible case,
with none of Neon's network latency:

| Apply shape                                          | Cost per created row | Where the default 5 s budget runs out |
| ---------------------------------------------------- | -------------------- | ------------------------------------- |
| Before this session (no login provisioning)          | 3.4 ms               | ~1,480 rows                           |
| With provisioning as first written (per-row lookups) | 9.6 ms               | **~520 rows**                         |
| With provisioning, after this fix                    | 3.3 ms (at n=200)    | ~1,515 rows                           |

Two things in that table. First, **the ceiling was always well under the 10,000 the product
advertises** — a first import of a 2,000-person company would have failed with a `P2028` rollback
partway through, on a flow whose entire promise is that it either happens or does not. Second, **this
session's own login provisioning made it nearly three times worse**: `provisionLogin` asked the
database "does this email already have an account?" once per row, inside the transaction — a textbook
N+1, in the one place the repo's Scalable pillar names explicitly, added by the change that was
supposed to make the system usable.

**Fixed, in three parts:**

1. **The N+1 is gone.** `existingLoginEmails` resolves the whole batch's taken emails in two chunked
   queries before the loop, and the login link is written as `userId` on the employee's own `create`
   rather than as a second `update`. Provisioning now costs _nothing_ measurable per row: 3.3 ms
   against a 3.4 ms baseline without it.
2. **The budget is explicit.** `APPLY_TX_BUDGET` scales with the plan — 30 s floor, 40 ms per touched
   row, roughly four times the measured loopback cost so a network round trip has room. A ceiling
   nobody chose, discovered as a rollback halfway through onboarding a company, is the worst version
   of this.
3. **The function's own ceiling is raised.** The apply route now declares `maxDuration = 60`, the
   convention the two internal cron routes already set. Without it the route inherits the platform
   default — **10 s on Vercel's smaller plans** — which no Prisma timeout can widen.

**What is left for the operator, and it cannot be fixed in code:** 60 s is the most a Hobby-plan
function may run. If Rihal's first import is large enough to need more, `maxDuration` has to go up
and that needs a plan that allows it. The honest ceiling today is **hundreds of rows on Neon, not
10,000** — recorded in `docs/findings-register.md` rather than left for the first real import to
discover.

---

## R3 — a 360 that one person answered is not anonymous

§13.1 says the employee sees "consolidated 360 score and combined/summarized written comments **(not
attributed to individual raters, protecting anonymity)**". The purpose is stated in the clause.

`consolidateThreeSixty` pools every submitted form's comments, sorts them, and returns them. There is
**no minimum-submission threshold**. §9.4 fixes the rater set at exactly three and names two of the
roles — _line manager (mandatory), peer (mandatory), third rater a direct reportee or a second peer_.
So an employee who receives one comment knows the pool it came from was at most three people, one of
whom is definitely their line manager. Two comments is barely better.

This is reachable, not hypothetical: the demo fixture deliberately leaves one form unanswered per
third ratee (`LEAVE_ONE_360_UNANSWERED_PER_NTH_RATEE = 3`), which is exactly the situation.

It is also an **inconsistency inside this session's own work**. F8 added `threeSixtyRaterCount`
precisely because "a score from one rater was indistinguishable from one from three" — and it warns
**HR** at calibration when the count is under three. The employee is shown the same thin 360, score
and comments both, with no such qualification.

**Not fixed, deliberately.** Suppressing feedback is a product decision with a real cost, the
specification names no threshold, and choosing one unilaterally would be exactly the kind of quiet
judgment this red team exists to catch. Recorded as an open decision for Rihal, with a recommendation:

- **Comments:** withhold below **2** submitted forms, with an honest line ("not enough responses came
  back to share these anonymously") rather than an empty section.
- **Score:** keep publishing it — §9.5's average is defined over what came back — but HR already sees
  the rater count at calibration and can decline to publish a cycle where too many are thin.

---

## What was re-checked and found sound

Each of these was a place the report could plausibly have been wrong. None was.

| Claim under test                                          | How it was checked                                                                                                                                      | Result |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| §4.1's authority gates are real, not screen-deep          | Read the guard at each route, not the page: `isHrSuperAdmin` on calibration, publish, roles, master export; `canApplyImport = canConfigure`             | Holds  |
| §10.7's sequencing gate                                   | `calibrationReadinessBlockedReason` refuses on 0 participants, 0 scores, `scored < participants`, and no target — and `publish` runs the same predicate | Holds  |
| §13.1 hides the component breakdown                       | The scorecard `select` carries `calibratedBand` and `rawScore` only, and `rawScore` reaches the payload only through `displayScore`'s clamp             | Holds  |
| F8's rater count does not leak to the employee            | `threeSixtyRaterCount` appears in exactly two places: the calibration console and the §13.5 master export. Both HR                                      | Holds  |
| ADR-069's `hasLogin` does not widen who can be enumerated | `serializeEmployee` emits a boolean, never `userId`; all three read paths serialise; the list is scoped by `visibleEmployeeIds`                         | Holds  |
| The import cannot be applied by an HRBP                   | `canApplyImport = canConfigure` — HR Super Admin only. Provisioning logins is therefore behind the strongest HR gate, not a new escalation path         | Holds  |
| `/api/internal/*` is not open when its secret is unset    | `withInternalAuth` returns 503, or a 200 `{skipped:true}` that never calls the handler. Fails closed                                                    | Holds  |
| SSO is inert with its env unset                           | **On production**: `/api/auth/providers` returns `{"credentials":…}` and nothing else                                                                   | Holds  |

### The claim the report undersold

The report said SSO was "verified by construction and unit test, not end-to-end". It is now verified
**by execution**, in all three configurations:

```
unset:      PROVIDERS: ["credentials"]
all three:  PROVIDERS: ["credentials","microsoft-entra-id"]
two of three: PROVIDERS: ["credentials"]
```

— and the first of those is confirmed against the deployed production app, not a local server. What
remains unverified is only what genuinely cannot be tested without an IdP: whether Rihal's tenant
emits the group claims `mapSsoRole` reads. The report is corrected to say so precisely.

---

## Method, and what this red team could NOT see

- Route guards were read as code, not inferred from screens. The previous pass was burned by a text
  heuristic that misread both refusals and permissions; nothing here depends on page copy.
- The transaction costs are **measured**, on a local loopback Postgres, and stated as such. Neon is a
  network away and will be worse — how much worse is not measured, and the fix is sized on the
  assumption that it is up to four times.
- **No load test at organisational scale.** R2 was found by measuring a 40- and a 200-row transaction
  and extrapolating, not by importing 2,000 people. The direction is certain; the exact ceiling on
  production is not.
- **No penetration testing**, no adversarial session-token work, no dependency-chain review beyond
  the `npm audit` gate.
- Everything here was checked against a local database and a production _infrastructure_ probe. No
  §2 flow was driven end to end on production — unchanged from the report, and the operator's
  deliberate choice not to put production credentials in an agent session.
