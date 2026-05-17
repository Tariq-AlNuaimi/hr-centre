import { Prisma } from "../../generated/prisma/client";

// Models excluded from soft-delete filtering (Auth.js needs direct access)
const EXCLUDE = new Set(["Account", "Session", "VerificationToken", "AuditLog"]);

// Models that have deletedAt/deletedBy fields
const SOFT_DELETE_MODELS = new Set(["User"]);

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
          // Rewrite delete to soft-delete (update deletedAt)
          const { where } = args;
          return (client as any)[model[0].toLowerCase() + model.slice(1)].update({
            where,
            data: { deletedAt: new Date() },
          });
        },
        async deleteMany({ model, args, query }) {
          if (EXCLUDE.has(model) || !SOFT_DELETE_MODELS.has(model)) {
            return query(args);
          }
          const { where } = args ?? {};
          return (client as any)[model[0].toLowerCase() + model.slice(1)].updateMany({
            where,
            data: { deletedAt: new Date() },
          });
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
