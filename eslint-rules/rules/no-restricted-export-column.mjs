// Rule: no-restricted-export-column
//
// Excel exports are a SEPARATE data-egress gate from the audit log. The audit
// extension's SCRUB_FIELDS redacts secrets in `audit_logs`, but it does NOT
// touch export output (lib/export.ts header: "Restricted columns (passwordHash,
// salary, tokens) must NOT appear in the column list -- SCRUB_FIELDS does not
// protect export output"). A `toExcel(data, [{ key: "passwordHash" }, ...])`
// call writes that column's raw value straight into a downloadable .xlsx --
// a Restricted-data leak (SECURITY.md §1) that no other gate catches.
//
// This rule inspects the `columns` argument of a `toExcel(...)` call: for each
// inline `{ key: "<name>" }` column descriptor, it flags a `key` whose name is a
// known secret field (the SCRUB_FIELDS set, kept in sync by
// tests/contracts/export-column-completeness.test.ts) OR matches the
// secret-name pattern (`*password*`, `*token*`, `*secret*`, `*apiKey*`, ...) --
// the same forward-safe heuristic the scrub-completeness contract test uses, so
// a fork that adds `stripeSecret` and naively exports it is caught too.
//
// A false positive is cheap: a column that merely NAMES a secret but carries no
// secret value (rare) can drop the raw key and project a safe value through a
// `format` function, or suppress on the line with a justification (CLAUDE.md
// single-line-disable). A false negative leaks Restricted data to anyone who can
// hit the export route.
//
// Scope / known limitations: only an INLINE array literal of object literals is
// inspected. A `columns` array built in a variable, a spread element, a computed
// key, or a secret pulled through a `format` callback from a nested relation is
// not tracked -- the gate is for the direct descriptor form a fork writes. The
// rule also does not know which BUSINESS columns are Confidential (e.g. `salary`,
// `dob`): naming those is the operator's export-allowlist judgement per route
// (SECURITY.md export column lists), which a name-based lint rule cannot infer.

// Secret field names that must never be an export column key. Mirrors
// SCRUB_FIELDS in lib/prisma/audit-extension.ts; the completeness contract test
// asserts SCRUB_FIELDS stays a subset of this set so the two can't drift.
export const RESTRICTED_EXPORT_KEYS = new Set([
  "passwordHash",
  "password",
  "refresh_token",
  "access_token",
  "id_token",
  "session_state",
  "sessionToken",
  "token",
  // Invitation.tokenHash — HMAC-at-rest of the candidate credential (Restricted,
  // SECURITY.md §1). Banned as an export column key in lockstep with SCRUB_FIELDS.
  "tokenHash",
  "secret",
  "apiKey",
  "api_key",
  // SjtItem.scoringKey — the keyed best/worst answer (Confidential, SECURITY.md §1).
  // Must never be a downloadable export column (SCRUB_FIELDS ⊆ this set invariant).
  "scoringKey",
]);

// Forward-safe name pattern: a column key matching this is treated as Restricted
// even if it isn't in the explicit set above (e.g. `stripeSecret`, `webhookToken`,
// `privateKey`). Mirrors SECRET_NAME in tests/contracts/scrub-completeness.test.ts.
const SECRET_NAME =
  /(password|passwd|secret|token|api_?key|private_?key|credential)/i;

function isRestrictedKey(name) {
  return RESTRICTED_EXPORT_KEYS.has(name) || SECRET_NAME.test(name);
}

// Read a string-literal `key` property off an object-literal column descriptor.
function literalKeyName(objectExpr) {
  if (!objectExpr || objectExpr.type !== "ObjectExpression") return null;
  for (const prop of objectExpr.properties) {
    if (prop.type !== "Property" || prop.computed) continue;
    const name =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal"
          ? prop.key.value
          : null;
    if (name !== "key") continue;
    if (prop.value.type === "Literal" && typeof prop.value.value === "string") {
      return prop.value.value;
    }
    return null;
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban Restricted/secret field names as `toExcel` column keys -- export output is NOT covered by SCRUB_FIELDS, so the raw value leaks into the downloadable .xlsx (SECURITY.md §1).",
    },
    messages: {
      restrictedExportColumn:
        "Export column key `{{ key }}` is a Restricted/secret field -- `toExcel` writes its raw value into the downloadable .xlsx, which SCRUB_FIELDS does NOT protect (SECURITY.md §1). Drop the column or project a non-secret value through a `format` function. If this name carries no secret value, suppress on this line with a justification.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "toExcel") {
          return;
        }
        const columnsArg = node.arguments[1];
        if (!columnsArg || columnsArg.type !== "ArrayExpression") return;

        for (const element of columnsArg.elements) {
          const keyName = literalKeyName(element);
          if (keyName !== null && isRestrictedKey(keyName)) {
            context.report({
              node: element,
              messageId: "restrictedExportColumn",
              data: { key: keyName },
            });
          }
        }
      },
    };
  },
};
