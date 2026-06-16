// RuleTester coverage for the eight local CLAUDE.md-enforcement rules in
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

// RuleTester.run() throws on the first mismatch; node:test surfaces that as a
// failed case. Wrapping each rule in its own test() keeps failures isolated.
function ruleTest(name, rule, cases, parserOptions) {
  test(name, () => {
    const tester = new RuleTester(
      parserOptions
        ? { languageOptions: { parser: tsParser, parserOptions } }
        : undefined
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
  { ecmaVersion: 2022, sourceType: "module" }
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
  { ecmaVersion: 2022, sourceType: "module" }
);

// --- no-raw-hex-color ------------------------------------------------------
// Color must come from the theme tokens / CSS vars, not a raw hex in a
// component. The token source file (antd-theme.ts) is exempt; comments aren't
// literals so example hexes in docs don't trip it.
const THEME_SRC = "/repo/components/layout/antd-theme.ts";
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
      errors: [
        { messageId: "noRawHexColor" },
        { messageId: "noRawHexColor" },
      ],
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
    ],
  },
  { ecmaVersion: 2022, sourceType: "module" }
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
  { ecmaVersion: 2022, sourceType: "module" }
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
      { code: `export const PUT = withRateLimit(withAuth(handler), { id: "x", limit: 5, windowMs: 60000 });` },
      // Token wrapper nested inside the throttle is the sanctioned shape too.
      { code: `export const GET = withRateLimit(withInternalAuth("CRON_SECRET", purge, { bearer: true }), opts);` },
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
    ],
  },
  { ecmaVersion: 2022, sourceType: "module" }
);
