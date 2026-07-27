// Rule: no-bare-api-route
//
// EVERY handler under app/api/**/route.ts(x) must be wrapped with one of the
// auth wrappers from @/lib/api-helpers, unless its directory is on the explicit
// public allowlist below.
//
// Why this exists (2026-07-25 security review). `no-bare-internal-route` only
// covered app/api/internal/**, on the reasoning that middleware is the backstop
// everywhere else. That backstop has a hole: next.config.ts rewrites
// `/api/v1/:path*` -> `/api/:path*` (ADR-013's versioning seam), and
// i18n/route-decision.ts passes `/api/v1` straight through. So the SAME handler
// has two reachable paths with DIFFERENT auth preconditions -- `/api/reports`
// gets middleware's JSON 401, `/api/v1/reports` gets nothing. Nothing forced a
// wrapper, so the first unwrapped route a fork adds ships unauthenticated on the
// v1 prefix, while the author tests `/api/...`, sees a 401, and reasonably
// concludes it is protected.
//
// Making the wrapper structurally mandatory closes that permanently and does not
// depend on the middleware, the rewrite, or the route-decision list staying in
// sync with each other.
//
// PUBLIC_ROUTE_PATTERNS is deliberately an allowlist, not a denylist: a new
// public route is a decision that has to be made HERE, in a security-reviewed
// file, rather than by omission in a route file.

const HANDLER_NAMES = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);
// `.js`/`.jsx`/`.mjs` are valid Next route files too -- the first cut only matched
// `.tsx?`, so a bare handler in `route.js` was silently unguarded.
const API_ROUTE_PATTERN = /[\\/]app[\\/]api[\\/].*route\.(?:[cm]?js|jsx|tsx?)$/;

// Any wrapper that establishes an authenticated/authorized caller. `withApiAuth`
// is the Bearer seam for machine consumers (ADR-013); `withInternalAuth` is the
// shared-secret gate for schedulers. All of them are gates -- a handler carrying
// any one of them is not "bare".
const AUTH_WRAPPERS = new Set([
  "withAuth",
  "withAdminAuth",
  "withEditorAuth",
  "withInternalAuth",
  "withApiAuth",
]);

// Routes that are public BY DESIGN. Each needs a reason, because each is an
// unauthenticated entry point into the app:
//   - app/api/auth/**        NextAuth's own handler + the password-reset flow.
//                            These ARE the authentication surface; they cannot
//                            require an authenticated session to work.
//   - app/api/health         Liveness probe for uptime monitoring; returns only
//                            DB reachability, no data (SECURITY.md §2).
const PUBLIC_ROUTE_PATTERNS = [
  /[\\/]app[\\/]api[\\/]auth[\\/]/,
  /[\\/]app[\\/]api[\\/]health[\\/]/,
];

// Wrappers a real auth wrapper may legitimately be nested INSIDE. Recursing into
// the arguments of an arbitrary call was unsound (2026-07-25 verification):
// `noop(withAuth(handler))`, where `noop` discards its argument, satisfied the
// rule while exporting an unwrapped handler. Only these compose.
const COMPOSITION_WRAPPERS = new Set(["withRateLimit", "withSpan", "withAiRoute"]);

const API_HELPERS = "@/lib/api-helpers";

/**
 * `authNames` is the set of auth-wrapper identifiers ACTUALLY IMPORTED from
 * @/lib/api-helpers in this file. Matching on the bare name was a soundness gap:
 * a local `function withAuth(h) { return h }`, or an import of `withAuth` from
 * some other module, satisfied the rule while gating nothing. Requiring the
 * binding to come from the real module closes it.
 */
