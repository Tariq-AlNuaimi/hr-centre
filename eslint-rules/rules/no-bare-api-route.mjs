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
const API_ROUTE_PATTERN = /[\\/]app[\\/]api[\\/].*route\.tsx?$/;

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

function wrapsWithAuth(node) {
  if (!node) return false;
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  if (callee.type === "Identifier" && AUTH_WRAPPERS.has(callee.name)) return true;
  // `withX(...).something(...)` -- walk the outer call's callee.
  if (callee.type === "MemberExpression" && callee.object) {
    return wrapsWithAuth(callee.object);
  }
  // Composed wrappers, e.g. `withRateLimit(withAdminAuth(handler), opts)`:
  // recurse into the arguments to find the inner auth wrapper. This is the
  // REQUIRED composition order (withRateLimit outside), enforced separately by
  // no-rate-limit-inside-auth.
  if (Array.isArray(node.arguments) && node.arguments.some(wrapsWithAuth)) {
    return true;
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

    return {
      ExportNamedDeclaration(node) {
        if (!node.declaration) return;
        // `export const GET = withAuth(...)`
        if (node.declaration.type === "VariableDeclaration") {
          for (const decl of node.declaration.declarations) {
            if (!decl.id || decl.id.type !== "Identifier") continue;
            if (!HANDLER_NAMES.has(decl.id.name)) continue;
            if (wrapsWithAuth(decl.init)) continue;
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
