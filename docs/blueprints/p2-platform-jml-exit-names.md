# P2 platform — `Leave*` models renamed `JmlExit*` (ADR-099)

Scope: prisma/schema.prisma, lib/jml/**, app/api/jml/**, components/jml/**, prisma/seed-jml.ts, prisma/seed-jml-leave-data.ts, tests/contracts/jml-*.test.ts

Status: operator-approved P2 roadmap, item 6. Audit: `ux/performance-jml.md` P2-8.
Feature parity: n/a — naming.

## Stories and acceptance criteria

- **US-1 (developer) a leaver model is not mistaken for annual leave.** AC-1.1 Eight models
  and thirteen enums are `JmlExit*`. AC-1.2 Tables and enum types are unchanged (`@@map`):
  the migrated database diffs empty against the schema; no migration ships. AC-1.3 Every
  test passes unchanged in behaviour.

## Worst paths

- A parallel branch still says `prisma.leaveCaseDetail` → typecheck fails on rebase with a
  clear missing property; the new name is in this blueprint.
