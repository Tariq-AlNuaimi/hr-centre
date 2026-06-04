# ADR-010 — Audit completeness (soft-delete / restore / permanent-delete) and the non-atomicity limitation

**Status:** Accepted
**Date:** 2026-06-03
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-001 (audit + soft-delete invariants), ADR-006 (Vercel + Neon rail). Does not supersede them.

## Context

A template audit found that several mutations were **not** producing audit rows,
despite `SECURITY.md` §5 claiming "every write" is captured:

1. **Soft deletes were a blind spot.** `prisma.<model>.delete()` flows through the
   soft-delete extension, which is the *outermost* query hook for `delete`/`deleteMany`
   and rewrites the op to an `update` on the **base** client. That base-client update
   never reaches the audit extension, so soft-deleting a `User` wrote no audit row at
   all. (The `prisma.ts` comment "soft-delete rewrites delete→update, then audit
   captures it" was simply wrong about the composition.)
2. **Recycling-bin restore and permanent delete** use `prismaUnfiltered`, which is
   outside both extensions — so neither was audited. The audit extension's `RESTORE`
   branch was effectively dead code.
3. **Password changes** used `prismaUnfiltered`, so they were unaudited.
4. **`audit_logs.ipAddress` / `userAgent`** were never populated (`withAuth` only
   passed `userId` into the context) and **`users.deletedBy`** was never set, even
   though all three columns exist and §1 classifies them.

## Decision

- The **soft-delete extension records its own audit rows** for `delete`/`deleteMany`
  (it knowingly bypasses the audit extension), and sets `deletedBy` from the request
  context. A shared `recordAudit()` helper (in `audit-extension.ts`) writes attributed,
  scrubbed rows for any code path outside the extension.
- **Recycling-bin restore + permanent delete** call `recordAudit()` for `RESTORE` /
  `DELETE`; **permanent delete** also validates `entityType` against the recyclable
  allowlist before touching `prismaUnfiltered`.
- **Password change** routes through the audited client (`passwordHash` scrubbed).
- **`withAuth` captures `ipAddress` + `userAgent`** into the audit context.

Net: create / update / soft-delete / restore / permanent-delete are all audited and
attributed.

### Non-atomicity (the part we are NOT fixing now)

The audit row is written as a **separate statement after** the data write, not in the
same transaction. Prisma **query extensions cannot** wrap the underlying operation and
the audit insert in one interactive transaction without re-issuing the op on a base
client — which would either re-trigger the extensions (double audit) or require
plumbing a non-extended base handle through the extension factory, both of which risk
the soft-delete/audit invariants the whole template depends on. A failed audit insert
after a committed data write is therefore possible.

**This is accepted for the prototype rail.** A `shared`-tier project that needs
guaranteed atomicity should move to **database-trigger-based audit** (Postgres triggers
writing `audit_logs` in the same transaction as the DML). That is a larger change and
gets its own ADR if/when a project requires it.

### Bulk-write / upsert blind spot (`updateMany` / `createMany` / `upsert`)

The audit extension intercepts only the **per-row** `create` / `update` / `delete`
operations. A `prisma.<model>.updateMany(...)`, `prisma.<model>.createMany(...)`, or
`prisma.<model>.upsert(...)` on an audited model writes **NO audit row** — the extension
never sees the individual rows, so nothing is recorded, even though SECURITY.md §5 / ADR-001
frame the audit log as capturing "every write." `upsert` is the same class of gap: Prisma
does **not** decompose it into a `create` or `update` the extension can observe, so an upsert
on an audited model is silently unaudited. (The soft-delete extension's `deleteMany` path is
separately handled, but only for soft-deletable models, and only for deletes.)

**A fork doing bulk or upsert writes on an audited model must either** (a) avoid
`updateMany` / `createMany` / `upsert` and loop per-row through the audited client, **or**
(b) write an explicit `recordAudit()` row alongside the op. Database-trigger-based audit
(above) would close this gap too, since triggers fire per affected row regardless of how the
DML was issued.

## Consequences

- `SECURITY.md` §5 now describes real behavior, including the atomicity caveat.
- The contract suite stays DB-free; the soft-delete audit path is exercised by the
  `/uat` soft-delete journey and was verified against a live Postgres during this work.
- Forks adding new soft-deletable models via `/scaffold-entity` inherit the corrected
  behavior automatically (registry + extension).
