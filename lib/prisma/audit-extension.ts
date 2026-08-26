import { Prisma } from "../../generated/prisma/client";
import { getAuditContext } from "../audit-context";
import { currentAuditWriter, type AuditWriter } from "./tx-context";

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
  // Restricted compensation data (SECURITY.md §1; PMS spec §4.5 / §11.6). An
  // employee's basic salary is visible only to HR and the COO/Ops Director —
  // never to a line manager, not even for their own direct reports. Without
  // this entry, an ordinary audited write to `employees` would copy the figure
  // verbatim into `audit_logs.before/after`, a table retained 365 days and
  // served to platform admins by `GET /api/audit-log` — routing the most
  // tightly held field in the system around its own access control.
  // The row still records THAT salary changed, which is the auditable fact.
  "basicSalary",
  "basic_salary",
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

// `AuditWriter` — the minimal shape needed to write an audit row through any
// client (notably `prismaUnfiltered`, which is outside the audit extension, and
// a `$transaction` handle) — now lives in `./tx-context`, because that module's
// whole job is swapping one such writer for another (ADR-068). One definition,
// two readers.

/**
 * Explicitly record an audit row for an operation performed OUTSIDE the audit
 * extension (e.g. recycling-bin restore / permanent delete go through
 * `prismaUnfiltered`; a conditional `updateMany` the bulk-write rule refuses).
 * Pulls attribution from the request's AuditContext and scrubs Restricted
 * fields, identical to the automatic extension path.
 *
 * `changes` is computed here too, when the caller supplies both halves. Without
 * it an explicitly-audited write landed with `before` and `after` populated and
 * `changes: null` — the same shape a no-op update produces, so the one field
 * `GET /api/audit-log` renders as "what actually changed" said nothing.
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
  // Diff the RAW pair. `computeChanges` does its own redaction per field, so a
  // Restricted column still records THAT it changed — scrubbing first would
  // compare "[redacted]" with "[redacted]" and make a salary edit, or a
  // password reset, vanish from `changes` entirely. ADR-065 leans on this trail
  // for exactly those writes.
  //
  // Diffing reaches `JSON.stringify`, and a cyclic snapshot would throw AFTER
  // the write has committed — data changed, no audit row, 500. `scrub` carries
  // a cycle guard; this is the equivalent for the diff.
  let changes: Record<string, { from: unknown; to: unknown }> | null = null;
  try {
    if (entry.before && entry.after) {
      changes = changesOverSharedKeys(entry.before, entry.after);
    }
  } catch {
    // A snapshot the differ cannot walk. The row itself is worth more than the
    // field, so record the write and leave `changes` null.
  }
  await client.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: scrub(entry.before ?? undefined),
      after: scrub(entry.after ?? undefined),
      changes,
      userId: ctx.userId,
      actorEmail: ctx.actorEmail,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });
}

/**
 * `computeChanges` restricted to keys BOTH objects carry.
 *
 * `recordAudit`'s callers hand-build their two snapshots, and they rarely have
 * the same shape — `POST /api/projects` passes a name on one side and a
 * membership list on the other. Diffing the union would report every key one
 * side happens to lack as a change from `undefined`, so an audit trail meant to
 * say what moved would name fields nobody touched.
 *
 * The trade is under-reporting at those same asymmetric call sites: a key only
 * one side carries yields nothing rather than a false entry. That is the right
 * way round for an audit trail, and it is strictly better than what those
 * callers had before, which was no `changes` at all.
 *
 * **The callers were made symmetric on 2026-08-26** — the under-reporting this
 * paragraph used to describe as an accepted trade was costing real fields: the
 * decider and reason on a §6.2 decision, the reason on a §13.2 reversal, and the
 * membership on a §9.6 project (which recorded a COUNT, so a swap of one person
 * for another diffed to nothing). Each is now named on both sides, with `null`
 * on the `before` where the row genuinely held nothing. `POST /api/three-sixty/
 * assignments` keeps one deliberate one-sided key and says why at the call site.
 *
 * So this function is now a BACKSTOP rather than a working compromise: it exists
 * so a future caller that forgets symmetry under-reports instead of inventing a
 * change from `undefined`. Integration tests assert the symmetry at each call
 * site, because that is where it can actually be lost.
 */
function changesOverSharedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> | null {
  const shared: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (key in before) shared[key] = after[key];
  }
  return computeChanges(before, shared);
}

