import { Prisma } from "../../generated/prisma/client";
import { getAuditContext } from "../audit-context";
import { recordAudit } from "./audit-extension";
import { currentAuditWriter, currentClient, type AuditWriter } from "./tx-context";

// Models excluded from soft-delete filtering (Auth.js needs direct access)
const EXCLUDE = new Set(["Account", "Session", "VerificationToken", "AuditLog"]);

// Narrowest delegate shape this extension needs. Prisma's per-model delegate
// types can't be reached generically, so we cast to this minimal contract.
type SoftDeleteDelegate = {
  findUnique: (a: { where: unknown }) => Promise<unknown>;
  findMany: (a: { where?: unknown }) => Promise<unknown[]>;
  update: (a: {
    where: unknown;
    data: { deletedAt: Date; deletedBy: string | null };
  }) => Promise<unknown>;
  updateMany: (a: {
    where?: unknown;
    data: { deletedAt: Date; deletedBy: string | null };
  }) => Promise<unknown>;
};

// Models that have deletedAt/deletedBy fields
// `Kpi` joined 2026-08-24: it carries deletedAt/deletedBy and was absent, so
// `prisma.kpi.delete()` was a HARD delete and reads returned withdrawn rows.
// Two independent Phase 2 units hit it. The sharp consequence: a soft-deleted
// KPI counted toward §5.3's exactly-100% total would let a set sign at a
// weightage the employee cannot see.
//
// Registration is defence in depth, not the whole fix — see the NOTE below:
// this filters the TOP-LEVEL `where` only, and the reader that matters here
// (`weightageSummary`, which pulls `participant.kpis` through a nested select)
// is exactly the case it cannot reach. Those call sites keep their explicit
// `deletedAt: null` and are pinned by tests.
const SOFT_DELETE_MODELS = new Set([
  "User",
  "Employee",
  "Department",
  "OrgEntity",
  "Kpi",
  "Directorate",
  "Team",
  "AccessRole",
  // HR tickets (HIVE port). Tickets, their events/messages/reply tokens, the
  // settings and rotation-config singletons are NOT soft-deletable.
  "HrTagPair",
  "HrTagMember",
  "HrCoverage",
  "RotationGroup",
  "RotationCoverage",
  "DiscountPartner",
  "NetworkProvider",
  // Hiring (docs/blueprints/hiring.md) — Interview Hub's soft-delete set.
  "HiringRequisition",
  "HiringCandidate",
  "HiringInterview",
  "HiringScorecard",
  "HiringQuestion",
  "HiringOffer",
  "HiringJdTemplate",
  "HiringBulkJob",
  "JmlCase",
  // Core catalogues (ADR-097), moved from Hiring with their soft-delete.
  "Grade",
  "Competency",
  // Core document store (ADR-098).
  "Document",
]);

/**
 * Whether this model participates in soft-delete filtering. Exposed so the
 * read-operation hooks (and tests) share one decision instead of re-deriving it.
 */
export function isSoftDeleteModel(model: string): boolean {
  return !EXCLUDE.has(model) && SOFT_DELETE_MODELS.has(model);
}

/**
 * Inject `deletedAt: null` into a query's `where`, unless the caller is
 * explicitly querying by `deletedAt` (e.g. the recycling bin asking for deleted
 * rows). Single source of truth for every read hook below, so adding a new
 * read operation can't silently diverge from the others.
 *
 * NOTE (nested includes): this filters the TOP-LEVEL `where` only. Prisma query
 * extensions do not receive a generic, type-safe hook to rewrite arbitrary
 * nested `include`/`select` relation args, so a relation pulled via `include`
 * can still surface soft-deleted children. Callers that include a
 * soft-deletable relation must add the filter themselves, e.g.
 *   prisma.user.findUnique({ where, include: { posts: { where: { deletedAt: null } } } })
 * This limitation is asserted by tests/contracts/soft-delete-filter.test.ts so a
 * future change that "fixes" it is a conscious one.
 */
export function applySoftDeleteFilter<A extends { where?: unknown }>(model: string, args: A): A {
  if (!isSoftDeleteModel(model)) return args;
  const where = args.where as Record<string, unknown> | undefined;
  if (!where?.deletedAt) {
    args.where = { ...(args.where as object), deletedAt: null } as A["where"];
  }
  return args;
}

