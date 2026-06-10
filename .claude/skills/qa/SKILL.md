---
name: qa
description: The QA orchestrator. Decomposes a change into per-component -> per-screen -> per-flow scope and runs the three QA tiers IN GATED ORDER -- design QA (/design-qa) -> functional QA (/ship + a risk-based case matrix) -> UAT (/uat) -- against the rubric in docs/uat-rubric.md, anchored to the 4 pillars (scalable/maintainable/fast/secure). A red gate stops the line and reports; it never barrels ahead. Collects a scorecard per screen/feature into one release-readiness verdict. This is the "don't fire off a granular mega-task" control. Trigger phrases: "qa", "/qa", "run qa", "full qa", "is this ready to ship", "release readiness", "quality gate", "audit the app properly".
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
| Tier | Skill | Owner | Entry → Exit |
|---|---|---|---|
| 1 · Design QA | **`/design-qa`** | front-end (agent) | build green → no fidelity/a11y criticals |
| 2 · Functional QA | **`/ship`** + risk-based **case matrix** | dev/QA (agent) | design-QA passed → regression green, no open criticals, high-risk covered |
| 3 · UAT | **`/uat`** (FULL) | **operator** (business) | functional-QA passed → acceptance traced + signed off |

Tie-breaker across all three: the **4 pillars** hold and the **security floor** is intact.

## How to run it
1. **Decompose, don't blob.** Scope the change: which **components** changed → which
   **screens** they appear on → which **flows** they touch. QA the components first
   (a broken variant caught once), then screens, then flows. Fan out sub-agents per
   screen where independent; collect their scorecards.
2. **Tier 1 — `/design-qa`.** Run it on the in-scope screens/components. If it returns
   fidelity/a11y **criticals**, **stop**: report them; don't start functional QA on a
   visually-broken surface.
3. **Tier 2 — functional.** Run `/ship` (tsc → lint → tests → component tests → build →
   gitleaks → audit) **plus** a **risk-based case matrix** for the changed functions
   (auth/data-integrity/Restricted/approvals = exhaustive; toggles = smoke). Add the
   missing lower-pyramid tests rather than leaning on E2E. Stop on red.
4. **Tier 3 — `/uat`.** Build the **traceability matrix** (requirement → scenario →
   pass/fail) and run `/uat` FULL against prod-like data. The agent produces the
   evidence pack (screenshots + PDF); **the operator signs off** — `/qa` never
   self-accepts UAT.
5. **Collect + verdict.** Assemble one **scorecard per screen/feature** (rubric
   template) into a single **release-readiness** verdict: *ship* or *fix-first* with the
   blocker list. Every finding cites a **pillar + anchor**.

## Gating rules
- A tier **only starts if the prior tier passed.** A red gate **stops** the line and
  reports — it does not silently continue.
- **"Could not run" ≠ pass.** Browser/creds/DB not set up is a blocked run, not green.
- **Evidence, not opinion.** Every finding cites a pillar + an anchor
  (objectives/scope/benchmark/KB/design). Residual taste → flagged as a judgment call
  for the operator, not buried as a finding.
- The agent does the **exhaustive evidence-backed passes**; the operator **adjudicates
  the judgment calls and signs off** — far less work than finding the misses by hand.

## Boundaries
- `/qa` orchestrates the **existing** tier skills; it doesn't replace them. Security
  *code* scanning is `/audit`; live-app pentest is the future `/vapt`.
- Needs a running app + seed data + test login for tiers 1 and 3 (same env contract as
  `/uat`). On a fresh container, bring up the local DB + seed before running.
