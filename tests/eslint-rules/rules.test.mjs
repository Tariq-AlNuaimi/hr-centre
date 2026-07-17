// RuleTester coverage for the eleven local CLAUDE.md-enforcement rules in
// eslint-rules/rules/*.mjs. These rules protect template invariants (see
// CLAUDE.md "Local ESLint plugin") and ship at `error`, so they need their
// own automated guard -- a regression here silently removes a security gate
// (or, for no-raw-hex-color, the design-token boundary).
//
// Wired into the test gate via `npm run test:lint-rules` (which `npm test`
// chains). Uses ESLint's RuleTester driven by node:test, matching the repo's
// node:test + tsx style. TS-syntax rules parse with @typescript-eslint/parser;
// filename-sensitive rules pass an absolute `filename` per case.

import { test } from "node:test";
import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";

import noPrismaInClient from "../../eslint-rules/rules/no-prisma-in-client.mjs";
import noAnyCastOnSession from "../../eslint-rules/rules/no-any-cast-on-session.mjs";
import noSecretEnvInConsole from "../../eslint-rules/rules/no-secret-env-in-console.mjs";
import noBareInternalRoute from "../../eslint-rules/rules/no-bare-internal-route.mjs";
import noRawHexColor from "../../eslint-rules/rules/no-raw-hex-color.mjs";
import noUnauditedBulkWrite from "../../eslint-rules/rules/no-unaudited-bulk-write.mjs";
import noRawSqlUnsafe from "../../eslint-rules/rules/no-raw-sql-unsafe.mjs";
import noRateLimitInsideAuth from "../../eslint-rules/rules/no-rate-limit-inside-auth.mjs";
import noRestrictedExportColumn from "../../eslint-rules/rules/no-restricted-export-column.mjs";
import noPrismaUnfilteredImport from "../../eslint-rules/rules/no-prisma-unfiltered-import.mjs";
import noDirectAnthropicSdk from "../../eslint-rules/rules/no-direct-anthropic-sdk.mjs";
import noArbitraryClassName from "../../eslint-rules/rules/no-arbitrary-className.mjs";
import noLiteralJsxText from "../../eslint-rules/rules/no-literal-jsx-text.mjs";

// RuleTester.run() throws on the first mismatch; node:test surfaces that as a
// failed case. Wrapping each rule in its own test() keeps failures isolated.
function ruleTest(name, rule, cases, parserOptions) {
  test(name, () => {
    const tester = new RuleTester(
      parserOptions ? { languageOptions: { parser: tsParser, parserOptions } } : undefined,
    );
    tester.run(name, rule, cases);
  });
}

// --- no-prisma-in-client ---------------------------------------------------
// A "use client" file must not reach the Prisma client by ANY route: static
// import, re-export, export-*, or dynamic import().
ruleTest("no-prisma-in-client", noPrismaInClient, {
  valid: [
    // Server file (no directive) may import Prisma freely.
    { code: `import { prisma } from "@/lib/prisma";` },
    // Client file importing a non-Prisma module is fine.
    { code: `"use client";\nimport { useState } from "react";` },
    // Client file importing something whose path merely contains "prisma" as a
    // substring but isn't the lib client.
    { code: `"use client";\nimport x from "@/lib/prismatic-helpers";` },
  ],
  invalid: [
    {
      code: `"use client";\nimport { prisma } from "@/lib/prisma";`,
      errors: [{ messageId: "noPrismaInClient" }],
    },
    {
      // Relative deep path that ends with /lib/prisma.
      code: `"use client";\nimport { prisma } from "../../lib/prisma";`,
      errors: [{ messageId: "noPrismaInClient" }],
    },
    {
      // Re-export form.
      code: `"use client";\nexport { prisma } from "@/lib/prisma";`,
      errors: [{ messageId: "noPrismaInClient" }],
    },
    {
      // export-* form.
      code: `"use client";\nexport * from "@/lib/prisma/client";`,
      errors: [{ messageId: "noPrismaInClient" }],
    },
    {
      // Dynamic import() form.
      code: `"use client";\nconst p = await import("@/lib/prisma");`,
      errors: [{ messageId: "noPrismaInClient" }],
    },
  ],
});

