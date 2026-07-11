// Rule: no-unaudited-bulk-write
//
// The audit extension (lib/prisma/audit-extension.ts) hooks only the per-row
// `create` / `update` / `delete` queries on `$allModels`. Prisma's bulk and
// upsert operations -- `updateMany`, `createMany`, `deleteMany`, `upsert`
// (and the `*AndReturn` variants) -- are NOT decomposed into per-row queries
// the extension can observe, so they write NO audit row. `deleteMany` also
// bypasses the soft-delete extension entirely (a hard delete).
//
// This is the ADR-010 / SECURITY.md §5 "bulk-write / upsert blind spot": a
// silent gap in an audit trail the template promises is automatic. Documenting
// it is not enough for a template -- every fork inherits the footgun -- so this
// rule turns the invariant into an enforced gate.
//
// Flags these methods when called on the `prisma` / `prismaUnfiltered`
// clients -- or a tracked alias of them: a local `const db = prisma` re-bind,
// or the `tx` parameter of a `prisma.$transaction(async (tx) => ...)` callback
// (the extension carries through `tx`, so `tx.user.updateMany(...)` is the
// same bypass) -- against an AUDITED model. Models in the audit EXCLUDE set
// (AuditLog, Account, Session, VerificationToken) are not audited, so bulk ops
// on them are fine and are exempt -- mirroring the extension's own EXCLUDE.
//
// Escape hatch (the CLAUDE.md "single-line disable" convention): if you must
// bulk-write, loop per-row through the audited client, OR write an explicit
// `recordAudit()` row alongside the op and suppress this rule on that one line.
//
// CLAUDE.md 'Hard rules': "Audit is automatic but fragile." See ADR-010.

const BULK_METHODS = new Set([
  "updateMany",
  "createMany",
  "deleteMany",
  "upsert",
  "createManyAndReturn",
  "updateManyAndReturn",
]);

const PRISMA_ROOTS = new Set(["prisma", "prismaUnfiltered"]);

// camelCase accessors for the models in the audit extension's EXCLUDE set.
// Bulk writes on these are not audited by design, so they're allowed.
const EXCLUDED_ACCESSORS = new Set(["auditLog", "account", "session", "verificationToken"]);

// Unwrap TS type-assertion / non-null wrappers so `(prisma as any).user...`
// and `prisma!.user...` are still recognized as rooted at `prisma`.
function unwrap(node) {
  let n = node;
  while (
    n &&
    (n.type === "TSAsExpression" ||
      n.type === "TSNonNullExpression" ||
      n.type === "TSSatisfiesExpression")
  ) {
    n = n.expression;
  }
  return n;
}

// Resolve a member's property name whether it's `.user` (Identifier) or
// `["user"]` (computed string Literal).
function propName(member) {
  if (!member || member.type !== "MemberExpression") return null;
  if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
  if (member.computed && member.property.type === "Literal") {
    return typeof member.property.value === "string" ? member.property.value : null;
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Prisma bulk-write / upsert ops on audited models -- they bypass the audit extension and write no audit row (ADR-010).",
    },
    messages: {
      noBulkWrite:
        "`{{ root }}.{{ model }}.{{ method }}(...)` bypasses the audit extension and writes NO audit row (ADR-010 / SECURITY.md §5). Loop per-row through the audited client, or write an explicit `recordAudit()` row alongside this op and add a justified single-line eslint-disable. `deleteMany` also skips soft-delete (hard delete).",
    },
    schema: [],
  },
  create(context) {
    // Identifiers that resolve to the (audit-extended) Prisma client in THIS
    // file. Seeded with the canonical roots, then grown as we discover aliases
    // so the gate isn't trivially escaped by renaming the client:
    //   - `const db = prisma`            (local re-binding)
    //   - `prisma.$transaction(async (tx) => { ... })`  -- `tx` IS the extended
    //     client (extensions carry through), so `tx.user.updateMany(...)` is
    //     the same audit bypass; this is the textbook atomicity idiom a fork
    //     reaches for first. A flat per-file set is intentionally simple: it
    //     never removes names, so a later unrelated `tx` could be flagged --
    //     acceptable, since the fix (per-row writes or a justified disable) is
    //     the same and false positives here fail loud, not silent.
    const aliases = new Set(PRISMA_ROOTS);

    function isPrismaLikeRoot(node) {
      const n = unwrap(node);
      return n && n.type === "Identifier" && aliases.has(n.name);
    }

    return {
      // `const db = prisma` / `const db = prismaUnfiltered` -> track `db`.
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || !node.init) return;
        if (isPrismaLikeRoot(node.init)) aliases.add(node.id.name);
      },

      // Assignment-form rebindings: `let db; db = prisma;` and, inside a
      // `$transaction(async (tx) => ...)` callback, `db = tx;` -- the declarator
      // hook above only sees `const x = <init>`, so without this a rebind via a
      // bare assignment (or a re-alias of `tx`) would slip the gate (SR-M3).
      AssignmentExpression(node) {
        if (
          node.operator === "=" &&
          node.left.type === "Identifier" &&
          isPrismaLikeRoot(node.right)
        ) {
          aliases.add(node.left.name);
        }
      },

      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;

        const method = propName(callee);

        // Register `$transaction(async (tx) => ...)` callback params as aliases
        // BEFORE we descend into the callback body (ESLint visits the outer
        // call before its arguments), so inner `tx.<model>.<bulk>()` is caught.
        if (
          method === "$transaction" &&
          isPrismaLikeRoot(callee.object) &&
          node.arguments.length > 0
        ) {
          const cb = node.arguments[0];
          if (
            (cb.type === "ArrowFunctionExpression" || cb.type === "FunctionExpression") &&
            cb.params[0] &&
            cb.params[0].type === "Identifier"
          ) {
            aliases.add(cb.params[0].name);
          }
          return;
        }

        if (!method || !BULK_METHODS.has(method)) return;

        // callee.object should be `<root>.<model>` (the model delegate).
        const modelExpr = unwrap(callee.object);
        if (!modelExpr || modelExpr.type !== "MemberExpression") return;

        const root = unwrap(modelExpr.object);
        if (!root || root.type !== "Identifier" || !aliases.has(root.name)) {
          return;
        }

        const model = propName(modelExpr);
        // Unknown / dynamic accessor: be conservative and skip (can't tell if
        // it's an excluded model). Exempt the audit EXCLUDE set.
        if (!model || EXCLUDED_ACCESSORS.has(model)) return;

        context.report({
          node,
          messageId: "noBulkWrite",
          data: { root: root.name, model, method },
        });
      },
    };
  },
};
