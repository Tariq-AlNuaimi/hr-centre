// Rule: no-bare-prisma-transaction
//
// `prisma.$transaction(async (tx) => …)` audits its writes on the WRONG client.
//
// The audit extension is built by `defineExtension((client) => …)` and closes
// over that outer client. Inside a transaction the write runs on `tx`, but the
// extension's `auditLog.create` runs on the captured client -- a different
// connection, a different transaction. The two therefore commit independently,
// and a rolled-back transaction leaves its audit row behind: the trail asserts a
// change that never happened. The soft-delete extension writes its own rows the
// same way and had the same gap.
//
// `auditedTransaction` (lib/prisma.ts) publishes the transaction client on an
// AsyncLocalStorage that both extensions read, so the audit row is written BY
// the transaction and shares its fate exactly. ADR-068 has the reasoning and the
// measurement; lib/prisma/tx-context.ts has the mechanism.
//
// WHY A LINT RULE AND NOT A CONVENTION. This failure is invisible to every test
// that exercises a transaction, because transactions in tests commit -- the
// audit row is there, and it is correct. Nothing about a bare `$transaction`
// looks wrong at the call site either. A mechanism that can be forgotten will be
// forgotten, and will fail the same silent way it already failed once.
//
// Flags `$transaction` called on `prisma` (or a tracked local alias of it).
// `prismaUnfiltered` is NOT flagged: it is deliberately outside both extensions,
// so it writes no audit rows to misplace, and the recycling bin's explicit
// `recordAudit(prismaUnfiltered, …)` already passes its client by hand.
//
// Escape hatch (the CLAUDE.md single-line-disable convention): a transaction
// that provably writes nothing audited -- a read-only batch, or one touching
// only the audit EXCLUDE set -- may suppress this rule on that one line with a
// comment saying which.
//
// CLAUDE.md 'Hard rules': "Audit is automatic but fragile." See ADR-010, ADR-068.

const PRISMA_ROOTS = new Set(["prisma"]);

// Unwrap TS type-assertion / non-null wrappers so `(prisma as any).$transaction`
// and `prisma!.$transaction` are still recognized as rooted at `prisma`.
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

function propName(member) {
  if (!member || member.type !== "MemberExpression") return null;
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.computed && member.property.type === "Literal") return String(member.property.value);
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Interactive transactions must go through auditedTransaction(), so the audit row " +
        "is written by the transaction and rolls back with it (ADR-068).",
    },
    schema: [],
    messages: {
      bareTransaction:
        "`{{root}}.$transaction(...)` writes its audit rows on the OUTER client, so a " +
        "rolled-back transaction leaves audit rows asserting changes that never happened " +
        "(ADR-068). Use `auditedTransaction(...)` from @/lib/prisma instead — it takes the " +
        "same callback and options. If this transaction provably writes nothing audited, " +
        "disable this rule on that one line and say which.",
    },
  },

  create(context) {
    // Local re-binds of the client (`const db = prisma`) count as the same root,
    // matching how no-unaudited-bulk-write tracks aliases.
    const aliases = new Set(PRISMA_ROOTS);

    return {
      VariableDeclarator(node) {
        if (
          node.id.type === "Identifier" &&
          node.init &&
          unwrap(node.init).type === "Identifier" &&
          aliases.has(unwrap(node.init).name)
        ) {
          aliases.add(node.id.name);
        }
      },

      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (!callee || callee.type !== "MemberExpression") return;
        if (propName(callee) !== "$transaction") return;

        const root = unwrap(callee.object);
        if (!root || root.type !== "Identifier" || !aliases.has(root.name)) return;

        context.report({ node, messageId: "bareTransaction", data: { root: root.name } });
      },
    };
  },
};
