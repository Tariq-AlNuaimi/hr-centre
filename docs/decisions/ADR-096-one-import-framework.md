# ADR-096 — One import record for every importer

**Status:** Accepted — operator-approved P2 platform roadmap (item 4)
**Date:** 2026-10-29
**Decision owner:** Tariq Al-Naaimi (operator)

## Context

People imports used `ImportBatch` + `ImportRowIssue`; candidate imports a separate
`HiringImportBatch` with a JSON error log; historical exits left no record at all. Three
shapes, no single list (audit: `ux/shell-people.md` R17; `ux/tickets-hiring.md` P2-5).

## Decision

`ImportBatch` gains `kind` (`people`, `jml.exits`, `hiring.candidates`) and
`ImportRowIssue` a generic `reference`; `ImportStatus` gains `FAILED`. Each module keeps
its own parser, rules and preview → apply flow — they differ for good reasons (the people
workbook re-submits Restricted salary on apply; exits are history-only; candidates are
per requisition) — and records every run through `lib/core/imports/record.ts`. Existing
`hiring_import_batches` rows are copied (JSON errors become row issues). The people
importer reads and applies only `people` batches. **Admin › Imports** lists every run the
viewer may see (each kind behind its module's own gate; counts only, never row contents)
and links to each importer.

## Considered options

- **A generic import engine with module adapters (column mapping, preview, apply)** —
  deferred: the three flows' apply semantics differ (salary re-submission, history-only
  cases, per-requisition), so a shared engine would be mostly adapter code today. The
  shared record and hub are the part with value now.
- **Flatfile / OneSchema embedded importers** — rejected: personal and pay data would
  leave our database, and the people import's "silence is never destructive" rule is
  ours to enforce.

## Consequences

`hiring_import_batches` is dropped once the new path is verified live.
