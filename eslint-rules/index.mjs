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
//   no-bare-api-route         EVERY app/api/ handler must wrap with an auth wrapper (allowlisted public routes exempt).
//   no-raw-hex-color          Raw hex color literals in components (design-token enforcement).
//   no-unaudited-bulk-write   Prisma bulk/upsert ops on audited models bypass the audit log (ADR-010).
//   no-raw-sql-unsafe         Prisma $queryRawUnsafe/$executeRawUnsafe -- SQL-injection vector (A03).
//   no-rate-limit-inside-auth withRateLimit composed inside an auth wrapper -- throttle must be outermost.
//   no-restricted-export-column Restricted/secret field name used as a toExcel column key -- export leak.
//   no-prisma-unfiltered-import prismaUnfiltered (raw client) imported outside its auth/recycling/maintenance allowlist.
//   no-direct-anthropic-sdk   @anthropic-ai/sdk imported outside lib/ai/** -- model access must go through @/lib/ai (ADR-042).
//   no-arbitrary-className    Arbitrary Tailwind values on spacing (p/m/gap/space) + font-size (text-[..px]) -- use the scale (V2-304).
//   no-literal-jsx-text       Literal user-facing text in JSX (text nodes + placeholder/title/alt) -- route copy through next-intl (V2-305).
//
// See CLAUDE.md ‘Hard rules’ for the underlying invariants each rule protects.

import noPrismaInClient from "./rules/no-prisma-in-client.mjs";
import noAnyCastOnSession from "./rules/no-any-cast-on-session.mjs";
import noSecretEnvInConsole from "./rules/no-secret-env-in-console.mjs";
import noBareInternalRoute from "./rules/no-bare-internal-route.mjs";
import noBareApiRoute from "./rules/no-bare-api-route.mjs";
import noRawHexColor from "./rules/no-raw-hex-color.mjs";
import noUnauditedBulkWrite from "./rules/no-unaudited-bulk-write.mjs";
import noRawSqlUnsafe from "./rules/no-raw-sql-unsafe.mjs";
import noRateLimitInsideAuth from "./rules/no-rate-limit-inside-auth.mjs";
import noRestrictedExportColumn from "./rules/no-restricted-export-column.mjs";
import noPrismaUnfilteredImport from "./rules/no-prisma-unfiltered-import.mjs";
import noDirectAnthropicSdk from "./rules/no-direct-anthropic-sdk.mjs";
import noArbitraryClassName from "./rules/no-arbitrary-className.mjs";
import noLiteralJsxText from "./rules/no-literal-jsx-text.mjs";

const plugin = {
  meta: { name: "rihal-template", version: "1.0.0" },
  rules: {
    "no-prisma-in-client": noPrismaInClient,
    "no-any-cast-on-session": noAnyCastOnSession,
    "no-secret-env-in-console": noSecretEnvInConsole,
    "no-bare-internal-route": noBareInternalRoute,
    "no-bare-api-route": noBareApiRoute,
    "no-raw-hex-color": noRawHexColor,
    "no-unaudited-bulk-write": noUnauditedBulkWrite,
    "no-raw-sql-unsafe": noRawSqlUnsafe,
    "no-rate-limit-inside-auth": noRateLimitInsideAuth,
    "no-restricted-export-column": noRestrictedExportColumn,
    "no-prisma-unfiltered-import": noPrismaUnfilteredImport,
    "no-direct-anthropic-sdk": noDirectAnthropicSdk,
    "no-arbitrary-className": noArbitraryClassName,
    "no-literal-jsx-text": noLiteralJsxText,
  },
};

export default plugin;
