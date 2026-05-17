import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import rihalTemplate from "./eslint-rules/index.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Local plugin enforcing CLAUDE.md hard rules. See eslint-rules/index.mjs.
  {
    plugins: { "rihal-template": rihalTemplate },
    rules: {
      "rihal-template/no-prisma-in-client": "error",
      "rihal-template/no-any-cast-on-session": "error",
      "rihal-template/no-secret-env-in-console": "error",
      "rihal-template/no-bare-internal-route": "error",
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
