import { Prisma } from "../../generated/prisma/client";
import { getAuditContext } from "../audit-context";

// Models excluded from audit logging
const EXCLUDE = new Set(["AuditLog", "Account", "Session", "VerificationToken"]);

// Field names whose values must never land in `audit_logs.before` / `after` / `changes`.
// Replaced with the literal string "[redacted]" so the row keeps the fact that the field
// changed (auditable) without leaking the value. See SECURITY.md §5 + finding T-03.
export const SCRUB_FIELDS = new Set([
  "passwordHash",
  "password",
  "refresh_token",
  "access_token",
  "id_token",
  "session_state",
  "sessionToken",
  "token",
  "secret",
  "apiKey",
  "api_key",
]);

export function scrub<T extends Record<string, unknown> | null | undefined>(obj: T): T {
  if (!obj) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SCRUB_FIELDS.has(k)) {
      out[k] = v == null ? v : "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

type AnyClient = {
  [key: string]: {
    findUnique: (args: { where: { id: string } }) => Promise<unknown>;
  };
};

function modelAccessor(client: unknown, model: string) {
  const key = model[0].toLowerCase() + model.slice(1);
  return (client as AnyClient)[key];
}

export function computeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const skipFields = new Set(["updatedAt"]);

  for (const key of Object.keys(after)) {
    if (skipFields.has(key)) continue;
    const bVal = JSON.stringify(before[key]);
    const aVal = JSON.stringify(after[key]);
    if (bVal !== aVal) {
      if (SCRUB_FIELDS.has(key)) {
        changes[key] = { from: "[redacted]", to: "[redacted]" };
      } else {
        changes[key] = { from: before[key], to: after[key] };
      }
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

export const auditExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          if (EXCLUDE.has(model)) return result;

          const ctx = getAuditContext();
          const record = result as Record<string, unknown>;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client as any).auditLog.create({
            data: {
              entityType: model,
              entityId: String(record.id),
              action: "CREATE",
              after: scrub(record),
              userId: ctx.userId,
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
            },
          });

          return result;
        },

        async update({ model, args, query }) {
          if (EXCLUDE.has(model)) return query(args);

          const ctx = getAuditContext();
          const where = args.where as { id: string };

          let before: Record<string, unknown> | null = null;
          try {
            before = (await modelAccessor(client, model).findUnique({
              where: { id: where.id },
            })) as Record<string, unknown> | null;
          } catch {
            // Model might not have simple id lookup - skip before snapshot
          }

          const result = await query(args);
          const after = result as Record<string, unknown>;

          const isSoftDelete = before && !before.deletedAt && after.deletedAt;
          const isRestore = before && before.deletedAt && !after.deletedAt;

          let action = "UPDATE";
          if (isSoftDelete) action = "DELETE";
          if (isRestore) action = "RESTORE";

          const changes = before ? computeChanges(before, after) : null;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client as any).auditLog.create({
            data: {
              entityType: model,
              entityId: String(after.id),
              action,
              before: scrub(before ?? undefined),
              after: scrub(after),
              changes,
              userId: ctx.userId,
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
            },
          });

          return result;
        },

        async delete({ model, args, query }) {
          if (EXCLUDE.has(model)) return query(args);

          const ctx = getAuditContext();
          const where = args.where as { id: string };

          let before: Record<string, unknown> | null = null;
          try {
            before = (await modelAccessor(client, model).findUnique({
              where: { id: where.id },
            })) as Record<string, unknown> | null;
          } catch {
            // Skip
          }

          const result = await query(args);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client as any).auditLog.create({
            data: {
              entityType: model,
              entityId: String((before as Record<string, unknown> | null)?.id ?? "unknown"),
              action: "DELETE",
              before: scrub(before ?? undefined),
              userId: ctx.userId,
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
            },
          });

          return result;
        },
      },
    },
  });
});
