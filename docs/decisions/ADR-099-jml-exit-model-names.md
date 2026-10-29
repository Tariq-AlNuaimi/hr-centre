# ADR-099 — Leaver models are `JmlExit*`, not `Leave*`

**Status:** Accepted — operator-approved P2 platform roadmap (item 6)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

JML's leaver models were named `Leave*` (`LeaveCaseDetail`, `LeaveSettlement`, …) beside
`Jml*` siblings. In an HR system "leave" reads as annual leave — a module HR Centre will
have — so the names were ambiguous and hid module ownership (audit:
`ux/performance-jml.md` P2-8; `ux/shell-people.md` R21).

## Decision

Rename the eight models and thirteen enums to `JmlExit*` (`LeaveCaseDetail` →
`JmlExitDetail`, `LeaveSettlement` → `JmlExitSettlement`, `LeaveExitType` → `JmlExitType`,
…). `@@map` keeps every table and Postgres enum type name, so there is **no migration and no
data move** (`prisma migrate diff` against the migrated database is empty). Relation field
names on `JmlCase` (`leaveDetail`, …) and the `lib/jml/leave/**` folder keep their names —
they read as "the leaver part of a case" and renaming them would churn every caller for no
gain in clarity.

## Consequences

- New audit rows name the new models (e.g. `JmlExitGateRecord`); rows written before keep
  the old names. Nothing queries the audit log by these names.
- Performance models keep their unprefixed names for now (`Kpi`, `SignOff`, …): a
  `Pms*` rename touches every Performance file and buys less, since none of them collide
  with another module's vocabulary. Revisit when a second module needs one of those names.