// --- no-any-cast-on-session ------------------------------------------------
// `x as any` where x references a session-bearing expression. Needs the TS
// parser for TSAsExpression.
ruleTest(
  "no-any-cast-on-session",
  noAnyCastOnSession,
  {
    valid: [
      // Typed access, no cast.
      { code: `const role = session.user.role;` },
      // Cast to a concrete type, not any.
      { code: `const s = session as Session;` },
      // `as any` on an unrelated expression.
      { code: `const x = somethingUnrelated as any;` },
    ],
    invalid: [
      {
        code: `const s = session as any;`,
        errors: [{ messageId: "noAnyCastOnSession" }],
      },
      {
        code: `const role = (session.user as any).role;`,
        errors: [{ messageId: "noAnyCastOnSession" }],
      },
      {
        // Member chain that mentions session via a property.
        code: `const u = ctx.session.user as any;`,
        errors: [{ messageId: "noAnyCastOnSession" }],
      },
    ],
  },
  { ecmaVersion: 2022, sourceType: "module" },
);

// --- no-secret-env-in-console ----------------------------------------------
ruleTest("no-secret-env-in-console", noSecretEnvInConsole, {
  valid: [
    // Logging a non-restricted env var.
    { code: `console.log(process.env.NODE_ENV);` },
    // Reading a restricted var WITHOUT logging it.
    { code: `const t = process.env.AUTH_SECRET;` },
    // Restricted var passed to a non-console sink.
    { code: `logger.info(process.env.API_TOKEN);` },
  ],
  invalid: [
    {
      code: `console.log(process.env.AUTH_SECRET);`,
      errors: [{ messageId: "noSecretEnvInConsole" }],
    },
    {
      code: `console.error(process.env.DATABASE_PASSWORD);`,
      errors: [{ messageId: "noSecretEnvInConsole" }],
    },
    {
      // Bracket-literal access form, nested inside an interpolated arg.
      code: "console.warn(`token=${process.env['INTERNAL_TOKEN']}`);",
      errors: [{ messageId: "noSecretEnvInConsole" }],
    },
    {
      // passwordHash pattern.
      code: `console.debug(process.env.USER_PASSWORD_HASH);`,
      errors: [{ messageId: "noSecretEnvInConsole" }],
    },
  ],
});

// --- no-bare-internal-route ------------------------------------------------
// Only fires for files under app/api/internal/**/route.ts(x). The filename is
// load-bearing, so each case sets an absolute path.
const INTERNAL = "/repo/app/api/internal/sync/route.ts";
const NON_INTERNAL = "/repo/app/api/public/route.ts";
ruleTest(
  "no-bare-internal-route",
  noBareInternalRoute,
  {
    valid: [
      // Properly wrapped const export in an internal route.
      {
        filename: INTERNAL,
        code: `export const POST = withInternalAuth("SYNC_TOKEN", handler);`,
      },
      // A bare function-declaration handler OUTSIDE the internal tree is ignored.
      {
        filename: NON_INTERNAL,
        code: `export async function GET() { return new Response("ok"); }`,
      },
      // Non-handler export in an internal route is fine.
      {
        filename: INTERNAL,
        code: `export const runtime = "nodejs";`,
      },
    ],
    invalid: [
      {
        // Bare const handler (not wrapped) in an internal route.
        filename: INTERNAL,
        code: `export const POST = async () => new Response("ok");`,
        errors: [{ messageId: "noBareInternalRoute" }],
      },
      {
        // Function-declaration handler in an internal route -- can't be wrapped,
        // always bypasses the gate.
        filename: INTERNAL,
        code: `export async function GET() { return new Response("ok"); }`,
        errors: [{ messageId: "noBareInternalRoute" }],
      },
      {
        // Wrapped with the WRONG function -- still bare from the gate's view.
        filename: INTERNAL,
        code: `export const DELETE = withAuth(handler);`,
        errors: [{ messageId: "noBareInternalRoute" }],
      },
    ],
  },
  { ecmaVersion: 2022, sourceType: "module" },
);