function wrapsWithAuth(node, authNames, compNames) {
  if (!node) return false;
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee.type === "Identifier" && authNames.has(callee.name)) return true;
  // `withX(...).something(...)` -- walk the outer call's callee.
  if (callee.type === "MemberExpression" && callee.object) {
    return wrapsWithAuth(callee.object, authNames, compNames);
  }
  // Composition, e.g. `withRateLimit(withAdminAuth(handler), opts)` -- the
  // REQUIRED order (withRateLimit outside), enforced by no-rate-limit-inside-auth.
  // Only recurse through a KNOWN composition wrapper.
  if (callee.type === "Identifier" && compNames.has(callee.name) && Array.isArray(node.arguments)) {
    return node.arguments.some((a) => wrapsWithAuth(a, authNames, compNames));
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Every handler under app/api/ must wrap with an auth wrapper unless its route is on the public allowlist.",
    },
    messages: {
      noBareApiRouteReexport:
        "A route file must not re-export its handlers from another module (`export { GET } from ...` / `export * from ...`): the auth wrapper cannot be verified from here, and an unwrapped handler is reachable unauthenticated via the `/api/v1` rewrite. Define the handler in this file wrapped with withAuth / withAdminAuth / withEditorAuth / withApiAuth / withInternalAuth.",
      noBareApiRoute:
        "Handler `{{name}}` is not wrapped with an auth wrapper. Use withAuth / withAdminAuth / withEditorAuth / withApiAuth / withInternalAuth from @/lib/api-helpers. Middleware is NOT a sufficient backstop: `/api/v1/*` rewrites onto this handler and bypasses the middleware session gate, so a bare handler is reachable unauthenticated. If this route is genuinely public, add it to PUBLIC_ROUTE_PATTERNS in eslint-rules/rules/no-bare-api-route.mjs (a deliberate, reviewable decision).",
    },
    schema: [],
  },
  create(context) {
    const filename =
      (typeof context.filename === "string" && context.filename) ||
      (typeof context.getFilename === "function" && context.getFilename()) ||
      "";
    if (!API_ROUTE_PATTERN.test(filename)) return {};
    if (PUBLIC_ROUTE_PATTERNS.some((re) => re.test(filename))) return {};

    // Handler bindings declared in this module, so an `export { GET }` further
    // down can be resolved back to its initializer.
    const localHandlers = new Map(); // name -> { wrapped: boolean, node }
    // Auth/composition wrapper names ACTUALLY imported from @/lib/api-helpers.
    // A wrapper is only credited if its binding comes from the real module.
    const authNames = new Set();
    const compNames = new Set();
    // NOTE on ordering: ESLint walks top-down, so `authNames` is populated by the
    // time handlers below the import block are visited -- the only shape this
    // repo (or Prettier's import ordering) produces. A handler declared ABOVE its
    // own import would be judged against an empty set and reported. That is a
    // false POSITIVE, not a false negative: it fails closed, which is the correct
    // direction for an auth gate, and the fix is to move the import up.
    const isWrapped = (init) => wrapsWithAuth(init, authNames, compNames);

    return {
      ImportDeclaration(node) {
        if (node.source.value !== API_HELPERS) return;
        for (const spec of node.specifiers) {
          if (spec.type !== "ImportSpecifier") continue;
          const imported = spec.imported?.name;
          const local = spec.local?.name;
          if (AUTH_WRAPPERS.has(imported)) authNames.add(local);
          if (COMPOSITION_WRAPPERS.has(imported)) compNames.add(local);
        }
      },
      // Record every top-level binding that COULD be exported as a handler later.
      // `async function GET() {}` is never wrapped; `const GET = withAuth(...)` is
      // wrapped only if its init says so.
      FunctionDeclaration(node) {
        if (node.id) localHandlers.set(node.id.name, { wrapped: false, node });
      },
      VariableDeclarator(node) {
        if (node.id?.type === "Identifier") {
          localHandlers.set(node.id.name, { init: node.init, node });
        }
      },
      // `export * from "./handlers"` re-exports an unknown set of bindings; the
      // wrapper cannot be proven from this file, so it is never acceptable in a
      // route. (`no-prisma-in-client` handles export-* for the same reason.)
      ExportAllDeclaration(node) {
        context.report({ node, messageId: "noBareApiRouteReexport" });
      },
      ExportNamedDeclaration(node) {
        // --- specifier forms: `export { GET }`, `export { h as GET }`,
        // --- `export { GET } from "./handlers"`.
        // The first cut bailed on all of these (`if (!node.declaration) return`),
        // which left the idiomatic "define then export" shape completely
        // unguarded -- a live, wrapper-less handler reachable unauthenticated via
        // the /api/v1 rewrite. Verified by RuleTester, 2026-07-25.
        if (!node.declaration) {
          for (const spec of node.specifiers ?? []) {
            const exportedName = spec.exported?.name;
            if (!HANDLER_NAMES.has(exportedName)) continue;
            if (node.source) {
              // Re-export from another module: the initializer is not in this
              // file, so the wrapper is unprovable here.
              context.report({
                node: spec,
                messageId: "noBareApiRouteReexport",
              });
              continue;
            }
            const local = localHandlers.get(spec.local?.name);
            if (local && isWrapped(local.init)) continue;
            context.report({
              node: spec,
              messageId: "noBareApiRoute",
              data: { name: exportedName },
            });
          }
          return;
        }
        // `export const GET = withAuth(...)`
        if (node.declaration.type === "VariableDeclaration") {
          for (const decl of node.declaration.declarations) {
            // `export const { GET } = mod` -- a destructured binding whose value
            // comes from elsewhere; the wrapper is unprovable here.
            if (decl.id?.type === "ObjectPattern") {
              for (const prop of decl.id.properties ?? []) {
                const name = prop.key?.name ?? prop.value?.name;
                if (HANDLER_NAMES.has(name)) {
                  context.report({ node: decl, messageId: "noBareApiRouteReexport" });
                }
              }
              continue;
            }
            if (!decl.id || decl.id.type !== "Identifier") continue;
            if (!HANDLER_NAMES.has(decl.id.name)) continue;
            if (isWrapped(decl.init)) continue;
            context.report({
              node: decl,
              messageId: "noBareApiRoute",
              data: { name: decl.id.name },
            });
          }
          return;
        }
        // `export async function GET() {}` -- a function declaration cannot be
        // wrapped, so it always bypasses every gate.
        if (node.declaration.type === "FunctionDeclaration") {
          const id = node.declaration.id;
          if (id && HANDLER_NAMES.has(id.name)) {
            context.report({
              node: node.declaration,
              messageId: "noBareApiRoute",
              data: { name: id.name },
            });
          }
        }
      },
    };
  },
};
