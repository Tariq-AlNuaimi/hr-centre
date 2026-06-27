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
  // SjtItem.scoringKey is the keyed best/worst answer — Confidential test-integrity
  // data (SECURITY.md §1). Children are written as nested relation ops today (so the
  // parent op is what's audited), but a top-level SjtItem create/update would land
  // the raw key in audit_logs without this. Defensive ahead of the Phase-4 runner
  // (senior-review T-12). Masked at the API layer; this closes the audit-storage gap.
  "scoringKey",
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
    // Accept any unique selector, not just { id } -- update/delete may target a
    // different unique field (e.g. { email }); the before-snapshot must still work.
    findUnique: (args: { where: Record<string, unknown> }) => Promise<unknown>;
  };
};

// Minimal shape needed to write an audit row through any client (notably
// `prismaUnfiltered`, which is outside the audit extension). `create` is typed
// loosely so Prisma's generated delegate (with its strict input type) remains
// assignable -- same pattern the extension uses for its internal audit writes.
type AuditWriter = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auditLog: { create: (args: any) => Promise<unknown> };
};

/**
 * Explicitly record an audit row for an operation performed OUTSIDE the audit
 * extension (e.g. recycling-bin restore / permanent delete go through
 * `prismaUnfiltered`). Pulls attribution from the request's AuditContext and
 * scrubs Restricted fields, identical to the automatic extension path.
 */
export async function recordAudit(
  client: AuditWriter,
  entry: {
    entityType: string;
    entityId: string;
    action: "CREATE" | "UPDATE" | "DELETE" | "RESTORE";
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  }
) {
  const ctx = getAuditContext();
  await client.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: scrub(entry.before ?? undefined),
      after: scrub(entry.after ?? undefined),
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });
}

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
              orgId: ctx.orgId,
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
          const where = args.where as Record<string, unknown>;

          let before: Record<string, unknown> | null = null;
          try {
            before = (await modelAccessor(client, model).findUnique({
              where,
            })) as Record<string, unknown> | null;
          } catch {
            // Model might not have a simple unique lookup - skip before snapshot
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
              orgId: ctx.orgId,
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
          const where = args.where as Record<string, unknown>;

          let before: Record<string, unknown> | null = null;
          try {
            before = (await modelAccessor(client, model).findUnique({
              where,
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
              orgId: ctx.orgId,
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