// --- no-raw-hex-color ------------------------------------------------------
// Color must come from the theme tokens / CSS vars, not a raw hex in a
// component. The token source file (chart-palette.ts) is exempt; comments aren't
// literals so example hexes in docs don't trip it.
const THEME_SRC = "/repo/components/shared/chart-palette.ts";
const BRAND_SRC = "/repo/brand.config.ts";
const A_COMPONENT = "/repo/components/shared/Widget.tsx";
ruleTest("no-raw-hex-color", noRawHexColor, {
  valid: [
    // Color from a token / CSS var, not a literal.
    { filename: A_COMPONENT, code: `const c = token.colorBorderSecondary;` },
    { filename: A_COMPONENT, code: `const s = { marginBottom: "var(--space-4)" };` },
    // A "#"-string that is NOT a hex color (anchor / id / route fragment).
    { filename: A_COMPONENT, code: `const href = "#main";` },
    { filename: A_COMPONENT, code: `const a = "#section-2";` },
    // The token source file owns the brand colors + chart palette.
    {
      filename: THEME_SRC,
      code: `export const chartPalette = ["#1677ff", "#52c41a"];`,
    },
    // brand.config.ts is the white-label brand-color contract — also exempt.
    {
      filename: BRAND_SRC,
      code: `export const brand = { colors: { primary: "#4f46e5" } };`,
    },
  ],
  invalid: [
    {
      // Whole-string hex in an inline style.
      filename: A_COMPONENT,
      code: `const s = { color: "#3a3a3a" };`,
      errors: [{ messageId: "noRawHexColor" }],
    },
    {
      // Short (3-digit) hex.
      filename: A_COMPONENT,
      code: `const s = { background: "#fff" };`,
      errors: [{ messageId: "noRawHexColor" }],
    },
    {
      // Hex embedded in a larger CSS-ish string.
      filename: A_COMPONENT,
      code: `const s = { border: "1px solid #1677ff" };`,
      errors: [{ messageId: "noRawHexColor" }],
    },
    {
      // A one-off palette array in a component (belongs in the token layer).
      filename: A_COMPONENT,
      code: `const palette = ["#1677ff", "#52c41a"];`,
      errors: [{ messageId: "noRawHexColor" }, { messageId: "noRawHexColor" }],
    },
  ],
});

