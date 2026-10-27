# ADR-086 — One case engine for joiners, movers and leavers

**Status:** 🟢 Accepted — operator brief for the JML module, 2026-10-26.
**Date:** 2026-10-27
**Related:** `docs/blueprints/jml.md` D6, `docs/blueprints/jml-s2-engine.md`.

## Context

HR Onboarding and HR Offboarding each had a case header, task model, template model, owner
rule, working-week maths and notification code — similar in shape, different in detail, and
each with defects the other had already fixed (Onboarding rounded progress to 100 with a task
open; Offboarding never advanced a stage, never delivered a notification, hard-deleted on
archive).

## Decision

One header (`JmlCase`, type JOIN/MOVE/LEAVE) with a detail table per type; one task model
(`JmlTask`, the union of both); one template model with both selection mechanisms (criteria +
conditions for JOIN/MOVE, scopes + applicability for LEAVE); one assignment rule (Onboarding's
scoped-with-priority form, optionally limited to case types); one notification path (the core
`Notification` feed, with a Muscat-time window, plus the joiner email queue). Where the two
artifacts genuinely differ (task status lists, empty-denominator progress, cancelled tasks in
the denominator, offset units) the difference is kept PER CASE TYPE and named in code; where
one was a defect (rounding, stage never advancing, UTC window, archive hard delete) it is fixed
for both.

Vocabulary stays verbatim (Onboarding §7.4): stage names, status names and labels are the
artifacts'; database identifiers carry the `Jml` / `Leave` prefixes.

## Considered options

1. **One engine, per-type rules where the artifacts differ (chosen).**
2. **Two modules side by side** — rejected: the operator asked for one module, and every
   cross-cutting fix (calendar, notifications, owner rules) would be made twice.
3. **One engine with one set of rules for all types** — rejected: it would silently change an
   approved artifact rule (e.g. Offboarding's "empty checklist cannot close").

## Consequences

Positive: one checklist UI, one sweep, one rule screen. Negative: the task model carries
columns only one type uses (statutory deadline vs confirmation trio). Mitigation: the per-type
rules live in `lib/jml/vocab.ts` and `lib/jml/engine/progress.ts`, unit-tested.
