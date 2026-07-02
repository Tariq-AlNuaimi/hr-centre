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

## Grill against the docs first (the alignment interview)

Before you resolve open questions from your own head, run an **interrogation
pass** that pins the requirement against this repo's *authoritative* docs — the
template's native version of mattpocock's `/grill-with-docs` (cat 02), built not
imported per ADR-022. The point is to surface conflicts *as questions* before
code, not to discover them at QA. Read (don't guess) the sources that govern this
change and grill the requirement against each:

- **`CLAUDE.md` Hard rules + Ask-before** — does the ask cross an auth wrapper,
  add a public path, touch `lib/`/`middleware.ts`/`eslint-rules/`/migrations, or
  need a Restricted column? Each hit is a question the operator must answer, not
  an assumption you make.
- **`SECURITY.md` §1 data classes** — is any field Restricted? Then the
  `SCRUB_FIELDS` + export gates apply and belong in the blueprint up front.
- **`prisma/schema.prisma`** — do the entities/relations already exist? Grill for
  reuse (`docs/REPO-MAP.md` answers "where is X") so you don't spec a second
  model for something already modeled.
- **The relevant ADR(s)** — is there a locked decision (stack, deploy target,
  audit EXCLUDE) the ask silently contradicts? Name it; a superseding ADR is its
  own gate.
- **`docs/design-recipes.md` / `docs/uat-rubric.md`** — the Five Pillars and the
  UI DoD are contract terms, not afterthoughts.

Every conflict the grill turns up becomes a row in **Open questions** below,
resolved via `AskUserQuestion` — that's the linkage: grill → questions → answers
→ contract. A requirement that survives the grill is aligned with the docs; one
that doesn't is a guess waiting to become a rebuild. (Lightweight track: do the
one-breath version — a single "does this cross a Hard rule / reuse an existing
model?" check against `CLAUDE.md` + `docs/REPO-MAP.md` — not the full sweep.)

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

## User stories  (stable IDs — the traceability spine)
- **US1** — As a <role>, I want <goal>, so that <value>.
  - **AC-1.1** — WHEN <trigger/condition> THE SYSTEM SHALL <observable behavior>.
  - **AC-1.2** — IF <error/adversarial condition> THEN THE SYSTEM SHALL
    <reject with the zod message / 403 / bounded result — name it>.
- **US2** — …
  - **AC-2.1** — WHEN … THE SYSTEM SHALL …
(one story per role × goal. IDs are **stable**: never renumber; a dropped story's
ID is retired, not reused. Acceptance criteria are **EARS-phrased** — the
constrained "WHEN … THE SYSTEM SHALL …" / "IF … THEN THE SYSTEM SHALL …" form —
so each is individually testable, and `/qa`/`/uat`/`/manual-uat` cite `US`/`AC`
ids in their coverage rows one-to-one instead of re-deriving prose.)

## Scenarios (per story; Given/When/Then — worst path is mandatory)
- **US1-happy** — Given <preconditions: role, seeded state>, When <the intended
  journey with valid data>, Then <the expected result — tie it to an AC-1.x>.
- **US1-worst** — Given <same or hostile preconditions>, When <invalid/boundary/
  adversarial input, unauthorized role, double-submit>, Then <the expected
  rejection — zod message / 403 / no-op — NOT a 500 or a silent success>.
(GWT keeps scenarios checkable: a scenario with no Then is a wish, not a test.
`/manual-uat` maps its walk 1:1 onto these named `USn-happy`/`USn-worst` cells.)

## Delta — was → now  (REQUIRED when changing existing behavior; else "n/a — additive only")
| Surface (route / screen / service) | Was | Now | Who notices the break? |
|---|---|---|---|
| `PATCH /api/…` | <current behavior> | <new behavior> | <consumer/role affected> |
(`/ship`'s blueprint gate only fires on *added* routes/migrations — a behavior
change to an existing surface escapes it structurally. This table is the manual
half of that gate: enumerate every existing surface whose behavior changes, in
the OpenSpec change-proposal style, so reviewers diff intent, not just code.)

## Domain model  (the `/domain-modeling` step — do this BEFORE routes)
Model the *nouns and their relationships* before the plumbing (mattpocock's
`/domain-modeling`, native per ADR-022). This is where the schema is designed;
it feeds `/scaffold-entity` directly (entities → `--fields`/`--enums`,
relationships → `--relations`, invariants → the writer-role + zod). Fill the
grid — it maps one-to-one onto the scaffold flags:

| Entity (PascalCase) | Key attributes (name:type, mark ? optional / ! indexed) | Restricted? (§1) | Enums (states) | Relationships (→ target, cardinality 1:1/1:N/N:1) |
|---|---|---|---|---|
| `<Entity>` | `title:string, dueAt:date?` | no | `status: TODO\|DOING\|DONE` | `project → Project (N:1)`, `assignee → User? (N:1)` |

- **Invariants / lifecycle** — the rules the schema alone can't state: which
  fields are immutable after create, valid state transitions (which `status`
  moves are legal), uniqueness beyond the PK, who may write (`admin`/`editor`/
  `any` → the auth wrapper). These become zod refinements + the `--writes` flag.
- **Reuse check** — before adding an entity, name the existing model it might
  extend instead (`prisma/schema.prisma` + `docs/REPO-MAP.md`). A new model that
  duplicates an existing noun is the anti-pattern this step catches.
- **Must be non-empty (ADR-031):** the schema is designed here, at the contract
  stage — a full blueprint cannot be signed off with an empty data-model. If the
  feature "has no entities", name the existing model(s) it reads/writes; a
  genuinely stateless fork needs the `dbAck` register path, not a blank grid.

## Architecture sketch
- Routes (method + path + auth wrapper) and the service/function each calls
- Where state lives (DB / session / client) — and an explicit check that this
  does NOT duplicate an existing screen, setting, route, or service. Name the
  existing thing you reuse (cite `docs/REPO-MAP.md` / a path).
- Migrations (forward-compatible; never drop a column the running version reads)
- **A Mermaid C4-style diagram (required in the full track).** Zero-dep,
  renders on GitHub; container/component altitude, not class-level noise. Show
  the touched routes → services → tables and where the new pieces attach:

  ```mermaid
  C4Component
    title <Feature> — component view
    Container_Boundary(app, "Next.js app") {
      Component(page, "<screen>", "RSC page", "reads via service")
      Component(route, "<METHOD /api/…>", "API route", "withEditorAuth + zod")
      Component(svc, "<lib/services/…>", "service", "the only Prisma caller")
    }
    ContainerDb(db, "Postgres (Neon)", "table(s): <snake_case>")
    Rel(page, route, "fetch")
    Rel(route, svc, "calls")
    Rel(svc, db, "Prisma")
  ```
  (Plain `flowchart` is an acceptable fallback if `C4Component` fights you —
  the requirement is a committed diagram, not a specific dialect.)

## The five pillars (how this honors each — CLAUDE.md "Five Pillars")
- Speed · Maintainable · Scalable · Secure · High-Quality — one line each, or
  "n/a + why". Anything that can't be answered is an open question, not a skip.

## Open questions  (RESOLVE via AskUserQuestion before building)
- [ ] <question> → <answer once resolved>
```

Sign-off gate: a blueprint whose **Domain model grid is empty** is incomplete —
do not present it for sign-off (ADR-031).

Then: **present it, get explicit operator sign-off, commit it**
(`git add docs/blueprints/<feature>.md && git commit -m "docs: blueprint <feature>"`),
and only then build. The blueprint is the contract; if the build needs to diverge
from it, update the blueprint and re-confirm — don't silently drift (that drift is
complaint #9/#10).

## After sign-off: decompose via `writing-plans` (don't improvise the plan)

A signed blueprint is the *requirements* half; the *task* half is a decomposition,
and that goes through the **Superpowers `writing-plans` skill when available**
(CLAUDE.md already defers real multi-file features to Superpowers — this is where
the handoff happens): bite-size tasks with exact file paths and verification
steps, persisted as markdown so an ephemeral container can resume it. When
Superpowers isn't installed, write the same shape by hand — an ordered `- [ ]`
checklist committed next to the blueprint.

Either way, **mark parallelizable steps with `[P]`** (spec-kit's convention): a
step gets `[P]` only if it touches different files than, and has no dependency
on, every other `[P]` step in its group. Un-marked steps run in blueprint order.
Tasks cite the story they serve (`US1`, `AC-2.1`) so the plan inherits the
blueprint's traceability instead of inventing its own.

## Why this exists (the contract is reused downstream)

- `/qa` and `/manual-uat` build their coverage matrix from the **user stories** —
  every story × role × {happy, worst} must be exercised, no ad-hoc exploration
  that misses cells (closes #1/#5/#6). The **stable `US`/`AC` ids** are what make
  that matrix auditable: a coverage row cites `AC-1.2`, not a paraphrase, so a
  skipped criterion is visible as a missing id, not lost in prose.
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

## Do not skip this because…

| Rationalization | Rebuttal |
|---|---|
| "The prompt is clear enough — I can infer the rest." | Inference is exactly the failure this gate exists to stop. The clarifying round costs one message; guessing wrong costs a rebuilt feature and a QA pass with no contract to trace against. |
| "It's just a prototype / it's throwaway." | Then use the **lightweight track** — one question round + two one-line reads. The tiering already priced in "throwaway"; skipping entirely is the only wrong answer. |
| "The operator said do it fast." | Fast is the lightweight track, not zero track. A wrong guess is the slowest path there is; and if it touches the Ask-before surface, speed doesn't waive the full track. |
| "This is a change, not a new feature — the `/ship` gate won't even fire." | That structural blind spot is why the **Delta (was → now)** section exists. Edits to existing behavior are *more* dangerous than additions: someone already depends on the old behavior. |
| "I'll write the blueprint after, to match what I built." | A post-hoc blueprint is a changelog wearing a costume. It can't catch divergence because it *is* the divergence, and `/qa` traces coverage against fiction. |
| "A diagram is ceremony — the sketch prose says the same thing." | The Mermaid block is where duplicate screens/services get caught (you can't draw the second settings page next to the first and not notice). Prose hides topology; the diagram is the anti-duplication check working. |
| "I'll model the schema as I code — I know the entities already." | Then the domain-model grid costs you two minutes to write down what you "already know" — and its columns map straight onto the `/scaffold-entity` flags. The redo you avoid is the mid-scaffold "this needs another relation" migration. |
| "I've read the docs before — I don't need to grill this ask against them." | You've read them; you haven't checked *this* requirement against them. The grill is where a silent collision with a Hard rule, a locked ADR, or an existing model becomes a question now instead of a `/code-review` block later. |

## Related
- `/quickstart` and `/scaffold-entity` call the lightweight track as their step 0.
- Plan mode / `EnterPlanMode` — the blueprint is the requirements half of a plan.
- `/qa`, `/uat`, `/manual-uat` — consume the user stories as the coverage source.
