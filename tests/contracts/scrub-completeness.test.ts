import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCRUB_FIELDS } from "../../lib/prisma/audit-extension";

// Robustness guard for the CLAUDE.md / SECURITY.md §5 invariant:
//   "Adding a Restricted column? Extend SCRUB_FIELDS ... in the same commit."
//
// audit-scrub.test.ts asserts the CURRENT membership of SCRUB_FIELDS, but
// nothing catches the forward case: a fork adds a secret-bearing column
// (`stripeSecret`, `apiToken`, `webhookSecret`, ...) and forgets to scrub it,
// so the raw value snapshots into `audit_logs.before/after`. This test scans
// the schema for secret-LOOKING String columns and fails if any are not
// covered by SCRUB_FIELDS -- turning the documented rule into a gate every
// fork inherits.
//
// Scope: only `String` scalar fields (a secret value is virtually always a
// String column) so relation / enum / DateTime fields can't false-positive.

const SCHEMA_PATH = fileURLToPath(
  new URL("../../prisma/schema.prisma", import.meta.url)
);

// Field-name fragments that signal a Restricted, value-bearing secret column.
// Intentionally broad: a false positive is cheap (add the field to SCRUB_FIELDS
// or rename), a false negative leaks a secret into the audit trail.
const SECRET_NAME = /(password|passwd|secret|token|apikey|api_key|privatekey|credential)/i;

// Field names that match the pattern but are NOT secret VALUES and so are
// correctly absent from SCRUB_FIELDS. Keep this list tiny and justified.
const NON_SECRET_EXCEPTIONS = new Set<string>([
  // Auth.js `Account.token_type`: the OAuth token *type* label ("bearer"), not
  // a credential value. The actual secrets on Account (access_token /
  // refresh_token / id_token / session_state) ARE in SCRUB_FIELDS.
  "token_type",
]);

/** Extract `{ model, field }` pairs for every `String` scalar field in the schema. */
function stringFields(schema: string): Array<{ model: string; field: string }> {
  const out: Array<{ model: string; field: string }> = [];
  const modelBlock = /model\s+(\w+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = modelBlock.exec(schema)) !== null) {
    const [, model, body] = m;
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      // `<field>  String` or `<field>  String?` (reject `String[]` list relations
      // and any non-String type).
      const field = line.match(/^(\w+)\s+String(\?)?(\s|$)/);
      if (field) out.push({ model, field: field[1] });
    }
  }
  return out;
}

test("every secret-looking String column in the schema is in SCRUB_FIELDS", () => {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const fields = stringFields(schema);
  assert.ok(fields.length > 0, "parsed no String fields -- schema parse likely broke");

  const unscrubbed = fields.filter(
    ({ field }) =>
      SECRET_NAME.test(field) &&
      !SCRUB_FIELDS.has(field) &&
      !NON_SECRET_EXCEPTIONS.has(field)
  );

  assert.deepEqual(
    unscrubbed,
    [],
    `Secret-looking String column(s) not covered by SCRUB_FIELDS in ` +
      `lib/prisma/audit-extension.ts: ${unscrubbed
        .map((f) => `${f.model}.${f.field}`)
        .join(", ")}. Add each to SCRUB_FIELDS (and the membership assertion in ` +
      `audit-scrub.test.ts), or, if it is genuinely not a secret value, add it ` +
      `to NON_SECRET_EXCEPTIONS here with a justification. See SECURITY.md §5.`
  );
});
