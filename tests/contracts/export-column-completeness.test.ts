import { test } from "node:test";
import assert from "node:assert/strict";
import { SCRUB_FIELDS } from "../../lib/prisma/audit-extension";
import { RESTRICTED_EXPORT_KEYS } from "../../eslint-rules/rules/no-restricted-export-column.mjs";

// Drift guard for the export-egress gate (CLAUDE.md Hard rules / SECURITY.md §1):
//   "Excel exports are a separate gate -- audit column lists per route."
//
// The `no-restricted-export-column` ESLint rule keeps its own explicit denylist
// (RESTRICTED_EXPORT_KEYS) of secret field names that must never be a toExcel
// column key. That denylist mirrors SCRUB_FIELDS in lib/prisma/audit-extension.ts
// (the audit-scrub list) -- anything redacted from the audit trail is, by the
// same logic, a secret that must not be dumped raw into an .xlsx export.
//
// This test fails if SCRUB_FIELDS gains a field the export rule does not also
// cover, so the two lists can't silently drift apart: adding a Restricted column
// + scrub entry without teaching the export gate about it would otherwise leave
// the export path able to leak it. (The export rule may legitimately cover MORE
// than SCRUB_FIELDS via its forward-safe name pattern; the subset direction is
// the invariant that matters.)

test("every SCRUB_FIELDS name is covered by the export-column denylist", () => {
  const missing = [...SCRUB_FIELDS].filter((f) => !RESTRICTED_EXPORT_KEYS.has(f));

  assert.deepEqual(
    missing,
    [],
    `SCRUB_FIELDS field(s) not covered by RESTRICTED_EXPORT_KEYS in ` +
      `eslint-rules/rules/no-restricted-export-column.mjs: ${missing.join(", ")}. ` +
      `Any field redacted from the audit trail must also be banned as an export ` +
      `column key -- add each missing name to RESTRICTED_EXPORT_KEYS. See ` +
      `SECURITY.md §1 (export egress).`,
  );
});
