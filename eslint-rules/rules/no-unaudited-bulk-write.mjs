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
// Flags these methods only when called on the `prisma` / `prismaUnfiltered`
// clients against an AUDITED model. Models in the audit EXCLUDE set
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
const EXCLUDED_ACCESSORS = new Set([
  "auditLog",
  "account",
  "session",
  "verificationToken",
]);

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
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;

        const method = propName(callee);
        if (!method || !BULK_METHODS.has(method)) return;

        // callee.object should be `<root>.<model>` (the model delegate).
        const modelExpr = unwrap(callee.object);
        if (!modelExpr || modelExpr.type !== "MemberExpression") return;

        const root = unwrap(modelExpr.object);
        if (!root || root.type !== "Identifier" || !PRISMA_ROOTS.has(root.name)) {
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