function modelAccessor(client: unknown, model: string) {
  const key = model[0].toLowerCase() + model.slice(1);
  return (client as AnyClient)[key];
}

/** Prisma's atomic numeric operators. */
const ATOMIC_OPS = ["increment", "decrement", "multiply", "divide"] as const;

/**
 * Every key Prisma allows in a scalar-update envelope.
 *
 * An object counts as an envelope only when ALL its keys are from this set. A
 * `Json` column's value can legitimately contain a key called `set` or
 * `increment` — matching on "does this key appear" would unwrap the user's own
 * data and record a fragment of it as the whole column.
 */
const ENVELOPE_KEYS = new Set<string>([...ATOMIC_OPS, "set", "push", "unset"]);

/** An object Prisma would store as a Json column or a scalar list, not a wrapper. */
function isPlainValue(v: unknown): boolean {
  if (v === null || typeof v !== "object" || v instanceof Date) return false;
  return Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype;
}

/**
 * "Are these the same value?", across the representations one column takes.
 *
 * A `Decimal` and the number that equals it must compare equal — a route
 * validating with `z.coerce.number()` writes a number into a `Decimal(5,2)`
 * column, and reporting `"40" → 40` as a change would fill the trail with noise
 * (2026-08-26 review). Structural comparison is used for the things `String()`
 * flattens to `[object Object]`: Json columns and scalar lists.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (isPlainValue(a) || isPlainValue(b)) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  if (a instanceof Date || b instanceof Date) {
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
    return iso(a) === iso(b);
  }
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null);
  return String(a) === String(b);
}

/**
 * Overlay what the write demonstrably changed onto a snapshot of the row.
 *
 * ## Why this exists at all
 *
 * The re-read below is complete and correct — outside a transaction. Inside an
 * interactive `$transaction` it is neither: `Prisma.defineExtension((client) =>
 * …)` closes over the OUTER client before any transaction exists, and a query
 * extension has no way to reach the `tx` handle (a documented Prisma
 * limitation). So the re-read ran on a different connection, could not see the
 * uncommitted write, and returned the row exactly as it was — `computeChanges`
 * then diffed a value against itself and the audit row landed with
 * `changes: null`. Thirteen `$transaction` routes were affected, every 360 form
 * submission among them, and the failure was silent: the worst property an
 * audit trail can have.
 *
 * So: re-read (right outside a transaction, harmless inside), then overlay the
 * write's own `data` on top (right in both). Neither alone is sufficient.
 *
 * ## What it will and will not touch
 *
 * Only keys ALREADY PRESENT on the snapshot. `before` is fetched with no select,
 * so its keys are exactly this row's scalar columns — which means a nested
 * relation write (`connect`, `create`, …) is skipped for free rather than needing
 * a list of operator names to recognise, and no key the row does not have can be
 * invented. `undefined` is skipped too: passing it is this repo's partial-update
 * idiom, and treating it as a value would fabricate changes on every edit.
 *
 * A `Decimal`, a scalar list and a `Json` column are all objects, and all are
 * VALUES — only the atomic operators and `{ set }` are envelopes, and both are
 * matched by name.
 */
export function projectUpdate(
  snapshot: Record<string, unknown>,
  data: unknown,
): Record<string, unknown> {
  if (data === null || typeof data !== "object") return { ...snapshot };
  const merged: Record<string, unknown> = { ...snapshot };

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    // Not a scalar column of this row (a relation write), or the caller's way
    // of saying "leave this alone".
    if (!(key in snapshot) || value === undefined) continue;

    if (value === null || typeof value !== "object" || value instanceof Date) {
      merged[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      // A scalar list — `pmsRoles`, for instance. Granting a role must be
      // visible in `changes`; that is the whole point of ADR-065's trail.
      merged[key] = value;
      continue;
    }

    const op = value as Record<string, unknown>;
    const keys = Object.keys(op);
    const isEnvelope = keys.length > 0 && keys.every((k) => ENVELOPE_KEYS.has(k));
    if (!isEnvelope) {
      // A Decimal, or a Json column's object value. Both are values.
      merged[key] = value;
      continue;
    }
    if ("set" in op) {
      merged[key] = op.set;
      continue;
    }
    const atomic = ATOMIC_OPS.find((name) => name in op);
    if (atomic) {
      const current = merged[key];
      const operand = op[atomic];
      // A `Decimal` operand is legal on this schema's several Decimal columns.
      // We cannot compute it here, and writing the envelope into `after` as if
      // it were the new value would be worse than saying nothing.
      if (typeof current !== "number" || typeof operand !== "number") continue;
      if (atomic === "increment") merged[key] = current + operand;
      else if (atomic === "decrement") merged[key] = current - operand;
      else if (atomic === "multiply") merged[key] = current * operand;
      else merged[key] = current / operand;
      continue;
    }

    // `push`, `unset`, or an operator we cannot evaluate here. Writing the
    // envelope in as if it were the new value would be worse than silence.
  }

  return merged;
}