// --- no-unaudited-bulk-write ----------------------------------------------
// Prisma bulk-write / upsert ops on an AUDITED model bypass the per-row audit
// extension (ADR-010). The rule flags them on `prisma` / `prismaUnfiltered`
// and exempts the audit EXCLUDE-set models. Parse with the TS parser so the
// `(prisma as any)` unwrap path is exercised.
ruleTest(
  "no-unaudited-bulk-write",
  noUnauditedBulkWrite,
  {
    valid: [
      // Per-row writes are audited -- always fine.
      { code: `await prisma.user.create({ data });` },
      { code: `await prisma.user.update({ where, data });` },
      { code: `await prisma.user.delete({ where });` },
      // Bulk ops on EXCLUDE-set models are not audited by design -> allowed.
      { code: `await prismaUnfiltered.verificationToken.deleteMany({ where });` },
      { code: `await prismaUnfiltered.auditLog.deleteMany({ where });` },
      { code: `await prisma.session.deleteMany({ where });` },
      { code: `await prisma.account.updateMany({ where, data });` },
      // Bulk method name on a non-prisma object is irrelevant.
      { code: `await queue.createMany(items);` },
      { code: `await delegate.updateMany({ where, data });` },
      // An alias bound to a NON-prisma client must not be flagged.
      { code: `const db = makeClient();\nawait db.user.updateMany({ where, data });` },
      // `$transaction` array form on an EXCLUDE model stays allowed.
      { code: `await prisma.$transaction([prisma.session.deleteMany({ where })]);` },
    ],
    invalid: [
      {
        code: `await prisma.user.updateMany({ where, data });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        code: `await prisma.post.createMany({ data });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        code: `await prisma.invoice.deleteMany({ where });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        code: `await prisma.user.upsert({ where, create, update });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        // prismaUnfiltered on an audited model is just as blind.
        code: `await prismaUnfiltered.user.updateMany({ where, data });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        // `createManyAndReturn` is the same blind spot.
        code: `await prisma.user.createManyAndReturn({ data });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        // TS type-assertion wrapper must not hide the prisma root.
        code: `await (prisma as any).user.deleteMany({ where });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        // Computed accessor form.
        code: `await prisma["user"].updateMany({ where, data });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        // Local re-bind alias: `const db = prisma` then bulk-write.
        code: `const db = prisma;\nawait db.user.updateMany({ where, data });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        // The textbook atomicity idiom: $transaction callback param `tx` is the
        // extended client, so a bulk write through it is the same audit bypass.
        code: `await prisma.$transaction(async (tx) => { await tx.user.updateMany({ where, data }); });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        // $transaction array form: inner call is rooted at `prisma` directly.
        code: `await prisma.$transaction([prisma.user.updateMany({ where, data })]);`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        // SR-M3: assignment-form rebinding (not `const x = ...`) is tracked, so
        // a bare `db = prisma` reassignment can't slip a bulk write past.
        code: `let db;\ndb = prisma;\nawait db.user.updateMany({ where, data });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
      {
        // SR-M3: re-aliasing the `$transaction` param inside the callback is
        // tracked too (`db = tx` -> `db.user.updateMany` is the same bypass).
        code: `await prisma.$transaction(async (tx) => { let db; db = tx; await db.user.updateMany({ where, data }); });`,
        errors: [{ messageId: "noBulkWrite" }],
      },
    ],
  },
  { ecmaVersion: 2022, sourceType: "module" },
);

// --- no-raw-sql-unsafe -----------------------------------------------------
// The parameterized tagged-template forms ($queryRaw/$executeRaw) are allowed;
// only the unparameterized *Unsafe escape hatches are banned (OWASP A03).
ruleTest(
  "no-raw-sql-unsafe",
  noRawSqlUnsafe,
  {
    valid: [
      // Safe parameterized tagged templates -- the sanctioned raw form.
      { code: "await prisma.$queryRaw`SELECT 1`;" },
      { code: "await prismaUnfiltered.$queryRaw`SELECT 1`;" },
      { code: "await prisma.$executeRaw`DELETE FROM t WHERE id = ${id}`;" },
      // Unrelated method that merely contains "Raw" in the name.
      { code: "await client.queryRawData(x);" },
    ],
    invalid: [
      {
        code: "await prisma.$queryRawUnsafe(`SELECT * FROM t WHERE id = ${id}`);",
        errors: [{ messageId: "noRawSqlUnsafe" }],
      },
      {
        code: "await prisma.$executeRawUnsafe('DELETE FROM t WHERE id = ' + id);",
        errors: [{ messageId: "noRawSqlUnsafe" }],
      },
      {
        // Flagged regardless of receiver (method name is Prisma-unique), so an
        // aliased client can't escape the gate.
        code: "await db.$queryRawUnsafe(sql);",
        errors: [{ messageId: "noRawSqlUnsafe" }],
      },
      {
        // Aliased receiver, $executeRaw variant.
        code: "await db.$executeRawUnsafe(sql);",
        errors: [{ messageId: "noRawSqlUnsafe" }],
      },
      {
        // Tagged-template form of an Unsafe method is no safer -- caught too.
        code: "await prisma.$executeRawUnsafe`DROP TABLE ${t}`;",
        errors: [{ messageId: "noRawSqlUnsafe" }],
      },
    ],
  },
  { ecmaVersion: 2022, sourceType: "module" },
);

// --- no-rate-limit-inside-auth ---------------------------------------------
// withRateLimit must be the OUTER wrapper so throttling runs before auth work.
// The violation is a withRateLimit(...) call sitting in the handler-argument
// slot of an auth wrapper (arg 0 for the session wrappers, arg 1 for the
// token wrappers whose first arg is the env-var name).
ruleTest(
  "no-rate-limit-inside-auth",
  noRateLimitInsideAuth,
  {
    valid: [
      // Correct: throttle is outermost, auth wrapper is its first argument.
      { code: `export const POST = withRateLimit(withAdminAuth(handler), opts);` },
      {
        code: `export const PUT = withRateLimit(withAuth(handler), { id: "x", limit: 5, windowMs: 60000 });`,
      },
      // Token wrapper nested inside the throttle is the sanctioned shape too.
      {
        code: `export const GET = withRateLimit(withInternalAuth("CRON_SECRET", purge, { bearer: true }), opts);`,
      },
      // Auth wrapper alone (no rate limiting) is fine.
      { code: `export const GET = withAdminAuth(handler);` },
      // An arrow/identifier handler -- not a withRateLimit call -- is fine.
      { code: `export const POST = withAuth(async (req, ctx) => handler(req, ctx));` },
      // withRateLimit wrapping a non-auth call must not trip.
      { code: `export const POST = withRateLimit(somethingElse(handler), opts);` },
    ],
    invalid: [
      {
        // Inverted: session wrapper outside the throttle (arg 0).
        code: `export const POST = withAuth(withRateLimit(handler, opts));`,
        errors: [{ messageId: "rateLimitInsideAuth" }],
      },
      {
        code: `export const DELETE = withAdminAuth(withRateLimit(handler, opts));`,
        errors: [{ messageId: "rateLimitInsideAuth" }],
      },
      {
        code: `export const PUT = withEditorAuth(withRateLimit(handler, opts));`,
        errors: [{ messageId: "rateLimitInsideAuth" }],
      },
      {
        // Token wrapper: handler is arg 1, so the throttle is in the wrong slot.
        code: `export const GET = withInternalAuth("CRON_SECRET", withRateLimit(purge, opts));`,
        errors: [{ messageId: "rateLimitInsideAuth" }],
      },
      {
        code: `export const POST = withApiAuth("API_TOKEN", withRateLimit(handler, opts));`,
        errors: [{ messageId: "rateLimitInsideAuth" }],
      },
      {
        // Correct and inverted forms in one file: detections are independent,
        // so only the inverted GET is flagged (the POST stays clean).
        code: `export const POST = withRateLimit(withAuth(handler), opts);\nexport const GET = withAdminAuth(withRateLimit(handler, opts));`,
        errors: [{ messageId: "rateLimitInsideAuth" }],
      },
    ],
  },
  { ecmaVersion: 2022, sourceType: "module" },
);

// --- no-restricted-export-column -------------------------------------------
// A toExcel(...) column whose `key` names a Restricted/secret field leaks the
// raw value into the .xlsx -- SCRUB_FIELDS does not cover export output. Both
// the explicit SCRUB_FIELDS names and the forward-safe secret-name pattern are
// flagged; safe business columns pass through.
ruleTest(
  "no-restricted-export-column",
  noRestrictedExportColumn,
  {
    valid: [
      // Ordinary, non-secret columns.
      {
        code: `toExcel(rows, [{ header: "Name", key: "name" }, { header: "Created", key: "createdAt" }]);`,
      },
      // A secret value projected through `format` (not exported as a raw key).
      {
        code: `toExcel(rows, [{ header: "Has key", key: "id", format: (v, row) => (row.apiKey ? "yes" : "no") }]);`,
      },
      // Not a toExcel call -- unrelated function with a "key" prop.
      { code: `defineColumns([{ header: "Token", key: "token" }]);` },
      // Columns built in a variable are out of the inline-literal scope.
      { code: `toExcel(rows, cols);` },
      // A computed key can't be read statically -> not flagged (documented scope).
      { code: `toExcel(rows, [{ header: "Dyn", key: SECRET_FIELD }]);` },
    ],
    invalid: [
      {
        // Exact SCRUB_FIELDS name.
        code: `toExcel(rows, [{ header: "Hash", key: "passwordHash" }]);`,
        errors: [{ messageId: "restrictedExportColumn" }],
      },
      {
        // Plain `token`.
        code: `toExcel(rows, [{ header: "Name", key: "name" }, { header: "Tok", key: "token" }]);`,
        errors: [{ messageId: "restrictedExportColumn" }],
      },
      {
        // Forward-safe pattern: a secret-named column NOT in the explicit set.
        code: `toExcel(rows, [{ header: "Stripe", key: "stripeSecret" }]);`,
        errors: [{ messageId: "restrictedExportColumn" }],
      },
      {
        // Snake_case OAuth token column.
        code: `toExcel(rows, [{ header: "Refresh", key: "refresh_token" }]);`,
        errors: [{ messageId: "restrictedExportColumn" }],
      },
      {
        // Two restricted columns in one call -> one report each.
        code: `toExcel(rows, [{ key: "apiKey" }, { key: "name" }, { key: "privateKey" }]);`,
        errors: [{ messageId: "restrictedExportColumn" }, { messageId: "restrictedExportColumn" }],
      },
    ],
  },
  { ecmaVersion: 2022, sourceType: "module" },
);

// --- no-prisma-unfiltered-import -------------------------------------------
// prismaUnfiltered (raw client, bypasses soft-delete + audit) may only be
// imported in allowlisted files (auth / recycling-bin / audit-log / internal /
// health / the prisma lib). The filename is load-bearing, so each case sets an
// absolute path.
const ORDINARY_ROUTE = "/repo/app/api/projects/route.ts";
const ALLOWED_AUTH = "/repo/app/api/auth/reset-password/route.ts";
const ALLOWED_RECYCLE = "/repo/app/api/recycling-bin/route.ts";
const ALLOWED_LIB = "/repo/lib/auth.ts";
ruleTest(
  "no-prisma-unfiltered-import",
  noPrismaUnfilteredImport,
  {
    valid: [
      // Allowlisted files may import the raw client.
      {
        filename: ALLOWED_AUTH,
        code: `import { prismaUnfiltered } from "@/lib/prisma";`,
      },
      {
        filename: ALLOWED_RECYCLE,
        code: `import { prismaUnfiltered } from "@/lib/prisma";`,
      },
      {
        filename: ALLOWED_LIB,
        code: `import { prismaUnfiltered } from "./prisma";`,
      },
      // The dashboard home RSC aggregates soft-deleted counts (allowlisted).
      {
        filename: "/repo/app/[locale]/(dashboard)/page.tsx",
        code: `import { prisma, prismaUnfiltered } from "@/lib/prisma";`,
      },
      // An ordinary route importing the AUDITED client is fine.
      {
        filename: ORDINARY_ROUTE,
        code: `import { prisma } from "@/lib/prisma";`,
      },
      // Importing something else whose name merely contains the substring.
      {
        filename: ORDINARY_ROUTE,
        code: `import { prismaUnfilteredHelper } from "@/lib/helpers";`,
      },
    ],
    invalid: [
      {
        // Ordinary feature route reaching for the raw client.
        filename: ORDINARY_ROUTE,
        code: `import { prismaUnfiltered } from "@/lib/prisma";`,
        errors: [{ messageId: "unfilteredImport" }],
      },
      {
        // Aliased import does not escape the gate (matched on imported name).
        filename: ORDINARY_ROUTE,
        code: `import { prismaUnfiltered as db } from "@/lib/prisma";`,
        errors: [{ messageId: "unfilteredImport" }],
      },
      {
        // Mixed import: the audited client is fine, the raw one is flagged.
        filename: ORDINARY_ROUTE,
        code: `import { prisma, prismaUnfiltered } from "@/lib/prisma";`,
        errors: [{ messageId: "unfilteredImport" }],
      },
      {
        // Boundary: a SIBLING dashboard page is NOT the allowlisted home page,
        // so the dashboard fragment must not exempt it.
        filename: "/repo/app/[locale]/(dashboard)/settings/page.tsx",
        code: `import { prismaUnfiltered } from "@/lib/prisma";`,
        errors: [{ messageId: "unfilteredImport" }],
      },
      {
        // Boundary: a nested dashboard page is likewise not exempt.
        filename: "/repo/app/[locale]/(dashboard)/users/[id]/page.tsx",
        code: `import { prismaUnfiltered } from "@/lib/prisma";`,
        errors: [{ messageId: "unfilteredImport" }],
      },
      {
        // SR-M4: `lib/auth.tsx` must NOT inherit `lib/auth.ts`'s allowance.
        // File fragments are endsWith-anchored, so a near-miss extension
        // (`auth.tsx`, `prisma.ts.bak`) cannot satisfy a `.ts` allowance.
        filename: "/repo/lib/auth.tsx",
        code: `import { prismaUnfiltered } from "./prisma";`,
        errors: [{ messageId: "unfilteredImport" }],
      },
    ],
  },
  { ecmaVersion: 2022, sourceType: "module" },
);

// --- no-direct-anthropic-sdk -----------------------------------------------
// The @anthropic-ai/sdk package may only be imported inside lib/ai/** (the seam
// that owns the client + Tool-Runner wrapper); everywhere else, model access
// goes through the @/lib/ai barrel (ADR-042 AI-Quality pillar). The filename is
// load-bearing, so each case sets an absolute path.
const AI_PROVIDER = "/repo/lib/ai/provider.ts";
const AI_TOOL_RUNNER = "/repo/lib/ai/tool-runner.ts";
const AI_ROUTE = "/repo/app/api/ai/summarize/route.ts";
const NON_AI_LIB = "/repo/lib/report.ts";
ruleTest(
  "no-direct-anthropic-sdk",
  noDirectAnthropicSdk,
  {
    valid: [
      // lib/ai/** legitimately owns the SDK seam (provider constructs the client).
      {
        filename: AI_PROVIDER,
        code: `import Anthropic from "@anthropic-ai/sdk";`,
      },
      // tool-runner.ts types off the beta Tool-Runner API (type import, allowed here).
      {
        filename: AI_TOOL_RUNNER,
        code: `import type Anthropic from "@anthropic-ai/sdk";`,
      },
      // Feature code reaching the model through the barrel is the sanctioned path.
      {
        filename: AI_ROUTE,
        code: `import { runAgent } from "@/lib/ai";`,
      },
      // A package whose name merely CONTAINS the SDK name as a prefix substring
      // (not the package or a sub-path) must not trip.
      {
        filename: AI_ROUTE,
        code: `import x from "@anthropic-ai/sdk-helpers";`,
      },
    ],
    invalid: [
      {
        // An app route importing the SDK directly bypasses the @/lib/ai seam.
        filename: AI_ROUTE,
        code: `import Anthropic from "@anthropic-ai/sdk";`,
        errors: [{ messageId: "directSdkImport" }],
      },
      {
        // An ordinary lib file (outside lib/ai) is not allowlisted either.
        filename: NON_AI_LIB,
        code: `import Anthropic from "@anthropic-ai/sdk";`,
        errors: [{ messageId: "directSdkImport" }],
      },
      {
        // Deep sub-path import is caught too.
        filename: AI_ROUTE,
        code: `import { Message } from "@anthropic-ai/sdk/resources";`,
        errors: [{ messageId: "directSdkImport" }],
      },
      {
        // Dynamic import() form does not escape the gate.
        filename: AI_ROUTE,
        code: `const sdk = await import("@anthropic-ai/sdk");`,
        errors: [{ messageId: "directSdkImport" }],
      },
      {
        // Re-export form is caught (ExportNamedDeclaration with a source).
        filename: NON_AI_LIB,
        code: `export { default as Anthropic } from "@anthropic-ai/sdk";`,
        errors: [{ messageId: "directSdkImport" }],
      },
    ],
  },
  { ecmaVersion: 2022, sourceType: "module" },
);

// --- no-arbitrary-className (V2-304) ---------------------------------------
// Layout design-token enforcement: an arbitrary Tailwind value on a SPACING
// (p/m/gap/space) or FONT-SIZE (text-[…px|rem|em]) utility drifts off the 4px
// scale / type scale. Legit arbitrary values elsewhere (grid, calc, min-h,
// positioning, data-attr variants, arbitrary colors) stay allowed.
ruleTest("no-arbitrary-className", noArbitraryClassName, {
  valid: [
    // On-scale spacing + type utilities.
    { code: `const c = "p-4 mt-2 gap-3 text-sm";` },
    { code: `const c = "px-density-page text-h4 font-semibold";` },
    // Arbitrary values the rule deliberately does NOT govern.
    { code: `const c = "grid-cols-[1fr_auto]";` },
    { code: `const c = "w-[calc(100%-2rem)]";` },
    { code: `const c = "min-h-[44px]";` }, // touch target — a size, not spacing
    { code: `const c = "top-[3px] end-1";` }, // positioning, not spacing
    { code: `const c = "data-[state=open]:bg-muted";` }, // arbitrary variant
    { code: `const c = "text-[var(--brand)]";` }, // arbitrary COLOR (no px/rem/em)
    { code: `const c = "text-[#fff]";` }, // arbitrary color, not a length
    // px/rem/em as a SUBSTRING of a var/token/theme/named value is NOT a font size
    // (the V2-304 senior-review regression cases — the unit must trail a digit).
    { code: `const c = "text-[var(--element-color)]";` }, // "element" contains "em"
    { code: `const c = "text-[var(--primary-emphasis)]";` }, // this repo's own token
    { code: `const c = "text-[system-ui]";` }, // "system" contains "em"
    { code: `const c = "text-[theme(spacing.4)]";` }, // "theme" contains "em"
    { code: `const c = "text-[color:var(--x)]";` }, // explicit color hint
    // A template literal whose static chunks are all on-scale.
    { code: "const c = `flex ${x} p-2 text-base`;" },
    // A plain string that isn't a className — the rule is JSX/TSX-scoped in the
    // config, but the rule body itself only reports the pattern; a non-matching
    // string is inert.
    { code: `const note = "grid p-4";` },
  ],
  invalid: [
    // Arbitrary spacing.
    {
      code: `const c = "p-[13px]";`,
      errors: [{ messageId: "noArbitrary" }],
    },
    {
      code: `const c = "mt-[7px] flex";`,
      errors: [{ messageId: "noArbitrary" }],
    },
    {
      code: `const c = "gap-[5px]";`,
      errors: [{ messageId: "noArbitrary" }],
    },
    {
      code: `const c = "space-y-[9px]";`,
      errors: [{ messageId: "noArbitrary" }],
    },
    // Arbitrary font size (a length).
    {
      code: `const c = "text-[15px] font-bold";`,
      errors: [{ messageId: "noArbitrary" }],
    },
    {
      code: `const c = "text-[1.375rem]";`,
      errors: [{ messageId: "noArbitrary" }],
    },
    {
      // An explicit `length:` type hint is still a font size.
      code: `const c = "text-[length:14px]";`,
      errors: [{ messageId: "noArbitrary" }],
    },
    {
      // EVERY off-scale utility in the string is reported, not just the first
      // (the V2-304 senior-review whack-a-mole fix): 3 hits → 3 errors.
      code: `const c = "p-[13px] mt-[7px] text-[15px]";`,
      errors: [
        { messageId: "noArbitrary" },
        { messageId: "noArbitrary" },
        { messageId: "noArbitrary" },
      ],
    },
    // Caught inside a template literal's static chunk too.
    {
      code: "const c = `flex ${x} text-[56px]`;",
      errors: [{ messageId: "noArbitrary" }],
    },
  ],
});

// --- no-literal-jsx-text (V2-305) ------------------------------------------
// The copy chokepoint: literal user-facing text in JSX (text nodes + placeholder/
// title/alt) must go through next-intl. Exempt: pure whitespace/digits/symbols,
// code/pre/kbd elements, aria-*/data-*/structural attributes, and (at the config
// layer, not here) dev pages + context-free root boundaries + tests.
ruleTest(
  "no-literal-jsx-text",
  noLiteralJsxText,
  {
    valid: [
      // Translated text (an expression, not a literal) — exactly the goal.
      { code: `const x = <button>{t("common.save")}</button>;` },
      // Whitespace / digits / symbols alone are not copy.
      { code: `const x = <div> </div>;` },
      { code: `const x = <span>—</span>;` },
      { code: `const x = <span>42</span>;` },
      { code: `const x = <span>•</span>;` },
      // Code samples are literal by nature.
      { code: `const x = <code>const y = 1</code>;` },
      { code: `const x = <pre>npm run ship</pre>;` },
      // Translated / non-user-facing / exempt attributes.
      { code: `const x = <input placeholder={t("common.search")} />;` },
      { code: `const x = <div className="p-4" id="main" role="dialog" />;` },
      { code: `const x = <button type="submit" aria-label="close" />;` },
      { code: `const x = <div data-testid="row" />;` },
    ],
    invalid: [
      {
        code: `const x = <button>Save</button>;`,
        errors: [{ messageId: "literalText" }],
      },
      {
        code: `const x = <p>No results found</p>;`,
        errors: [{ messageId: "literalText" }],
      },
      {
        code: `const x = <input placeholder="Search" />;`,
        errors: [{ messageId: "literalAttr" }],
      },
      {
        code: `const x = <img alt="A cat" />;`,
        errors: [{ messageId: "literalAttr" }],
      },
      {
        code: `const x = <div title="Tooltip" />;`,
        errors: [{ messageId: "literalAttr" }],
      },
    ],
  },
  { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
);
