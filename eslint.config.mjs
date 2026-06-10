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

  // Tests legitimately embed example hex colors -- RuleTester fixtures for
  // no-raw-hex-color, sample data in component tests. The design-token rule is
  // about app/component code, so switch it off under tests/.
  {
    files: ["tests/**"],
    rules: { "rihal-template/no-raw-hex-color": "off" },
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
