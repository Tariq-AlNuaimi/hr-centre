# ADR-068 — An audit row must share the fate of the write it describes

**Status:** Accepted — implemented 2026-08-26 (the operator signed off on the `lib/prisma/**` and
`eslint-rules/**` changes; both are Ask-before surfaces, CLAUDE.md)
**Date:** 2026-08-26
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

`auditExtension` writes its audit row on the client captured in `defineExtension`, not on the
transaction handle the write actually used:

```ts
export const auditExtension = Prisma.defineExtension((client) => {
  return client.$extends({ query: { $allModels: {
    async update({ model, args, query }) {
      const result = await query(args);        // ← runs on `tx` inside a transaction
      await (client as any).auditLog.create({ /* … */ });   // ← runs on the OUTER client
```

So inside `prisma.$transaction(async (tx) => …)` the write and its audit row commit
**independently**. If the transaction rolls back, the write disappears and the audit row does not:
the trail asserts a change that never happened.

This was recorded on 2026-08-26 as the residual half of the in-transaction audit finding — the other
half (a stale `after` and a null `changes`) was fixed by `projectUpdate`/`overlayUnobserved`. The
register entry says a Prisma query extension has no access to the `tx` handle, "so closing that
needs a different mechanism".

**Measured, not assumed.** Against the local Postgres, a deliberately rolled-back transaction
containing one `employee.update`:

```
rolled back: deliberate rollback (no ALS)
TODAY  — audit rows after a rolled-back tx: 1   LEAKED — the trail claims a write that never happened
```

The employee row was unchanged; the audit row said it had changed.

### How much is exposed

Ten route files and `lib/pms/import/run.ts` open transactions. Two classes:

- **Already correct** — a conditional `updateMany` (which the extension does not audit) followed by
  an explicit `recordAudit(tx, …)`. `recordAudit` takes its client as an argument, so it already
  writes on the transaction and already rolls back with it: `publish`, `kpi-change-requests/decide`,
  `kpi-change-requests/withdraw`, `three-sixty` PATCH, and `projects`' audit call.
- **Exposed** — every `tx.<model>.create/update` that goes through the extension. Roughly twenty
  writes across `calibration`, `leavers`, `roll-ups`, `three-sixty/responses`, `transfers`,
  `projects` (the membership rows) and the import runner.

## Decision drivers

- **ADR-010's invariant is biconditional.** An audit row exists **iff** the write happened. A false
  positive is not a lesser failure than a blind spot — it is a different one, and for an HR system
  whose §12.2 trail is read to answer "who changed this person's record", a fabricated entry is
  arguably worse than a missing one, because someone will act on it.
- **The failure must not be silent, and must not be re-introducible by forgetting.** The current bug
  is invisible: every test that exercises a transaction sees the audit row it expects, because the
  transactions in tests commit. A mechanism that depends on each route remembering to opt in
  reproduces exactly that failure mode.
- **No new blind spots.** Any design that defers the audit write past the commit trades a false
  positive for a possible missing row. That is a worse trade for this system.
- **`lib/prisma/**` is Ask-before and this is a security control.** The change must be small,
  reviewable, and provable at the seam rather than by reading twenty call sites.
- **A stakeholder demo is a week out.** The mechanism must be landable in one reviewed change, not a
  refactor that reshapes twenty routes.

## Considered options

### Option 1 — Publish the transaction client on an `AsyncLocalStorage`, and have the extension write on it (chosen)

A module-private `AsyncLocalStorage` in `lib/prisma/` holds the active transaction client. An
`auditedTransaction(fn)` helper opens the transaction and runs the callback inside that scope; the
extension reads the store and falls back to the captured client when there is none. Routes change
one identifier: `prisma.$transaction(` → `auditedTransaction(`. A local ESLint rule then forbids the
bare form, so the mechanism cannot be lost by forgetting.

- Good, because it fixes the invariant rather than working around it: the audit row is written **by
  the same transaction**, so it commits and rolls back with the write, with no window in between.
  Proved against real Postgres — rollback leaves zero audit rows, commit leaves exactly one.
