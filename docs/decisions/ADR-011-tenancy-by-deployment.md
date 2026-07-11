# ADR-011 — Tenancy by deployment (one Vercel+Neon project per tool)

**Status:** Accepted
**Date:** 2026-06-04
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-006 (Vercel + Neon prototype rail). Does not supersede it.

## Context

A recurring "SaaS-readiness" question for the template is whether it needs a
multi-tenant data model — an `organizationId` (or `tenantId`) discriminator on
every row, Postgres Row-Level Security (RLS) to enforce per-tenant isolation,
and a tenant-aware Prisma client. Adopting that pattern is a large, invasive
change: it touches the schema of every model, every query path, the audit and
soft-delete extensions, the seed, and the scaffolder.

The template's actual deployment shape (ADR-006) is **one Vercel project +
one Neon project per tool**. Each fork is its own repository, its own database,
its own auth realm, its own URL. A prototype is built for one team / one
internal tool and reviewed by stakeholders via that fork's own
`<slug>.vercel.app`. There is no shared control plane and no cross-fork data
path.

In other words, the isolation boundary the multi-tenant question is trying to
buy already exists — at the **deployment** layer — for free.

## Decision

**The template's tenancy model is isolation-by-deployment: one Vercel+Neon
project per tool.** Postgres RLS and an app-level `organizationId` /
multi-tenant refactor are intentionally **NOT** part of the baseline.

Concretely:

- Each fork is a single-tenant application. Its data belongs to one team / one
  organizational context, enforced by the fact that no other tenant's data is
  in that Neon database at all.
- Auth scopes to that fork (Auth.js realm + the `User` table in that database).
  The `Role` enum (USER / ADMIN) handles _intra_-tenant authorization; it is
  not a tenant discriminator.
- A fork only adopts a multi-tenant model (tenant column + RLS + tenant-aware
  client) if it **explicitly** needs to serve multiple organizations from a
  single deployment — and that is a deliberate, ADR-recorded departure for that
  fork, not a default the template carries.

## Consequences

### Positive

- Zero tenancy ceremony on day zero: no tenant column to thread through every
  query, no RLS policies to write and test, no class of "forgot the
  `WHERE tenantId = …`" data-leak bugs (the highest-severity multi-tenant
  failure mode is structurally absent).
- The strongest possible isolation: separate databases cannot leak into each
  other through an application bug. This is _stronger_ than RLS, not weaker.
- The audit / soft-delete / scaffolder invariants stay simple — they never have
  to reason about a tenant boundary.

### Negative

- Many small tools = many Vercel + Neon projects to manage. Acceptable: the rail
  is built for exactly this (`/new-project`, `/deploy` provision a fresh
  project per tool in minutes), and prototypes are short-lived or handed off.
- A genuine multi-org product cannot be served from one deployment without the
  refactor. That is by design — such a product has outgrown the prototype rail.

### Mitigations

- `/new-project` and `/deploy` make spinning up a per-tool deployment cheap, so
  "one project per tool" is not operationally painful.
- The migration trigger below names the one signal that should make a fork
  reconsider, so the decision is revisited deliberately rather than drifted into.

## Alternatives considered

1. **App-level `organizationId` on every model + tenant-aware Prisma client.**
   Rejected for the baseline: invasive across the entire schema and query
   surface, and it trades the deployment-level isolation we already have for a
   weaker, bug-prone application-level one. A fork can still adopt it locally.
2. **Postgres Row-Level Security (RLS) in a shared database.** Rejected for the
   baseline: requires a tenant-setting session variable on every connection, RLS
   policies per table, and careful interaction with Prisma's connection pooling
   on Neon — real cost for a tenancy boundary the per-deployment model already
   provides. Appropriate only for a fork that has explicitly gone multi-org.
3. **Schema-per-tenant in one database.** Rejected: migration and connection
   management complexity scales with tenant count; still weaker isolation than
   separate databases.

## Migration triggers

Revisit this decision for a specific fork when:

- The fork must serve **multiple distinct organizations from a single
  deployment** (e.g. an external multi-org product, not an internal tool) — at
  that point, raise a fork-specific ADR choosing RLS or an `organizationId`
  model, and update the audit / soft-delete extensions and scaffolder to be
  tenant-aware.
- Per-deployment operational cost (many Neon/Vercel projects) becomes the
  dominant pain and the tools genuinely share a tenant population.

## Related

- `docs/decisions/ADR-006-pivot-to-vercel-neon.md` — the one-project-per-tool rail
- `docs/decisions/ADR-001-template-baseline.md` — `Role` enum + auth invariants
- `CLAUDE.md` — project tiers (`personal` vs `shared`); operations model
