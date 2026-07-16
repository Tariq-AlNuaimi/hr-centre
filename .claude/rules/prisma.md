---
globs: prisma/**, lib/prisma/**
title: Data model — Prisma, audit, soft-delete, naming
---

# Data-model rules (Prisma / audit / soft-delete)

Loaded when you touch `prisma/**` or `lib/prisma/**`. The constitution keeps the one-line
security floor; the full detail lives here. `prisma/schema.prisma` is the source of truth for
the data model; `lib/prisma/audit-extension.ts` + `soft-delete-extension.ts` hold invariants the
codebase relies on — read them before non-trivial schema work.

## Hard rules (data)

- **Go through Prisma.** No raw SQL except `prisma.$queryRaw`/`$executeRaw` with parameter
  placeholders; never `$executeRawUnsafe` on user input; no `SELECT *`; no raw UPDATE/DELETE
  without WHERE.
- **UI → API route → service → Prisma.** Only server components and API routes touch `prisma`
  (`no-prisma-in-client` rule).
- **Adding a Restricted column?** Extend `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` AND
  its assertion in `tests/contracts/audit-scrub.test.ts` in the same commit. Excel exports are a
  separate gate — audit column lists per route.
- **Audit is automatic but fragile.** `auditExtension` covers every create/update/delete outside
  the EXCLUDE set; don't extend EXCLUDE without an ADR. Soft-delete is opt-in (`/scaffold-entity`
  wires it; manual additions must too). `prismaUnfiltered` ≠ `prisma` — auth + recycling-bin
  only (`no-prisma-unfiltered-import` rule; adding it to an ordinary route is an Ask-before
  change).
- **Naming:** snake_case tables (`@@map`); camelCase Prisma fields/TS; PascalCase React + models
  - enums.

## Known traps (don't "fix")

- Generated Prisma client lives in `generated/prisma`; imports go through that path.
- Auth.js uses JWT sessions; the `sessions` table is only for OAuth account linking.
  `middleware.ts` runs on the Node runtime.
- `vercel.json` runs `prisma migrate deploy` every build — keep migrations small and
  forward-compatible; never drop columns the running version still reads. It also ships the daily
  audit-purge cron (ADR-018; silent no-op until `CRON_SECRET` is set).

## Ask before (data surface)

Touching anything under `lib/prisma/` or `prisma/migrations/`; adding a model to the audit
EXCLUDE set; changing the `Role` enum or role checks.
