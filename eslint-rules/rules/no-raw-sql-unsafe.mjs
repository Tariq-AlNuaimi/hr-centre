// Rule: no-raw-sql-unsafe
//
// Prisma's `$queryRawUnsafe` / `$executeRawUnsafe` take a plain string and do
// NOT parameterize it -- any interpolated user input is a SQL-injection vector
// (OWASP A03). The safe, parameterized forms are the tagged-template
// `$queryRaw` / `$executeRaw` (``$queryRaw`SELECT ... WHERE id = ${id}` ``),
// which Prisma binds as placeholders. CLAUDE.md 'Hard rules': "No raw SQL
// except `$queryRaw`/`$executeRaw` with parameter placeholders; never
// `$executeRawUnsafe` on user input."
//
// This rule bans the `*Unsafe` methods outright at `error`. The method names
// are Prisma-specific, so it flags them on any receiver (no need to resolve the
// client identifier) -- which also closes aliasing. If you have genuinely
// constant, non-user SQL that must use the Unsafe form (e.g. a dynamic table
// name you fully control), suppress on that one line with a justification (the
// CLAUDE.md single-line-disable convention) and log it in SECURITY.md §12 if
// security-relevant.

const UNSAFE_METHODS = new Set(["$queryRawUnsafe", "$executeRawUnsafe"]);

function methodName(member) {
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
        "Ban Prisma `$queryRawUnsafe` / `$executeRawUnsafe` -- unparameterized raw SQL is an injection vector (OWASP A03). Use the tagged-template `$queryRaw`/`$executeRaw`.",
    },
    messages: {
      noRawSqlUnsafe:
        "`{{ method }}` does not parameterize its SQL string -- interpolated input is a SQL-injection vector (OWASP A03). Use the tagged-template `$queryRaw`/`$executeRaw` form (Prisma binds `${...}` as placeholders). See CLAUDE.md Hard rules / SECURITY.md §10. If the SQL is genuinely constant, suppress on this line with a justification.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const method = methodName(node.callee);
        if (!method || !UNSAFE_METHODS.has(method)) return;
        context.report({
          node,
          messageId: "noRawSqlUnsafe",
          data: { method },
        });
      },
    };
  },
};
