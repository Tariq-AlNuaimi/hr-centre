# Three questions for Rihal's HR team

**From:** the PMS build · **Date:** 2026-08-26 · **Specification:** PMS Functional Specification v1.0

Every clause in §1–§14 and Appendix A is built. These three are the only places where the
specification does not say what should happen, so the build had to choose — and a choice made by the
build is a choice Rihal has not made. Each one below states **what the spec says**, **what the system
does today**, and **the single question** that settles it.

None of the three blocks the demo. All three are cheap to change now and expensive to change once a
cycle has run with real data in it.

---

## 1 · §6.2 — After HR approves a mid-year KPI change, does anyone sign again?

**What the spec says.** §6.2: a manager submits a change request, "HR reviews and approves or
rejects. On approval: the new version takes effect." §6.3 keeps the version history. Nothing is said
about signatures.

**Why that leaves a gap.** §5.1 makes the goal-setting sign-off meaningful: the employee signs the KPI
set, the manager signs, HR approves, and the set is locked. If a KPI is then changed mid-year, both
people have signed something that no longer exists — and the year-end assessment (§7) is measured
against the _new_ set.

**What the system does today.** No re-sign was invented. The original signature stands, and
`SignOff.kpiSetHash` records the exact KPI set that was signed, so any screen can tell that a
signature predates the current set. Nobody is asked to sign twice, and nothing pretends the old
signature covers the new KPI.

> ### The question
>
> After HR approves a mid-year change, should the employee and manager be asked to **sign the revised
> set again** — or is HR's approval sufficient, with the record simply showing that the signature is
> older than the change?

---

## 2 · §7.1 — Must a manager explain a rating that differs from the employee's?

**What the spec says.** §7.1: "Employee self-assesses… Manager reviews. Offline discussion. Both sign
off on the final ratings." The discussion is explicitly _offline_. The spec does not ask for a written
reason when the two ratings differ.

**Why it came up.** A self-rating of 5 and a manager rating of 2 is the moment a performance system
either earns trust or loses it. The offline conversation happens either way; the question is whether
the system keeps a record of it.

**What the system does today.** **A reason is required** when the manager's rating diverges from the
employee's. This is more than the spec asks for, and it was added deliberately — but it is a real
burden on managers at year-end, and it was not Rihal's decision.

> ### The question
>
> Keep the mandatory divergence reason, make it **optional**, or **remove** it and rely on §7.1's
> offline discussion alone?

---

## 3 · §8.7 — Which band does a score of 4.495 fall into?

**What the spec says.** §8.7 prints the bands as:

| Final score | Band            |
| ----------- | --------------- |
| 4.50 – 5.00 | Outstanding     |
| 4.00 – 4.49 | Excellent       |
| 3.00 – 3.99 | Target          |
| 2.00 – 2.99 | Almost Achieved |
| Below 2.00  | Unsatisfactory  |

**Why that leaves a gap.** Read literally, the printed ranges have holes in them. A score of **4.495**
is above 4.49 and below 4.50, so it belongs to no band. The same hole sits between every adjacent
pair. It only appears because the system computes to more decimal places than the table prints.

**What the system does today.** Bands are implemented as **`>=` thresholds** — `≥ 4.50` Outstanding,
else `≥ 4.00` Excellent, and so on — so the ranges are continuous and nothing falls through. A 4.495
lands in **Excellent**, because it is not yet 4.50.

That is an interpretation, and it decides real money: at this boundary it is the difference between a
**2.0× and a 1.5×** bonus coefficient on basic salary (§11.3).

> ### The question
>
> Two parts, and the second matters more than it looks:
>
> 1. Are the printed ranges meant to be read as **continuous thresholds** (≥ 4.50 Outstanding, ≥ 4.00
>    Excellent, …), which is what is built?
> 2. Should the final score be **rounded to two decimal places before banding**? If yes, 4.495 rounds
>    to 4.50 and becomes Outstanding — the opposite answer from the same number.

---

## How to answer

A sentence each is enough. Send them back however is easiest and they will be implemented and recorded
in `docs/verification/SPEC-CONFORMANCE.md` as **Rihal's decision** rather than the build's
interpretation — which is the difference this page exists to make.
