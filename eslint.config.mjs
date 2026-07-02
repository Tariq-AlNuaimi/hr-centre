import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import rihalTemplate from "./eslint-rules/index.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Local plugin enforcing CLAUDE.md hard rules. See eslint-rules/index.mjs.
  // These stay at error -- they protect template invariants, not style.
  {
    plugins: { "rihal-template": rihalTemplate },
    rules: {
      "rihal-template/no-prisma-in-client": "error",
      "rihal-template/no-any-cast-on-session": "error",
      "rihal-template/no-secret-env-in-console": "error",
      "rihal-template/no-bare-internal-route": "error",
      // Design-token enforcement (ADR-015): color comes from the theme tokens /
      // CSS variables, never a raw hex literal in a component. At error so the
      // considered theme can't quietly drift back to generic as the app grows.
      "rihal-template/no-raw-hex-color": "error",
      // Audit completeness (ADR-010): Prisma bulk-write / upsert ops on an
      // audited model write no audit row. At error so the "audit is automatic"
      // promise can't silently regress as a fork adds bulk writes.
      "rihal-template/no-unaudited-bulk-write": "error",
      // Injection floor (OWASP A03): the Unsafe raw-SQL methods don't
      // parameterize. The safe tagged-template $queryRaw/$executeRaw stay
      // allowed; only the *Unsafe escape hatch is gated.
      "rihal-template/no-raw-sql-unsafe": "error",
      // Throttle-ordering invariant: withRateLimit must compose OUTSIDE the
      // auth wrapper so abusive/unauthenticated floods are rejected before any
      // auth work (session lookup / bcrypt / secret compare) runs. At error so
      // the ordering can't silently invert as a fork adds rate-limited routes.
      "rihal-template/no-rate-limit-inside-auth": "error",
      // Export egress gate (SECURITY.md §1): a Restricted/secret field name as a
      // toExcel column key writes its raw value into the downloadable .xlsx --
      // SCRUB_FIELDS does not cover export output. At error so a fork can't leak
      // a secret column through an export route as it adds them.
      "rihal-template/no-restricted-export-column": "error",
      // Raw-client containment: prismaUnfiltered bypasses soft-delete + audit, so
      // it's allowlisted to auth / recycling-bin / maintenance files. At error so
      // an ordinary feature route can't silently drop those invariants by reaching
      // for the raw client. (tests/** + scripts/** are exempt below.)
      "rihal-template/no-prisma-unfiltered-import": "error",
    },
  },

  // Template-level rule relaxations.
  //
  // Next 16 + eslint-config-next 16.x tightened these to errors. The template's
  // patterns hit them in places that are pragmatically OK:
  //   - `(prisma as any)[dynamicAccessor]` in lib/prisma/soft-delete-extension.ts
  //     and app/api/recycling-bin/route.ts -- inherent dynamism that Prisma's
  //     type system can't express. Adding eslint-disable on every line is
  //     noisier than the rule.
  //   - `localStorage`/`matchMedia` -> setState in ThemeProvider's effect --
  //     legitimate platform-sync use case that the rule's own docs allow.
  //
  // Kept as warnings so they still surface in code review and `/ship` output
  // without blocking CI. CI's real quality gates are Semgrep (p/owasp-top-ten,
  // p/typescript) + gitleaks + the local rihal-template/* rules above, which
  // remain at error.
  {
    // Scoped to the JS/TS file set so the referenced plugins (react-hooks,
    // @typescript-eslint) are in scope. eslint-config-next registers those
    // plugins inside a `files`-scoped object; a global (no-`files`) override
    // object referencing their rules makes ESLint 9.x abort config validation
    // ("could not find plugin react-hooks"). Matching the glob keeps these
    // relaxations where the plugins are defined. (These rules only apply to
    // JS/TS source anyway.)
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      // Honor the `_`-prefix convention for intentionally-unused parameters
      // (e.g. `_req` in API route wrappers that require the param shape).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // NOTE: these tests/** + scripts/** override blocks MUST stay AFTER the
  // rihal-template plugin block above -- flat config is last-write-wins, so a
  // new rule added below them would also apply to tests/scripts. Keep additions
  // to the plugin block above this point.
  //
  // Tests legitimately embed example hex colors -- RuleTester fixtures for
  // no-raw-hex-color, sample data in component tests. The design-token rule is
  // about app/component code, so switch it off under tests/. Tests also drive
  // bulk writes deliberately (fixture setup, teardown), so the bulk-write gate
  // is for app/lib runtime, not test harnesses.
  {
    files: ["tests/**"],
    rules: {
      "rihal-template/no-raw-hex-color": "off",
      "rihal-template/no-unaudited-bulk-write": "off",
      // Integration / contract / UAT-setup suites legitimately drive the raw
      // client (assert soft-deleted rows, seed fixtures), so the containment
      // gate is for app/lib runtime, not the test harness.
      "rihal-template/no-prisma-unfiltered-import": "off",
    },
  },

  // Scripts and the Prisma seed run as bootstrap tooling outside any request /
  // AuditContext -- seeding/migration data is not request-attributable, so
  // bulk/upsert there is expected. The bulk-write gate stays on for app/lib.
  {
    files: ["scripts/**", "prisma/seed.*", "prisma/**/seed.*"],
    rules: {
      "rihal-template/no-unaudited-bulk-write": "off",
      "rihal-template/no-prisma-unfiltered-import": "off",
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "generated/**",
    "eslint-rules/**",
  ]),
]);

export default eslintConfig;
