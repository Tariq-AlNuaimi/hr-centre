// Rule: no-secret-env-in-console
//
// Prevents `console.*(process.env.<DANGEROUS>)` calls. The matcher walks
// upward from any `process.env.X` MemberExpression and reports if it ends
// up inside a `console.X(...)` call.
//
// Patterns matched as "dangerous":
//   *PASSWORD*, *SECRET*, *TOKEN*, *KEY*, *HASH*, *IDENTITY*, *WEBHOOK*
// (case-insensitive)
//
// SECURITY.md §1 lists the secrets this protects.

const DANGEROUS = /(password|secret|token|key|hash|identity|webhook|recipient)/i;

function envPropertyName(node) {
  if (!node || node.type !== "MemberExpression") return null;
  const { object, property } = node;
  if (
    object &&
    object.type === "MemberExpression" &&
    object.object &&
    object.object.type === "Identifier" &&
    object.object.name === "process" &&
    object.property &&
    object.property.type === "Identifier" &&
    object.property.name === "env"
  ) {
    if (property.type === "Identifier") return property.name;
    if (property.type === "Literal" && typeof property.value === "string") return property.value;
  }
  return null;
}

function insideConsoleCall(node) {
  let p = node.parent;
  while (p) {
    if (
      p.type === "CallExpression" &&
      p.callee &&
      p.callee.type === "MemberExpression" &&
      p.callee.object &&
      p.callee.object.type === "Identifier" &&
      p.callee.object.name === "console"
    ) {
      return true;
    }
    p = p.parent;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prevent passing Restricted-class env vars to console.* (PASSWORD/SECRET/TOKEN/KEY/HASH/IDENTITY/WEBHOOK/RECIPIENT).",
    },
    messages: {
      noSecretEnvInConsole:
        "Do not pass `process.env.{{ name }}` to console.* -- it matches a Restricted-class pattern. See SECURITY.md §1 + the 'never log' rule in CLAUDE.md.",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        const name = envPropertyName(node);
        if (!name || !DANGEROUS.test(name)) return;
        if (!insideConsoleCall(node)) return;
        context.report({
          node,
          messageId: "noSecretEnvInConsole",
          data: { name },
        });
      },
    };
  },
};
