import { Prisma } from "../../generated/prisma/client";
import { getAuditContext } from "../audit-context";
import { recordAudit } from "./audit-extension";

// Models excluded from soft-delete filtering (Auth.js needs direct access)
const EXCLUDE = new Set(["Account", "Session", "VerificationToken", "AuditLog"]);

// Narrowest delegate shape this extension needs. Prisma's per-model delegate
// types can't be reached generically, so we cast to this minimal contract.
type SoftDeleteDelegate = {
  findUnique: (a: { where: unknown }) => Promise<unknown>;
  findMany: (a: { where?: unknown }) => Promise<unknown[]>;
  update: (a: { where: unknown; data: { deletedAt: Date; deletedBy: string | null } }) => Promise<unknown>;
  updateMany: (a: { where?: unknown; data: { deletedAt: Date; deletedBy: string | null } }) => Promise<unknown>;
};

// Models that have deletedAt/deletedBy fields
const SOFT_DELETE_MODELS = new Set(["User", "Assessment"]);

export const softDeleteExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (EXCLUDE.has(model) || !SOFT_DELETE_MODELS.has(model)) {
            return query(args);
          }
          // Only add deletedAt filter if not explicitly querying deleted records
          const where = args.where as Record<string, unknown> | undefined;
          if (!where?.deletedAt) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async findFirst({ model, args, query }) {
          if (EXCLUDE.has(model) || !SOFT_DELETE_MODELS.has(model)) {
            return query(args);
          }
          const where = args.where as Record<string, unknown> | undefined;
          if (!where?.deletedAt) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async findUnique({ model, args, query }) {
          if (EXCLUDE.has(model) || !SOFT_DELETE_MODELS.has(model)) {
            return query(args);
          }
          const where = args.where as Record<string, unknown> | undefined;
          if (!where?.deletedAt) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async count({ model, args, query }) {
          if (EXCLUDE.has(model) || !SOFT_DELETE_MODELS.has(model)) {
            return query(args);
          }
          const where = args.where as Record<string, unknown> | undefined;
          if (!where?.deletedAt) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async delete({ model, args, query }) {
          if (EXCLUDE.has(model) || !SOFT_DELETE_MODELS.has(model)) {
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
          const delegate = (client as unknown as Record<string, SoftDeleteDelegate>)[
            model[0].toLowerCase() + model.slice(1)
          ];
          const before = await delegate.findUnique({ where });
          const updated = await delegate.update({
            where,
            data: { deletedAt: new Date(), deletedBy: userId ?? null },
          });
          await recordAudit(client as unknown as Parameters<typeof recordAudit>[0], {
            entityType: model,
            entityId: String(
              (before as { id?: string } | null)?.id ??
                (where as { id?: string }).id ??
                "unknown"
            ),
            action: "DELETE",
            before: before as Record<string, unknown> | null,
            after: updated as Record<string, unknown>,
          });
          return updated;
        },
        async deleteMany({ model, args, query }) {
          if (EXCLUDE.has(model) || !SOFT_DELETE_MODELS.has(model)) {
            return query(args);
          }
          const { where } = args ?? {};
          const { userId } = getAuditContext();
          const delegate = (client as unknown as Record<string, SoftDeleteDelegate>)[
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
            await recordAudit(client as unknown as Parameters<typeof recordAudit>[0], {
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
 * Register a model to participate in soft deletion.
 * Call this when adding new models with deletedAt/deletedBy fields.
 */
export function registerSoftDeleteModel(modelName: string) {
  SOFT_DELETE_MODELS.add(modelName);
}
