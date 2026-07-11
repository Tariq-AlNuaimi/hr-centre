---
name: qa
description: The QA orchestrator. Decomposes a change into per-component -> per-screen -> per-flow scope and runs the three QA tiers IN GATED ORDER -- design QA (/design-qa) -> functional QA (/ship + a risk-based case matrix) -> UAT (/uat) -- against the rubric in docs/uat-rubric.md, anchored to the 5 pillars (speed/secure/maintainable/scalable/high-quality). A red gate stops the line and reports; it never barrels ahead. Collects a scorecard per screen/feature into one release-readiness verdict. This is the "don't fire off a granular mega-task" control. Trigger phrases: "qa", "/qa", "run qa", "full qa", "is this ready to ship", "release readiness", "quality gate", "audit the app properly".
---

# /qa — the gated QA orchestrator

The top of the QA system. It doesn't do the testing itself — it **decomposes**,
**sequences**, **gates**, and **collects**, so quality is enforced by structure rather
than by whoever remembers to look. Read `docs/uat-rubric.md` first — it's the bar.

## Why this exists

Collapsing all of QA into one vague "test it" step is why shipped work comes out
shallow. Separating the three tiers — each with an **owner, an entry gate, and an exit
gate** — forces depth: a tier can't start until the previous one passes. `/qa` is also
the answer to "don't launch a granular mega-task blindly": it scopes the work and
**stops the line on a red gate** instead of charging ahead.

## The pipeline (run in order; a red gate halts + reports)

| Tier              | Skill                                    | Owner                   | Entry → Exit                                                                   |
| ----------------- | ---------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| 1 · Design QA     | **`/design-qa`**                         | front-end (agent)       | build green **+ running app + seeded test creds** → no fidelity/a11y criticals |
| 2 · Functional QA | **`/ship`** + risk-based **case matrix** | dev/QA (agent)          | design-QA passed → regression green, no open criticals, high-risk covered      |
| 3 · UAT           | **`/uat`** (FULL)                        | **operator** (business) | functional-QA passed → acceptance traced + signed off                          |

Tie-breaker across all three: the **5 pillars** (speed/secure/maintainable/scalable/high-quality) hold and the **security floor** is intact.

## How to run it

