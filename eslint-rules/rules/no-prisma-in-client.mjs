// Rule: no-prisma-in-client
//
// Files marked "use client" must not import the Prisma client. Client
// components call /api/*; the API handler is the only place that touches
// Prisma. CLAUDE.md ‘Hard rules’: "UI -> API route -> service -> Prisma."

const PRISMA_LIB_PATHS = ["@/lib/prisma", "@/lib/prisma/client"];

function isUseClientDirective(stmt) {
  if (!stmt || stmt.type !== "ExpressionStatement") return false;
  const expr = stmt.expression;
  if (!expr || expr.type !== "Literal") return false;
  return expr.value === "use client";
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prevent importing the Prisma client in files marked 'use client'.",
    },
    messages: {
      noPrismaInClient:
        "Files marked 'use client' must not import from {{ path }}. Client components call /api/*; the API handler is the only place that touches Prisma. See CLAUDE.md Hard rules.",
    },
    schema: [],
  },
  create(context) {
    let isClient = false;
    return {
      Program(node) {
        for (const stmt of node.body) {
          if (isUseClientDirective(stmt)) {
            isClient = true;
            return;
          }
          // Once we hit something that's not a string-literal directive, stop.
          if (
            stmt.type !== "ExpressionStatement" ||
            !stmt.expression ||
            stmt.expression.type !== "Literal"
          ) {
            return;
          }
        }
      },
      ImportDeclaration(node) {
        if (!isClient) return;
        const src = node.source && node.source.value;
        if (typeof src !== "string") return;
        if (
          PRISMA_LIB_PATHS.includes(src) ||
          src.endsWith("/lib/prisma") ||
          src.endsWith("/lib/prisma/client")
        ) {
          context.report({
            node,
            messageId: "noPrismaInClient",
            data: { path: src },
          });
        }
      },
    };
  },
};
