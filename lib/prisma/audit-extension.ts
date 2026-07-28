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

/**
 * Redact SCRUB_FIELDS anywhere in the payload — RECURSIVELY, through nested
 * objects and arrays.
 *
 * It was one level deep until 2026-07-25, while its twin `scrubContext` in
 * `lib/sentry.ts` already recursed over the same SCRUB_FIELDS set. That gap was
 * silent but real: an audited write carrying a relation, e.g.
 * `prisma.user.update({ where, data, include: { accounts: true } })`, wrote
 * `after.accounts[0].access_token` / `refresh_token` / `id_token` VERBATIM into
 * `audit_logs` — a table retained 365 days and served to admins by
 * `GET /api/audit-log`. That reopened finding T-03 for any fork that includes a
 * relation on an audited write. `tests/contracts/audit-scrub.test.ts` now asserts
 * the nested case so it cannot regress silently again.
 *
 * Dates are passed through untouched (they are objects, but have no fields to
 * redact and must survive as Dates for JSON serialization).
 */
// Recursion depth cap. Audit payloads are Prisma rows, not arbitrary graphs; 12
// is far past any realistic include-depth while bounding a pathological input.
const MAX_SCRUB_DEPTH = 12;

/**
 * Only PLAIN objects get rebuilt key-by-key. Everything else is passed through by
 * reference so it serializes the way it would have before this function existed.
 *
 * This guard is why the first recursive cut was wrong: it treated every non-Date
 * object as a record, so a Prisma `Decimal` was stored as its internal
 * `{s,e,d}` form instead of "12.34", and a `Bytes` column (Uint8Array) became
 * `{"0":1,"1":2,...}` — a 1 MB blob turning into a million-key JSON object in a
 * 365-day-retained table. Neither type is in the baseline schema, so it was a
 * fork-facing regression: `Decimal` is the single most common hand-added column
 * type, and money is exactly the field an auditor reads.
 */
function isPlainObject(v: object): boolean {
  if (Array.isArray(v)) return false;
  if (v instanceof Date) return false;
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return false; // Bytes / Buffer
  if (typeof (v as { toJSON?: unknown }).toJSON === "function") return false; // Decimal & friends
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function scrubValue(v: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (!v || typeof v !== "object") return v;
  const obj = v as object;
  // Cycle guard. Prisma's own results are trees, but `recordAudit()` is exported
  // and takes caller-supplied objects, so a cycle is reachable. Without this the
  // RangeError propagates — and in the `update` path the row is ALREADY committed
  // when scrub runs, so the failure mode was: data changed, no audit row, 500 to
  // the caller. An audit gap must never be how a successful write fails.
  if (seen.has(obj)) return "[circular]";
  if (depth >= MAX_SCRUB_DEPTH) return "[truncated]";
  if (Array.isArray(obj)) {
    seen.add(obj);
    const out = obj.map((item) => scrubValue(item, seen, depth + 1));
    seen.delete(obj);
    return out;
  }
  if (!isPlainObject(obj)) return v;
  seen.add(obj);
  const out = scrubObject(obj as Record<string, unknown>, seen, depth + 1);
  seen.delete(obj);
  return out;
}

function scrubObject(
  obj: Record<string, unknown>,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const value = SCRUB_FIELDS.has(k) ? (v == null ? v : "[redacted]") : scrubValue(v, seen, depth);
    // defineProperty, not `out[k] = …`: a plain assignment with k === "__proto__"
    // hits the prototype SETTER on the fresh object literal, so the key never
    // becomes an own property and that slice of a user-controlled Json column
    // silently VANISHES from the audit row while surviving in the DB. Scaffolded
    // `json` fields validate with z.any(), so arbitrary keys do reach Prisma.
    Object.defineProperty(out, k, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

export function scrub<T extends Record<string, unknown> | null | undefined>(obj: T): T {
  if (!obj) return obj;
  // Seed the ROOT into the cycle guard. Without this a self-reference
  // (`node.self = node`) is not detected -- the guard only ever saw objects
  // reached THROUGH a property, never the entry object itself.
  const seen = new WeakSet<object>();
  seen.add(obj);
  return scrubObject(obj, seen, 0) as T;
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
  },
) {
  const ctx = getAuditContext();
  await client.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: scrub(entry.before ?? undefined),
      after: scrub(entry.after ?? undefined),
      userId: ctx.userId,
      actorEmail: ctx.actorEmail,
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
  after: Record<string, unknown>,
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
        // Recurse into the value, not just the key. A top-level key like
        // `accounts` is not itself Restricted, but the objects underneath it
        // carry access_token/refresh_token — and `changes` is one of the fields
        // GET /api/audit-log returns, so an unscrubbed nested value is served
        // straight to the admin UI (2026-07-25 security review).
        changes[key] = {
          from: scrubValue(before[key], new WeakSet(), 0),
          to: scrubValue(after[key], new WeakSet(), 0),
        };
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
              actorEmail: ctx.actorEmail,
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
              userId: ctx.userId,
              actorEmail: ctx.actorEmail,
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
              userId: ctx.userId,
              actorEmail: ctx.actorEmail,
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
