# ADR-031 — Mandatory structured database

**Status:** Accepted (operator sign-off 2026-07-02)
**Date:** 2026-07-02
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Formalizes:** what ADR-001 (Prisma + Postgres in the locked stack) and
ADR-006 (Neon provisioning) already make true by construction. No stack change.

## Context

Directive D5 of the replatform-and-adoption program (2026-07-02): **"Every app
has a DB with a structured schema."** Today this is true by construction —
`prisma/schema.prisma` is the source of truth, `/deploy`/`/new-project`
provision Neon, `vercel.json` runs `prisma migrate deploy` every build, and
`/scaffold-entity` is the entity path. But nothing *enforces* it: a fork could
strip its domain models, drift its migrations, or ship a schema-less shell and
every gate would still pass. D5 asks for the gate, not new machinery.

## Decision

A structured, migrated database is a **gate**, not a convention:

1. **`/ship` gains a DB-structure check** (in `scripts/ship.mjs`):
   - `prisma/schema.prisma` contains **≥1 domain model beyond the auth/audit
     baseline** (User/Account/Session/VerificationToken/AuditLog and the
     scaffolding-owned support models).
   - `prisma/migrations/` is **non-empty and in sync** with the schema
     (`prisma migrate diff` clean against the migrations folder).
   - Fails red otherwise. Escape hatch, consistent with the ADR-025 pattern
     and never silent: `"dbAck"` in `project.config.json` plus an adjudicated
     line in `docs/findings-register.md` — for the rare genuinely stateless
     utility fork.
2. **`/quickstart` refuses to scaffold a "no-DB" app.** Every idea passes
   through `/scaffold-entity` for its data model (already the flow — this pins
   it as policy).
3. **`/blueprint` full track requires a non-empty data-model sketch** before
   sign-off — the schema is designed at the contract stage, not improvised
   during the build.

## Consequences

### Positive
- "Structured DB" moves from true-by-habit to deterministic gate — the
  template's whole philosophy (pillars as gates, not vibes).
- Migration drift (schema edited, migration forgotten) is caught pre-push
  instead of at deploy time.

### Negative
- The `migrate diff` check needs a Prisma engine run in `/ship` — a small,
  bounded cost in the gate.
- Genuinely stateless forks (rare) must carry an explicit ack.

### Mitigations
- The check reuses the local Prisma toolchain `/ship` already depends on; no
  new dependency.
- `"dbAck"` + register adjudication keeps the escape explicit and auditable.

## Alternatives considered
1. **Leave it as convention.** Rejected: directive D5 asks for mandatory, and
   every other pillar concern in this template is a gate.
2. **Enforce at deploy only** (`vercel.json` migrate step). Rejected: too late —
   the failure surfaces on Vercel's build log instead of at `/ship`, off the
   operator's loop.

## Migration triggers
- Revisit the baseline-model list when the auth/audit baseline itself changes
  (keep the check's allowlist in lockstep with `prisma/schema.prisma`).
- Revisit if a real class of DB-less forks emerges (then consider a first-class
  `stateless` tier rather than per-fork acks).

## Related
- ADR-001 (locked stack: Prisma + Postgres), ADR-006 (Neon), ADR-025 (ack +
  findings-register escape pattern), ADR-030 (compose app+DB as canonical
  local stack).
- `docs/blueprints/2026-07-replatform-and-adoption-program.md` Workstream E.