/**
 * Overlay the write, but only where the re-read saw nothing happen.
 *
 * The re-read is authoritative when it works, and it holds the column's REAL
 * type — a `Decimal` where the route passed a plain number, a coerced date
 * where it passed a string. Overlaying the caller's raw value on top of a
 * re-read that already reflects the write invents differences that are about
 * JavaScript types rather than about the data: `PUT /api/kpis/[id]` sends
 * `weightage` as a number into a `Decimal(5,2)`, so an editor changing only a
 * description would have recorded `weightage: "40" → 40`.
 *
 * So the overlay applies to a key only where the re-read still shows the
 * `before` value — the signature of the in-transaction case, where the re-read
 * ran on a connection that could not see the write. There, the write's own
 * `data` is the only evidence there is. Values are compared as strings so a
 * `Decimal` and the number that equals it do not read as a change.
 */
function overlayUnobserved(
  before: Record<string, unknown>,
  observed: Record<string, unknown>,
  data: unknown,
): Record<string, unknown> {
  const projected = projectUpdate(before, data);
  const merged: Record<string, unknown> = { ...observed };

  for (const key of Object.keys(projected)) {
    if (!(key in observed)) continue;
    // The re-read already reflects this column — trust it, types and all.
    if (!sameValue(observed[key], before[key])) continue;
    // Nothing to say: the write's value matches what is already there.
    if (sameValue(projected[key], before[key])) continue;
    merged[key] = projected[key];
  }

  return merged;
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
          await currentAuditWriter(client as any).auditLog.create({
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

          // Diff against the FULL row, not the caller's projection.
          //
          // `computeChanges` iterates the keys of its `after`, and the caller's
          // `after` is whatever they selected. A route that narrows its select —
          // `app/api/users/[id]/route.ts` returns six columns — would hide every
          // change to a column outside it. The observed consequence: an admin
          // resetting another user's password produced `UPDATE | User | changes:
          // null`, indistinguishable from an admin fixing a typo in their name,
          // because `passwordHash` was never in `after` to be compared.
          //
          // That matters more than an ordinary audit gap. ADR-065 accepts that a
          // platform admin can reach HR Super Admin access, and the compensating
          // control it names is the audit trail — so the trail must be able to
          // show the one action that grants it.
          //
          // `before` was fetched with no select, so it is complete; re-reading
          // makes `after` complete too. A null result means the row is no longer
          // readable — the update soft-deleted it and the soft-delete extension
          // filters it out — in which case the caller's projection is kept.
          //
          // Then the write is overlaid, because inside an interactive
          // transaction this re-read cannot see it (see `projectUpdate`). One
          // field the overlay cannot supply is `updatedAt`: Prisma sets it, so
          // in a transaction it stays at its pre-update value. `computeChanges`
          // ignores that column, and the audit row carries its own timestamp.
          let afterForDiff = after;
          if (before && after?.id != null) {
            try {
              const full = (await modelAccessor(client, model).findUnique({
                where: { id: after.id },
              })) as Record<string, unknown> | null;
              if (full) afterForDiff = full;
            } catch {
              // Model has no simple `id` lookup — keep the projection.
            }
          }
          if (before) afterForDiff = overlayUnobserved(before, afterForDiff, args.data);

          const isSoftDelete = before && !before.deletedAt && afterForDiff.deletedAt;
          const isRestore = before && before.deletedAt && !afterForDiff.deletedAt;

          let action = "UPDATE";
          if (isSoftDelete) action = "DELETE";
          if (isRestore) action = "RESTORE";

          const changes = before ? computeChanges(before, afterForDiff) : null;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await currentAuditWriter(client as any).auditLog.create({
            data: {
              entityType: model,
              entityId: String(after.id),
              action,
              before: scrub(before ?? undefined),
              after: scrub(afterForDiff),
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
          await currentAuditWriter(client as any).auditLog.create({
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
