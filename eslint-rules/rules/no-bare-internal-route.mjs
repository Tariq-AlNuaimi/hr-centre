// Rule: no-bare-internal-route
//
// Files matching app/api/internal/**/route.ts(x) must export their HTTP
// handlers wrapped with `withInternalAuth(tokenEnv, handler)`. The header
// check is the *only* gate on these routes (middleware lets /api/internal/*
// pass through unauthenticated by design). A bare handler exposes the
// endpoint to anyone.

const HANDLER_NAMES = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);
const INTERNAL_ROUTE_PATTERN = /[\\/]app[\\/]api[\\/]internal[\\/].*route\.tsx?$/;

function wrapsWithInternalAuth(initNode) {
  if (!initNode) return false;
  if (initNode.type !== "CallExpression") return false;
  const callee = initNode.callee;
  if (callee.type === "Identifier" && callee.name === "withInternalAuth") return true;
  // Allow `withInternalAuth(...).then(...)` style by walking the outer call’s callee.
  if (callee.type === "MemberExpression" && callee.object) {
    return wrapsWithInternalAuth(callee.object);
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Handlers under app/api/internal/ must wrap with withInternalAuth.",
    },
    messages: {
      noBareInternalRoute:
        "Handlers in app/api/internal/ must wrap with `withInternalAuth(tokenEnv, handler)` from @/lib/api-helpers. Bare handlers bypass the shared-secret gate -- the middleware lets /api/internal/* through unauthenticated by design.",
    },
    schema: [],
  },
  create(context) {
    const filename =
      (typeof context.filename === "string" && context.filename) ||
      (typeof context.getFilename === "function" && context.getFilename()) ||
      "";
    if (!INTERNAL_ROUTE_PATTERN.test(filename)) return {};
    return {
      ExportNamedDeclaration(node) {
        if (!node.declaration || node.declaration.type !== "VariableDeclaration") return;
        for (const decl of node.declaration.declarations) {
          if (!decl.id || decl.id.type !== "Identifier") continue;
          if (!HANDLER_NAMES.has(decl.id.name)) continue;
          if (wrapsWithInternalAuth(decl.init)) continue;
          context.report({ node: decl, messageId: "noBareInternalRoute" });
        }
      },
    };
  },
};
