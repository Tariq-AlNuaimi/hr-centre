// Rule: no-prisma-in-client
//
// Files marked "use client" must not import the Prisma client. Client
// components call /api/*; the API handler is the only place that touches
// Prisma. CLAUDE.md ‘Hard rules’: "UI -> API route -> service -> Prisma."

// Both the barrel (`@/lib/prisma`) AND the generated client (`generated/prisma`,
// where the real `PrismaClient` lives -- see .claude/rules/prisma.md). A
// "use client" file importing `PrismaClient` from `@/generated/prisma/client`
// was previously invisible to this rule (V2 challenge-audit M5).
const PRISMA_LIB_PATHS = [
  "@/lib/prisma",
  "@/lib/prisma/client",
  "@/generated/prisma",
  "@/generated/prisma/client",
];

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
      description: "Prevent importing the Prisma client in files marked 'use client'.",
    },
    messages: {
      noPrismaInClient:
        "Files marked 'use client' must not import from {{ path }}. Client components call /api/*; the API handler is the only place that touches Prisma. See CLAUDE.md Hard rules.",
    },
    schema: [],
  },
  create(context) {
    let isClient = false;

    function isPrismaPath(src) {
      if (typeof src !== "string") return false;
      return (
        PRISMA_LIB_PATHS.includes(src) ||
        src.endsWith("/lib/prisma") ||
        src.endsWith("/lib/prisma/client") ||
        src.endsWith("/generated/prisma") ||
        src.endsWith("/generated/prisma/client") ||
        /(^|\/)generated\/prisma(\/client)?$/.test(src)
      );
    }

    function reportIfPrisma(node, src) {
      if (isPrismaPath(src)) {
        context.report({ node, messageId: "noPrismaInClient", data: { path: src } });
      }
    }

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
      // import x from "@/lib/prisma"
      ImportDeclaration(node) {
        if (!isClient) return;
        reportIfPrisma(node, node.source && node.source.value);
      },
      // export { prisma } from "@/lib/prisma"  /  export * from "@/lib/prisma"
      ExportNamedDeclaration(node) {
        if (!isClient || !node.source) return;
        reportIfPrisma(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        if (!isClient || !node.source) return;
        reportIfPrisma(node, node.source.value);
      },
      // const p = await import("@/lib/prisma")
      ImportExpression(node) {
        if (!isClient) return;
        if (node.source && node.source.type === "Literal") {
          reportIfPrisma(node, node.source.value);
        }
      },
    };
  },
};
