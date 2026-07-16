# HARNESS-V2 — Evidence Manifest (Re-audit Contract)

This file is the re-audit contract defined in `HARNESS-V2-KICKOFF.md` §6. It is
maintained from the first commit of the program. The post-program re-audit walks this
table row by row: **an empty Evidence cell is a failed item regardless of the code.**

## Contract (KICKOFF §5–§6)

- An item is **done** only when its backlog acceptance criterion is demonstrated by a
  command output, test run, or captured transcript — never by assertion — and that
  evidence is linked here, and the work is committed `harness-v2(<ITEM-ID>): <summary>`
  and pushed.
- **Evidence** = a relative path to a test file, a captured command-output block in this
  file, a screenshot under `docs/verification/harness-v2/`, or a register/ledger line
  reference.
- **Negative tests are mandatory for every gate item**: prove the gate DENIES the bad
  case AND ALLOWS the good case.
- **Status** ∈ `pending` | `in-progress` | `done` | `deferred` | `superseded` | `blocked`.
  Deferred/blocked rows name the blocker and carry a `docs/findings-register.md` line.
  Superseded rows point at their successor ID.
- Only the operator adjudicates a findings-register line; the executor never marks one
  `adjudicated`.

_Item count: 48 (V2-001 … V2-507). All rows start `pending`._

## Manifest

| ID     | Phase | Status  | Commit(s) | Evidence | Notes                                          |
| ------ | ----- | ------- | --------- | -------- | ---------------------------------------------- |
| V2-001 | 0     | pending | —         | —        | Close the Bash bypass on the write gates       |
| V2-002 | 0     | pending | —         | —        | Blueprint Scope-glob hygiene                   |
| V2-003 | 0     | pending | —         | —        | Hook test harness                              |
| V2-004 | 0     | pending | —         | —        | Superpowers presence                           |
| V2-005 | 0     | pending | —         | —        | Documentation truth pass                       |
| V2-006 | 0     | pending | —         | —        | session-state.json lifecycle                   |
| V2-101 | 1     | pending | —         | —        | Constitution split + lazy rules (ASK)          |
| V2-102 | 1     | pending | —         | —        | Memory retrieval-on-demand                     |
| V2-103 | 1     | pending | —         | —        | Velocity becomes a gated pillar (ASK)          |
| V2-104 | 1     | pending | —         | —        | Parallel-by-default standing instruction       |
| V2-105 | 1     | pending | —         | —        | Native agent-teams evaluation (ASK)            |
| V2-106 | 1     | pending | —         | —        | Token observability: ccusage (LEDGER)          |
| V2-107 | 1     | pending | —         | —        | Permission friction review                     |
| V2-201 | 2     | pending | —         | —        | /benchmark <category> skill                    |
| V2-202 | 2     | pending | —         | —        | Feature-parity disposition in the blueprint    |
| V2-203 | 2     | pending | —         | —        | Universal app-floor checklist                  |
| V2-204 | 2     | pending | —         | —        | /explore divergent skill                       |
| V2-205 | 2     | pending | —         | —        | Work-graph in the blueprint                    |
| V2-206 | 2     | pending | —         | —        | Two-stage review                               |
| V2-207 | 2     | pending | —         | —        | playwright-bdd traceability (LEDGER, ADR, ASK) |
| V2-208 | 2     | pending | —         | —        | /retro skill + omission feedback               |
| V2-209 | 2     | pending | —         | —        | Blueprint amendment deltas                     |
| V2-210 | 2     | pending | —         | —        | Pilot feature end-to-end (ASK)                 |
| V2-301 | 3     | pending | —         | —        | Visual iteration loop                          |
| V2-302 | 3     | pending | —         | —        | Layout primitive layer (LEDGER)                |
| V2-303 | 3     | pending | —         | —        | Page archetypes                                |
| V2-304 | 3     | pending | —         | —        | Spacing/typography lint (LEDGER)               |
| V2-305 | 3     | pending | —         | —        | Copy chokepoint + copy lint                    |
| V2-306 | 3     | pending | —         | —        | OSS catalog + /adopt skill                     |
| V2-307 | 3     | pending | —         | —        | Taste anchors + scored design-qa (ASK)         |
| V2-308 | 3     | pending | —         | —        | Visual regression (LEDGER)                     |
| V2-309 | 3     | pending | —         | —        | Build-vs-buy completeness                      |
| V2-401 | 4     | pending | —         | —        | Testcontainers + /ship --full (LEDGER)         |
| V2-402 | 4     | pending | —         | —        | pgvector verification                          |
| V2-403 | 4     | pending | —         | —        | Coverage floor                                 |
| V2-404 | 4     | pending | —         | —        | Cognitive complexity at error (LEDGER)         |
| V2-405 | 4     | pending | —         | —        | Mutation testing on invariants (LEDGER)        |
| V2-406 | 4     | pending | —         | —        | Invariant unit tests                           |
| V2-407 | 4     | pending | —         | —        | Local security fallbacks (LEDGER)              |
| V2-408 | 4     | pending | —         | —        | protect-secrets scope honesty                  |
| V2-409 | 4     | pending | —         | —        | Debt sunset                                    |
| V2-501 | 5     | pending | —         | —        | ADR-056 decision (ASK, ADR)                    |
| V2-502 | 5     | pending | —         | —        | Renovate (LEDGER)                              |
| V2-503 | 5     | pending | —         | —        | Skill-standard conformance                     |
| V2-504 | 5     | pending | —         | —        | Docs-currency skill                            |
| V2-505 | 5     | pending | —         | —        | Doctrine sync + maintainer runbook             |
| V2-506 | 5     | pending | —         | —        | Fork doc-payload manifest                      |
| V2-507 | 5     | pending | —         | —        | Program closeout                               |

## Per-phase retros

Appended at each phase exit (KICKOFF §2.1). Empty until Phase 0 closes.