0. **Anchor on the blueprint (the coverage source).** If the feature has a
   `docs/blueprints/<feature>.md`, its **user stories** are the coverage contract:
   every story × role × {happy, worst} must be exercised across the tiers below —
   that's what makes coverage exhaustive-by-construction instead of "whatever the
   agent thought to try." No blueprint (older/disposable work)? Derive the story
   list from the changed routes/entities and say so, but don't skip the step — an
   un-anchored QA is how basic cases get missed (#1/#5/#6).
1. **Decompose, don't blob.** Scope the change: which **components** changed → which
   **screens** they appear on → which **flows** they touch. QA the components first
   (a broken variant caught once), then screens, then flows. Fan out sub-agents per
   screen where independent; collect their scorecards.
2. **Tier 1 — `/design-qa`.** Entry gate is concrete: **a green build + a running app +
   seeded test credentials**. If any is missing the run is **blocked, not a pass** —
   "could not run" is never green (bring up the local DB + seed + login first). Run it on
   the in-scope screens/components. If it returns fidelity/a11y **criticals**, **stop**:
   report them; don't start functional QA on a visually-broken surface.
3. **Tier 2 — functional.** Run `/ship` (tsc → lint → tests → component tests → build →
   gitleaks → audit) **plus** a **risk-based case matrix** for the changed functions
   (auth/data-integrity/Restricted/approvals = exhaustive; toggles = smoke). Add the
   missing lower-pyramid tests rather than leaning on E2E. Stop on red.
4. **Tier 3 — `/uat`.** Build the **traceability matrix** (requirement → scenario →
   pass/fail) and run `/uat` FULL against prod-like data. The agent produces the
   evidence pack (screenshots + PDF); **the business-stakeholder operator signs off in
   writing — recorded in the scorecard, not the agent** — `/qa` never self-accepts UAT.
5. **Collect + verdict.** Assemble one **scorecard per screen/feature** (rubric
   template) into a single **release-readiness** verdict: _ship_ or _fix-first_ with the
   blocker list. Every finding cites a **pillar + anchor**.

## Gating rules

- A tier **only starts if the prior tier passed.** A red gate **stops** the line and
  reports — it does not silently continue.
- **"Could not run" ≠ pass.** Browser/creds/DB not set up is a blocked run, not green.
- **No open wave-offs on the changed surface.** `/qa` does **not** return a _ship_
  verdict while `docs/findings-register.md` has an **open** (un-adjudicated) entry
  touching the in-scope surface (or an open SECURITY.md §12 security suppression).
  A deferred finding is a recorded operator decision, not a silent pass (#12) — the
  operator adjudicates it (accepts/schedules) or it's fixed before _ship_.
- **Evidence, not opinion.** Every finding cites a pillar + an anchor
  (objectives/scope/benchmark/KB/design). Residual taste → flagged as a judgment call
  for the operator. A judgment call you decide to wave off is **logged in
  `docs/findings-register.md`**, not silently dropped — "buried as not-a-finding" is
  exactly the wave-off this gate forbids.
- The agent does the **exhaustive evidence-backed passes**; the operator **adjudicates
  the judgment calls and signs off** — far less work than finding the misses by hand.

## Re-run scoping (keep repeat QA cheap)

- **The `<last-qa-commit>` baseline** is the SHA of `HEAD` at the **last green `/qa` run**
  (record it in that run's scorecard). A re-run scopes its diff against _that_ SHA — get
  the baseline wrong and the carry-forward is invalid (a changed screen reads as
  unchanged and skips QA). If no prior green run exists, there is no baseline: do a full
  from-scratch pass.
- A re-run after fixes does **not** restart from zero. Scope tier 1 and tier 3 passes to
  screens whose code (page/components/styles/messages it imports) changed since the last
  pass — `git diff --name-only <last-qa-commit>..HEAD` is the source of truth — plus any
  screen the previous run flagged red. Unchanged + previously-green screens carry their
  verdict forward, noted as "carried (unchanged since <sha>)" in the scorecard.
- The **functional gate (`/ship`) always runs in full** — it's cheap and global.
- A full from-scratch pass is still required before release sign-off and whenever shared
  layout/theme/token files changed (those invalidate every screen).

## Do not skip this because…

| Rationalization                                                  | Rebuttal                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The change is small — a full tiered pass is overkill."          | That's what **re-run scoping** is for: unchanged screens carry forward, `/ship` runs in full because it's cheap. Small change → small scoped run, never no run.                                                             |
| "It's just a prototype; the operator will eyeball it."           | The operator eyeballing it IS tier 3 — and it's gated on tiers 1–2 so they aren't asked to sign off on a surface that's visually broken or failing regression. Skipping the pipeline doesn't save their time; it spends it. |
| "Time pressure — run the tiers in parallel to go faster."        | The order is the mechanism: functional QA on a visually-broken screen and UAT on a red regression both produce findings you must re-triage after the fix. Gated order is the fast path, not the slow one.                   |
| "The browser/creds/DB won't come up — call it pass and move on." | "Could not run" ≠ pass is a named gating rule. A blocked run is reported as **blocked**; declaring it green is the one thing this orchestrator exists to make impossible.                                                   |
| "There's no blueprint, so there's nothing to trace against."     | Step 0 covers this: derive the story list from the changed routes/entities and say so. No-blueprint lowers the anchor quality; it never waives the anchoring.                                                               |
| "That finding is a judgment call, so it's not a finding."        | Judgment calls are **logged** and adjudicated by the operator, not buried. "Not-a-finding" is the silent wave-off the gating rules forbid (#12).                                                                            |

## Boundaries

- `/qa` orchestrates the **existing** tier skills; it doesn't replace them. Security
  _code_ scanning is `/audit`; live-app pentest is the future `/vapt`.
- Needs a running app + seed data + test login for tiers 1 and 3 (same env contract as
  `/uat`). On a fresh container, bring up the local DB + seed before running.