- Good, because the repo already owns this exact pattern. `lib/audit-context.ts` propagates the
  actor through an `AsyncLocalStorage` for the same reason (a Prisma extension cannot be handed
  request state), and the extension already reads it. This is one more store beside it, not a new
  idea.
- Good, because the enforcement is mechanical. Thirteen local ESLint rules are already the security
  floor's teeth; a fourteenth forbidding bare `prisma.$transaction` makes the opt-in unforgettable
  rather than a convention.
- Good, because it is one seam to review. The extension changes by one expression; each route
  changes by one identifier.
- Bad, because `AsyncLocalStorage` is invisible control flow: a reader of the extension cannot see
  where the store is set without following the helper. Mitigated by the helper being the only writer
  and by the lint rule making the pairing visible at every call site.
- Bad, because it touches `lib/prisma/**` and `eslint-rules/**`, both Ask-before.

### Option 2 — Pass `tx` explicitly to every audited write

Drop the automatic extension inside transactions and call `recordAudit(tx, …)` by hand, as the
already-correct routes do.

- Good, because it is entirely explicit — no hidden context, nothing to propagate.
- Bad, because it re-introduces the failure the extension exists to prevent: an audited write is
  audited only if the author remembers. ADR-010 chose an automatic extension precisely so that
  "someone forgot" cannot produce a missing row.
- Bad, because it means hand-writing before/after snapshots at ~20 sites, and B3 just finished
  demonstrating that hand-built snapshots go wrong in ways nobody notices for months.
- Bad, because the diff is large and touches the shape of every one of those routes a week before a
  demo.

### Option 3 — Buffer the audit rows and flush them after the transaction commits

Collect entries during the transaction; write them once `$transaction` resolves.

- Good, because it needs no access to `tx` at all.
- Bad, because it converts a false positive into a possible **blind spot**: a process that dies
  between commit and flush loses the audit row for a write that landed. The register already states
  this is the worse direction, and for an insider-threat control detection is the only thing left.
- Bad, because the buffer is per-async-context state anyway, so it needs the same
  `AsyncLocalStorage` machinery as Option 1 without the atomicity Option 1 gets for free.

### Option 4 — Accept it; document it; steer new work to `updateMany` + explicit `recordAudit(tx, …)`

The status quo, made deliberate.

- Good, because it costs nothing and breaks nothing.
- Bad, because it leaves ~20 existing writes able to fabricate audit entries, and "steer new work"
  is not a control.
- Bad, because the pattern it steers toward is only reachable for conditional single-row updates; a
  multi-row transaction like `POST /api/transfers` cannot be expressed that way.

## Decision

**Option 1.** It is the only option that makes the audit row and the write atomic, which is the
invariant ADR-010 actually asserts, and it is the only one whose enforcement does not depend on an
author remembering. The driver that tips it is the second one: the current bug is invisible to every
test because transactions in tests commit, so any mechanism that can be forgotten will be forgotten
and will fail the same silent way.

The shape, concretely:

1. `lib/prisma/tx-context.ts` — a module-private `AsyncLocalStorage<AuditWriter>`, with
   `auditedTransaction(fn)` (opens the transaction and runs `fn(tx)` inside the scope) and
   `currentAuditWriter(fallback)` as the only way in and out. Module-private for the same reason
   `auditStorage` is: a caller holding the raw store could `.run()` an arbitrary client into the
   audit path.
2. `lib/prisma/audit-extension.ts` — the three `(client as any).auditLog.create` calls become
   `currentAuditWriter(client).auditLog.create`, and the same in `soft-delete-extension.ts`, which
   writes its own rows.
3. The ~10 transaction sites: `prisma.$transaction(` → `auditedTransaction(`.
4. `eslint-rules/rules/no-bare-prisma-transaction.mjs` at `error`, with the roster entry in
   `docs/rules/harness.md`, so the fourteenth rule is documented like the other thirteen.
5. An integration test that rolls a transaction back and asserts **zero** audit rows, plus its twin
   asserting exactly one on commit. Both were run against the prototype before this ADR was written;
   they are what "proved" means above.

