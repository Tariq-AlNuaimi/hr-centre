// Local ESLint plugin enforcing CLAUDE.md hard rules.
//
// Lives in the repo (not on npm) -- imported directly by eslint.config.mjs.
// Forks inherit unchanged.
//
// Rules:
//   no-prisma-in-client       Files with "use client" must not import @/lib/prisma.
//   no-any-cast-on-session    `something as any` where `something` references session.
//   no-secret-env-in-console  console.* called with process.env.<password|token|...>.
//   no-bare-internal-route    Handlers under app/api/internal/ must wrap with withInternalAuth.
//   no-raw-hex-color          Raw hex color literals in components (design-token enforcement).
//   no-unaudited-bulk-write   Prisma bulk/upsert ops on audited models bypass the audit log (ADR-010).
//
// See CLAUDE.md ‘Hard rules’ for the underlying invariants each rule protects.

import noPrismaInClient from "./rules/no-prisma-in-client.mjs";
import noAnyCastOnSession from "./rules/no-any-cast-on-session.mjs";
import noSecretEnvInConsole from "./rules/no-secret-env-in-console.mjs";
import noBareInternalRoute from "./rules/no-bare-internal-route.mjs";
import noRawHexColor from "./rules/no-raw-hex-color.mjs";
import noUnauditedBulkWrite from "./rules/no-unaudited-bulk-write.mjs";

const plugin = {
  meta: { name: "rihal-template", version: "1.0.0" },
  rules: {
    "no-prisma-in-client": noPrismaInClient,
    "no-any-cast-on-session": noAnyCastOnSession,
    "no-secret-env-in-console": noSecretEnvInConsole,
    "no-bare-internal-route": noBareInternalRoute,
    "no-raw-hex-color": noRawHexColor,
    "no-unaudited-bulk-write": noUnauditedBulkWrite,
  },
};

export default plugin;
