// Rule: no-rate-limit-inside-auth
//
// `withRateLimit` must compose OUTSIDE the auth wrapper, never inside it.
// CLAUDE.md 'Hard rules' / lib/api-helpers.ts: "Compose `withRateLimit` OUTSIDE
// the auth wrapper." The correct shape puts the throttle outermost so an abusive
// client is rejected with 429 BEFORE any auth work runs:
//
//   export const POST = withRateLimit(withAdminAuth(handler), { id, limit, windowMs });
//
// The inverted shape -- `withAdminAuth(withRateLimit(handler))` -- runs the full
// auth path (session lookup / bcrypt verify / shared-secret compare, all of which
// can touch the DB) on EVERY request and only throttles what survives auth. For
// the unauthenticated surfaces this matters most on -- `withInternalAuth` (no
// session; secret-guessing must be throttled) and the password route's bcrypt
// compare -- that inversion defeats the point of the limiter: a flood of bad
// credentials is exactly what should be rate-limited, and it never reaches the
// bucket. So the ordering is a security invariant, not a style preference.
//
// Detection: flag a `withRateLimit(...)` call that sits in the handler-argument
// position of an auth wrapper. The handler is arg 0 for the session wrappers
// (withAuth / withAdminAuth / withEditorAuth) and arg 1 for the token wrappers
// (withInternalAuth / withApiAuth, whose first arg is the env-var name). Matching
// on the callee identifier is enough -- these wrapper names are template-specific,
// and `withRateLimit` is only ever the api-helpers export.
//
// Known limitation (shared with no-raw-sql-unsafe / no-unaudited-bulk-write):
// only the DIRECT lexical nesting with IDENTIFIER callees is caught. Indirection
// through a variable (`const limited = withRateLimit(h); export const POST =
// withAuth(limited);`), through another wrapper in between, or a namespace-
// qualified inner call (`withAuth(helpers.withRateLimit(h))`) is not tracked --
// the gate is for the direct form a fork actually writes (`withRateLimit` is only
// ever the bare api-helpers export). A genuinely intentional inner composition can
// be suppressed on the line with a justification (the CLAUDE.md single-line-disable
// convention).

// Auth wrapper name -> zero-based index of its handler argument.
const AUTH_WRAPPERS = new Map([
  ["withAuth", 0],
  ["withAdminAuth", 0],
  ["withEditorAuth", 0],
  ["withInternalAuth", 1],
  ["withApiAuth", 1],
]);

function calleeName(node) {
  if (!node || node.type !== "CallExpression") return null;
  return node.callee.type === "Identifier" ? node.callee.name : null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "`withRateLimit` must compose OUTSIDE the auth wrapper (CLAUDE.md Hard rules) -- throttling must run before auth work, otherwise unauthenticated floods bypass the limiter.",
    },
    messages: {
      rateLimitInsideAuth:
        "`withRateLimit` is composed INSIDE `{{ wrapper }}`, so auth work runs before throttling and abusive/unauthenticated traffic never reaches the limiter. Move it outside: `withRateLimit({{ wrapper }}(handler), opts)`. See CLAUDE.md Hard rules / lib/api-helpers.ts.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const wrapper = calleeName(node);
        if (wrapper === null) return;
        const handlerIndex = AUTH_WRAPPERS.get(wrapper);
        if (handlerIndex === undefined) return;

        const handlerArg = node.arguments[handlerIndex];
        if (calleeName(handlerArg) === "withRateLimit") {
          context.report({
            node: handlerArg,
            messageId: "rateLimitInsideAuth",
            data: { wrapper },
          });
        }
      },
    };
  },
};
