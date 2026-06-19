// Rule: no-prisma-unfiltered-import
//
// `prismaUnfiltered` is the RAW Prisma client -- it bypasses BOTH the
// soft-delete filter (it can see `deletedAt != null` rows) AND, depending on
// the op, the audit guarantees that `prisma` carries. CLAUDE.md: "prismaUnfiltered
// != prisma -- auth + recycling-bin only." Reaching for it in an ordinary
// feature route silently drops the two invariants the template promises every
// row-touching path upholds (soft-delete hiding + auditability).
//
// This rule allowlists the files that legitimately need the raw client and fails
// `/ship` on a `prismaUnfiltered` import anywhere else. The sanctioned categories
// (each has a real reason to see unfiltered/soft-deleted rows):
//   - lib/prisma.ts + lib/prisma/*   -- where the client + its extensions live
//   - lib/auth.ts + app/api/auth/*   -- login / password-reset must look up users
//                                       that may be soft-deleted or unverified
//   - app/api/recycling-bin/*        -- the recycle bin's whole job is deleted rows
//   - app/api/audit-log/*            -- reads audit rows (an EXCLUDE-set model)
//   - app/api/internal/*             -- scheduler / maintenance (e.g. audit-purge)
//   - app/api/health/*               -- liveness ping; uses the raw client to skip
//                                       extension overhead on a zero-row infra
//                                       query (SELECT 1), NOT for data access
//   - the dashboard home RSC         -- counts soft-deleted rows for the recycle-
//                                       bin-stats widget (read-only, recycling-bin
//                                       justification class)
// tests/** and scripts/** are exempt via eslint.config.mjs (fixtures, seeds,
// integration setup legitimately drive the raw client).
//
// Matching is by the IMPORTED specifier name (`prismaUnfiltered`), which is a
// template-unique export, so an aliased import (`import { prismaUnfiltered as db }`)
// or a renamed source path can't slip past. Adding a file to the allowlist is an
// Ask-before change (CLAUDE.md): a NEW legitimate caller should be a deliberate,
// reviewed decision, not a silent reach. If a one-off use is justified, suppress
// on the import line with a reason (the CLAUDE.md single-line-disable convention).
//
// Known limitations (consistent with the sibling rules' accepted gaps):
//   - Only a static named-specifier `import { prismaUnfiltered }` is tracked. A
//     namespace import (`import * as p from "@/lib/prisma"; p.prismaUnfiltered`),
//     a dynamic `import()`, a `require()`, or a re-export are not detected. These
//     forms don't appear in this ESM codebase and would stand out in review; a
//     justified suppress is the right tool if one ever appears.
//   - File fragments are anchored with `endsWith` (so `/lib/auth.ts` matches ONLY
//     a file ending exactly in `/lib/auth.ts`, never `/lib/auth.tsx` or
//     `/lib/prisma.ts.bak`); directory fragments (trailing `/`) match as a
//     contained path segment. A deliberately odd path could still nest a real
//     allowed directory, but that requires a sanctioned segment to be present.

// Path fragments (normalized to forward slashes) whose files may import the raw
// client. Fragments ending in `/` are DIRECTORY prefixes (substring/contains
// match); the rest are FILE paths (exact `endsWith` suffix match) so a near-miss
// extension like `auth.tsx` cannot satisfy the `auth.ts` allowance.
const ALLOWED_PATH_FRAGMENTS = [
  "/lib/prisma.ts",
  "/lib/prisma/",
  "/lib/auth.ts",
  "/app/api/auth/",
  "/app/api/recycling-bin/",
  "/app/api/audit-log/",
  "/app/api/internal/",
  "/app/api/health/",
  // Dashboard home RSC: aggregates soft-deleted counts for the recycle-bin-stats
  // widget. Anchored on the `[locale]/(dashboard)/page.tsx` suffix so it matches
  // ONLY the dashboard home, not sibling pages (`(dashboard)/settings/page.tsx`)
  // or any nested route group.
  "/[locale]/(dashboard)/page.tsx",
];

function isAllowedFile(filename) {
  if (!filename) return false;
  const normalized = filename.replace(/\\/g, "/");
  return ALLOWED_PATH_FRAGMENTS.some((frag) =>
    frag.endsWith("/") ? normalized.includes(frag) : normalized.endsWith(frag)
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Restrict `prismaUnfiltered` (the raw, soft-delete- and audit-bypassing client) to an allowlist of files that legitimately need it (CLAUDE.md: auth + recycling-bin + maintenance). Importing it in an ordinary route drops the template's soft-delete + audit invariants.",
    },
    messages: {
      unfilteredImport:
        "`prismaUnfiltered` bypasses the soft-delete filter and audit guarantees, and this file is not on the allowlist for it (CLAUDE.md: auth + recycling-bin + maintenance only). Use `prisma` instead; if you genuinely need the raw client here, this is an Ask-before change -- extend the allowlist in eslint-rules/rules/no-prisma-unfiltered-import.mjs with a reason, or suppress on this line with a justification.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (isAllowedFile(filename)) return {};

    return {
      ImportDeclaration(node) {
        for (const spec of node.specifiers) {
          if (
            spec.type === "ImportSpecifier" &&
            spec.imported.type === "Identifier" &&
            spec.imported.name === "prismaUnfiltered"
          ) {
            context.report({ node: spec, messageId: "unfilteredImport" });
          }
        }
      },
    };
  },
};