**Implemented 2026-08-26**, as sketched, with one addition the build turned up (below). All 92
integration tests and 586 contract/lint-rule tests pass, and both new integration assertions were
verified to FAIL against the pre-fix code rather than merely to pass against the new.

## What the build found: the same bug, one layer down and worse

While wiring the extension, a probe asked whether the **soft-delete** extension had the same shape.
It did, and worse. It resolves its model DELEGATE from the captured client —
`client[model].findUnique` / `.update` — so a soft delete inside a transaction wrote its **data**
outside the transaction:

```
soft-delete inside a ROLLED BACK tx -> deletedAt: 2026-08-26T16:22:53.955Z   ESCAPED the transaction
```

The row's `deletedAt` stayed set after a rollback that was supposed to restore it. That is data loss
surviving a rollback, not a misleading log line — strictly worse than the finding this ADR was opened
for.

It is **latent today**: the only two in-transaction deletes target `Assignment` and `ProjectMember`,
neither of which is in `SOFT_DELETE_MODELS`. `Kpi`, `Employee`, `Department`, `OrgEntity` and `User`
all are, and the day someone writes `tx.kpi.delete(...)` inside a transaction the trap closes
silently. The store therefore holds the whole transaction client rather than just its `auditLog`
delegate, and `currentClient` is what both extensions resolve through.

## What the build also found: the fix nearly disarmed an existing rule

Converting the routes from `prisma.$transaction(cb)` to `auditedTransaction(cb)` silently broke
`no-unaudited-bulk-write`. That rule registers the callback's `tx` parameter as a tracked alias only
when it sees a `$transaction` MEMBER expression; `auditedTransaction` is a bare call, so every bulk
write inside a transaction stopped being flagged. The audit-completeness floor dropped as a side
effect of an audit-atomicity fix, and it announced itself only as two "unused eslint-disable
directive" warnings — which nobody reads as "the floor just dropped". The rule now recognises the
wrapper, and a rule-test case pins it.

## Consequences

### Positive

- The audit trail stops being able to assert a write that did not happen. `audit_logs` becomes
  readable as fact rather than as "fact, unless a transaction failed".
- The fix is at the seam: twenty call sites get it without twenty reviews.
- The lint rule makes the next transaction correct by default, including ones nobody has written.

### Negative

- One more `AsyncLocalStorage`, and control flow that a reader of the extension cannot see locally.
- `auditedTransaction` becomes a required idiom; a contributor reaching for `prisma.$transaction`
  hits a lint error rather than a working call.
- Interactive-transaction budget: the audit `create` now runs **inside** the transaction, so it
  counts against the transaction timeout and holds its locks marginally longer. For the transaction
  sizes here (single-digit to low-double-digit writes) this is immaterial, but a bulk path that
  audited thousands of rows in one transaction would feel it.

### Mitigations

- The helper is the only writer of the store, and the store is module-private — the same containment
  `lib/audit-context.ts` already applies.
- The lint rule carries the reason in its message, so the error explains the invariant rather than
  just refusing.
- The timeout concern is bounded by the existing rule that bulk paths are not N×1: the import runner
  is the only large transaction, and it already batches.

## Alternatives considered

See "Considered options". In one line each: explicit `recordAudit(tx, …)` everywhere (rejected — an
audit that depends on remembering is the failure ADR-010's extension exists to prevent); post-commit
flush (rejected — trades a false positive for a blind spot, the worse direction); accept and document
(rejected — leaves ~20 writes able to fabricate entries, and cannot express a multi-row transaction).

## Migration triggers

- Prisma gains a first-class way for a query extension to reach the active transaction client — then
  the `AsyncLocalStorage` becomes redundant and should be retired for the native mechanism.
- A transaction in this codebase grows large enough that the in-transaction audit writes measurably
  extend it (watch for interactive-transaction timeouts in the import runner).
- The audit trail stops being the detection control of record — e.g. an external SIEM takes over —
  at which point atomicity with the write matters less than delivery.
