// Rule: no-secret-env-in-console
//
// Prevents logging a Restricted-class env var. It fires when a Restricted env
// read reaches a LOGGING sink -- `console.*`, OR any callee whose method name is
// a common log level (`log/info/warn/error/debug/trace/fatal/verbose/silly`),
// so `logger.info(...)`, `pino.error(...)`, `log.debug(...)`, `toast.error(...)`
// are all covered -- not just `console.*` (V2 challenge-audit H1).
//
// The Restricted env read is matched in BOTH accessor forms the codebase uses:
//   - the raw `process.env.<X>` member expression, AND
//   - the typed `env.<X>` wrapper imported from `@/lib/env` (the app's idiom;
//     `console.log(env.AUTH_SECRET)` was previously invisible to this rule).
//
// Patterns matched as "dangerous" (case-insensitive):
//   *PASSWORD/PASSWD/PWD*, *SECRET*, *TOKEN*, *KEY*, *HASH*, *IDENTITY*,
//   *WEBHOOK*, *RECIPIENT*, *CREDENTIAL*, *DSN*, *CONNECTION[_]STRING*, and
//   credential-bearing connection URLs -- DATABASE_URL / DIRECT_URL /
//   SHADOW_DATABASE_URL / REDIS_URL / VALKEY_URL / SMTP_URL / MONGO*_URL /
//   POSTGRES*_URL / PG*_URL / AMQP_URL / KAFKA_URL (a Postgres/Redis/etc. URL
//   embeds `user:password@`). PUBLIC base URLs (AUTH_URL / NEXTAUTH_URL /
//   VERCEL_URL / *_ISSUER) are deliberately NOT matched -- they carry no secret.
//
// SECURITY.md §1 lists the secrets this protects.

const DANGEROUS =
  /(password|passwd|pwd|secret|token|key|hash|identity|webhook|recipient|credential|dsn|connection_?string|(?:database|direct|shadow|redis|valkey|smtp|mongo|postgres|pg|amqp|kafka)_?url)/i;

// Method names that mean "this call writes to a log/UI sink". Bias toward
// catching: a false positive is a suppressible lint line; a false negative is a
// secret in production logs.
const LOG_METHODS = new Set([
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
  "fatal",
  "verbose",
  "silly",
]);

// Returns the env-var name for a `process.env.X` OR an `env.X` member access,
// else null.
function envPropertyName(node) {
  if (!node || node.type !== "MemberExpression") return null;
  const { object, property } = node;

  const propName =
    property.type === "Identifier"
      ? property.name
      : property.type === "Literal" && typeof property.value === "string"
        ? property.value
        : null;
  if (propName == null) return null;

  // Form A: process.env.X  (object is the `process.env` member expression)
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
    return propName;
  }

  // Form B: env.X  (the typed `@/lib/env` wrapper; object is the `env` identifier)
  if (object && object.type === "Identifier" && object.name === "env") {
    return propName;
  }

  return null;
}

function calleeIsLogSink(callee) {
  if (!callee || callee.type !== "MemberExpression") return false;
  // `console.<anything>(...)` -- the whole console object is a log sink.
  if (callee.object && callee.object.type === "Identifier" && callee.object.name === "console") {
    return true;
  }
  // `<obj>.<logLevel>(...)` -- any object, method named like a log level.
  const prop = callee.property;
  const name =
    prop && prop.type === "Identifier"
      ? prop.name
      : prop && prop.type === "Literal" && typeof prop.value === "string"
        ? prop.value
        : null;
  return name != null && LOG_METHODS.has(name);
}

function insideLoggingCall(node) {
  let p = node.parent;
  while (p) {
    if (p.type === "CallExpression" && calleeIsLogSink(p.callee)) return true;
    p = p.parent;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Prevent passing Restricted-class env vars (process.env.X or the @/lib/env wrapper) to any logging sink -- console.* or a logger method (log/info/warn/error/debug/...).",
    },
    messages: {
      noSecretEnvInConsole:
        "Do not log `{{ name }}` -- it matches a Restricted-class pattern and this call reaches a log/console sink. See SECURITY.md §1 + the 'never log' rule in CLAUDE.md. Log a redacted metadata field instead.",
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        const name = envPropertyName(node);
        if (!name || !DANGEROUS.test(name)) return;
        if (!insideLoggingCall(node)) return;
        context.report({
          node,
          messageId: "noSecretEnvInConsole",
          data: { name },
        });
      },
    };
  },
};