export const softDeleteExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async findFirst({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async findFirstOrThrow({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async findUnique({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async findUniqueOrThrow({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async count({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async aggregate({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async groupBy({ model, args, query }) {
          return query(applySoftDeleteFilter(model, args));
        },
        async delete({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          // Rewrite delete to soft-delete (update deletedAt + deletedBy).
          // Prisma's per-model delegates can't be reached generically through
          // its types -- the narrowest safe shape is a record of update-capable
          // delegates. deletedBy is attributed from the request's audit context.
          //
          // This extension is the OUTERMOST hook for `delete`, and it rewrites
          // to `update` on the base client, so the audit extension never sees
          // the operation. Record the DELETE row explicitly here, or soft
          // deletes would be an audit blind spot (the contract suite is
          // DB-free; this path is exercised by the /uat soft-delete journey).
          const { where } = args;
          const { userId } = getAuditContext();
          // Resolve the delegate off the ACTIVE client, which inside a
          // transaction is `tx` (ADR-068). Reading it from the captured `client`
          // ran the rewritten soft delete OUTSIDE the transaction, so a rollback
          // left `deletedAt` set on a row it was meant to restore — data loss
          // surviving a rollback, not merely a misleading audit row.
          const delegate = (currentClient(client) as unknown as Record<string, SoftDeleteDelegate>)[
            model[0].toLowerCase() + model.slice(1)
          ];
          const before = await delegate.findUnique({ where });
          const updated = await delegate.update({
            where,
            data: { deletedAt: new Date(), deletedBy: userId ?? null },
          });
          await recordAudit(currentAuditWriter(client as unknown as AuditWriter), {
            entityType: model,
            entityId: String(
              (before as { id?: string } | null)?.id ?? (where as { id?: string }).id ?? "unknown",
            ),
            action: "DELETE",
            before: before as Record<string, unknown> | null,
            after: updated as Record<string, unknown>,
          });
          return updated;
        },
        async deleteMany({ model, args, query }) {
          if (!isSoftDeleteModel(model)) {
            return query(args);
          }
          const { where } = args ?? {};
          const { userId } = getAuditContext();
          // Resolve the delegate off the ACTIVE client, which inside a
          // transaction is `tx` (ADR-068). Reading it from the captured `client`
          // ran the rewritten soft delete OUTSIDE the transaction, so a rollback
          // left `deletedAt` set on a row it was meant to restore — data loss
          // surviving a rollback, not merely a misleading audit row.
          const delegate = (currentClient(client) as unknown as Record<string, SoftDeleteDelegate>)[
            model[0].toLowerCase() + model.slice(1)
          ];
          // Snapshot the affected rows so each soft-delete is audited (the audit
          // extension never sees this rewritten bulk update).
          const before = (await delegate.findMany({ where })) as Array<{ id: string }>;
          const result = await delegate.updateMany({
            where,
            data: { deletedAt: new Date(), deletedBy: userId ?? null },
          });
          for (const rec of before) {
            await recordAudit(currentAuditWriter(client as unknown as AuditWriter), {
              entityType: model,
              entityId: String(rec.id),
              action: "DELETE",
              before: rec as Record<string, unknown>,
            });
          }
          return result;
        },
      },
    },
  });
});

/**
 * REMOVED 2026-07-25 — `registerSoftDeleteModel(name)` was a trap, not an API.
 *
 * It had zero callers: `/scaffold-entity` patches the `SOFT_DELETE_MODELS`
 * literal above directly (scripts/scaffold-entity.mjs), in lockstep with
 * `RECYCLABLE_ENTITY_TYPES` in ./recyclable.ts. But the exported function
 * registered only ONE half of that pair — a fork that found it and called it
 * would get a model whose rows are filtered out of every query (soft-deleted)
 * yet absent from the recycling bin, so those rows become invisible AND are
 * never GC'd by the retention cron. Deleting soft-delete rows without a bin is
 * worse than not soft-deleting them at all.
 *
 * To add a model, edit BOTH literals — or let `/scaffold-entity` do it, which is
 * why it patches both and throws if either marker is missing.
 */
