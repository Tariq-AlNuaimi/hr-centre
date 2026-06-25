---
name: blueprint
description: The pre-build gate. Before building any feature, pin down what's being built and why -- user stories, happy + worst-path scenarios, a data/architecture sketch, the tier, and the open questions -- so the build starts from a contract instead of guesses. Tiered: a lightweight confirm for disposable /quickstart work, a full committed blueprint for real multi-file features. Use when the user says "build X", "add a feature for Y", "/blueprint", or at the start of /quickstart and /scaffold-entity. Trigger phrases: "blueprint", "spec this", "plan the feature", "what are we building".
---

# /blueprint — Pin down WHAT before building HOW

This is the gate that stops "assume the requirements, fill the blanks with
garbage, then discover at QA that it's wrong." Nothing of substance gets built
until the build has a contract. The contract is cheap to produce and is what
`/qa`, `/uat`, and `/manual-uat` later trace their coverage against — so the
same artifact prevents both up-front divergence and down-stream blind spots.

**The rule:** the heavier the change, the heavier the blueprint. Pick the track
honestly; don't full-blueprint a throwaway, don't lightweight a real feature.

## Pick the track

**Lightweight track** — disposable, single-surface `/quickstart` work: a small
tracker, 1–3 entities, no auth/schema/lib subtlety, easy to throw away. Do this
*inline in the chat*, no file:

1. **One clarifying-question round (mandatory).** Use `AskUserQuestion` to close
   the highest-leverage unknowns BEFORE scaffolding — never assume them. The
   usual four: who uses it + their role, the one job it must do, which fields are
   actually needed (vs. nice-to-have), and what "done" looks like. If the prompt
   already answers one, skip it; ask the rest. One round, then proceed.
2. **Declare the design + architecture read (one line each).**
   - *Design read:* surface · audience · tone · density · the single primary action.
   - *Architecture read:* the entity/entities, where state lives, the one route/
     service path. This line is the guard against accidentally building a second
     settings page or a function that duplicates an existing one — say where it
     lives in the current structure (`docs/REPO-MAP.md` answers "where is X").
3. Confirm the entity model (as `/quickstart` step 1 already does), then build.

**Full track** — real multi-file features, or anything touching the **Ask-before
surface** (auth, `lib/`, Prisma schema/migrations, API routes, `middleware.ts`,
`eslint-rules`), or ambiguous/underspecified/unfamiliar/hard-to-reverse work
(the `CLAUDE.md` Auto-plan triggers). Produce a committed blueprint and get
sign-off before code. This pairs with plan mode — the blueprint IS the plan's
requirements half.

## Full blueprint — write `docs/blueprints/<feature>.md`

Resolve the open questions FIRST (via `AskUserQuestion`) — a blueprint built on
guessed answers is the very failure this gate exists to prevent. Then write:

```md
# Blueprint — <Feature>

## Problem & outcome
<the need; what changes for whom when this ships; why now>

## Market scan
<1–3 existing products/libraries/starters checked (CLAUDE.md market-benchmark
rule), with the trade-off that justifies building vs. adopting>

## Tier
personal | shared  — and the one reason. (Sets ceremony; never the security
floor. If `shared`, the SECURITY.md §9 obligations apply.)

## User stories
- As a <role>, I want <goal>, so that <value>.
  - Acceptance: <observable, testable condition(s)>
(one per role × goal; these become the QA/UAT coverage rows)

## Scenarios (per story)
- Happy: <valid data, intended journey, expected result>
- Worst: <invalid/boundary/adversarial input, unauthorized role, double-submit —
  expected rejection/zod message/403, NOT a 500 or a silent success>

## Architecture sketch
- Entities + key fields (and which are Restricted — SECURITY.md §1)
- Routes (method + path + auth wrapper) and the service/function each calls
- Where state lives (DB / session / client) — and an explicit check that this
  does NOT duplicate an existing screen, setting, route, or service. Name the
  existing thing you reuse (cite `docs/REPO-MAP.md` / a path).
- Migrations (forward-compatible; never drop a column the running version reads)

## The five pillars (how this honors each — CLAUDE.md "Five Pillars")
- Speed · Maintainable · Scalable · Secure · High-Quality — one line each, or
  "n/a + why". Anything that can't be answered is an open question, not a skip.

## Open questions  (RESOLVE via AskUserQuestion before building)
- [ ] <question> → <answer once resolved>
```

Then: **present it, get explicit operator sign-off, commit it**
(`git add docs/blueprints/<feature>.md && git commit -m "docs: blueprint <feature>"`),
and only then build. The blueprint is the contract; if the build needs to diverge
from it, update the blueprint and re-confirm — don't silently drift (that drift is
complaint #9/#10).

## Why this exists (the contract is reused downstream)

- `/qa` and `/manual-uat` build their coverage matrix from the **user stories** —
  every story × role × {happy, worst} must be exercised, no ad-hoc exploration
  that misses cells (closes #1/#5/#6).
- The **architecture sketch** is the anti-duplication / anti-divergence guard
  (#7): you can't build a second settings page if you wrote down where the first
  one lives.
- The **open-questions + clarifying round** is the "ask enough before building"
  guard (#10), and **tier** is set explicitly instead of defaulting silently to
  `personal` (#11).

## Enforced by `/ship` (structural, not advisory)

`/ship` (`scripts/ship.mjs`, phase A) detects a **new feature surface** — a
newly-added `app/api/**/route.ts` file or a new `prisma/migrations/` directory
(vs the `origin/main` merge-base) — and requires a committed
`docs/blueprints/<feature>.md` in the same change. It is **tiered**: `shared`
projects **block**, `personal` projects only **warn** (the disposable
`/quickstart` flow stays unblocked). It keys on *added* surface only, so editing
an existing route/lib file (a fix or refactor) never trips it. Escape: add the
blueprint, or set `"blueprintAck": "<reason>"` in `project.config.json`.

## Skip when

- Pure questions / read-only lookups, typo or rename, a single-file low-risk edit.
  (These are the same carve-outs as the CLAUDE.md Auto-plan rule — don't add
  ceremony to trivia.)
- An up-to-date blueprint for this feature already exists — open it, don't rewrite.

## Related
- `/quickstart` and `/scaffold-entity` call the lightweight track as their step 0.
- Plan mode / `EnterPlanMode` — the blueprint is the requirements half of a plan.
- `/qa`, `/uat`, `/manual-uat` — consume the user stories as the coverage source.
