# P2 platform — one import record and Admin › Imports (ADR-096)

Scope: lib/core/imports/record.ts, app/api/imports/history/route.ts, app/[locale]/(dashboard)/admin/imports/page.tsx, components/imports/**, lib/hiring/candidate-bulk.ts, app/api/hiring/candidates/import/route.ts, lib/jml/leave/import.ts, app/api/jml/config/import-exits/route.ts, lib/pms/import/run.ts, app/api/imports/route.ts, app/api/imports/[id]/apply/route.ts, lib/nav/tabs.ts, prisma/schema.prisma, prisma/migrations/20261029140159_core_imports/**, prisma/migrations/20261029140200_core_imports_copy/**, tests/contracts/core-imports.test.ts

Status: operator-approved P2 roadmap, item 4. Audit: `ux/shell-people.md` R17, `ux/tickets-hiring.md` P2-5.
Feature parity: n/a — consolidation of existing importers.

## Stories and acceptance criteria

- **US-1 (HR) every import is on record.** AC-1.1 People, historical exits (dry run and
  commit) and candidate imports each write an `ImportBatch` of their kind with counts and
  row issues. AC-1.2 Existing candidate import batches are copied, their errors as issues.
- **US-2 (HR) one place.** AC-2.1 Admin › Imports lists the importers and runs of the kinds
  I may use (people: import preview; exits: JML configure; candidates: hiring manage), newest
  first, counts only. AC-2.2 With no importer I get "no access", not an empty list.
- **US-3 (HR) nothing else changes.** AC-3.1 The people preview → apply flow is unchanged and
  only ever reads/applies `people` batches. AC-3.2 The exits and candidate importers return
  what they returned before.

## Worst paths

- Recording an exits run fails → the import result stands; a warning without details.
- Someone passes a candidate batch id to the people apply route → 404.

## Data

Migrations `20261029140159_core_imports` (kind, reference, FAILED) and
`20261029140200_core_imports_copy` (copy). Evidence: scratch replay — 2 hiring batches →
`hiring.candidates` (APPLIED with its row issue; IN_PROGRESS → PREVIEWED; a missing user →
null uploader); the people batch untouched.
