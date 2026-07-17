import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
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
      // AI-Quality automatable slice (ADR-042): model access must go through the
      // @/lib/ai barrel, never a raw @anthropic-ai/sdk import. Only lib/ai/** owns
      // the SDK seam (provider + Tool-Runner wrapper); a route reaching for the SDK
      // directly bypasses the isAiConfigured() gate, the endpoint-agnostic client,
      // the default model/max_tokens, and the GenAI tracing. At error so the
      // "model access only via @/lib/ai" promise can't silently regress.
      "rihal-template/no-direct-anthropic-sdk": "error",
    },
  },

  // Layout design-token enforcement (V2-304) — the sibling of no-raw-hex-color
  // (which does color). Spacing and font-size must come from the scale (the 4px
  // `p-*`/`gap-*` steps, the `text-xs…text-h1` type scale), never a one-off
  // arbitrary value dropped into a className (`p-[13px]`, `text-[15px]`). Scoped
  // to JSX/TSX where Tailwind classNames live (a plain .ts string that happens to
  // read `p-[13px]` is not a class). At error so a considered spacing/type rhythm
  // can't quietly drift back to ad-hoc pixels; escape is the single-line
  // `// eslint-disable-next-line rihal-template/no-arbitrary-className` for a
  // justified one-off (e.g. an outsize display number with no token).
  {
    files: ["**/*.{jsx,tsx}"],
    rules: { "rihal-template/no-arbitrary-className": "error" },
  },

  // Static accessibility gate (ADOPT.md A1; cat 22). eslint-plugin-jsx-a11y's
  // recommended set catches the mechanical a11y regressions (missing alt text,
  // invalid ARIA, non-interactive elements with handlers, label-less controls)
  // at lint time -- the static complement to the runtime axe pass in /design-qa.
  // Scoped to JSX/TSX only. At error so a fork can't merge an inaccessible
  // control; the escape is the standard single-line `// eslint-disable-next-line
  // jsx-a11y/<rule>` (a genuine false positive), never a silent config removal.
  // NOTE: eslint-config-next already REGISTERS the jsx-a11y plugin, so this block
  // must NOT re-declare it (flat config forbids redefining a plugin) -- it only
  // turns the recommended ruleset ON. The rule map is read from the plugin's own
  // flatConfigs.recommended so it tracks the plugin version.
  {
    files: ["**/*.{jsx,tsx}"],
    rules: { ...jsxA11y.flatConfigs.recommended.rules },
  },
  // These three rules had PRE-EXISTING hits during Workstream C (the AntD->Tailwind
  // replatform, ADR-029) in the command-palette shell and the shadcn label
  // primitive, so the A1 gate held them at WARN while those files were mid-rewrite.
  // C4 landed the accessible replacements: the palette keydown now rides the native
  // <Input> (no static-element handler), the palette autofocus + the label-primitive
  // association carry justified single-line disables at their call sites. With zero
  // residual violations the rules are back at ERROR and block any regression --
  // closing TODO(C4). Every jsx-a11y rule is now error.
  {
    files: ["**/*.{jsx,tsx}"],
    rules: {
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/label-has-associated-control": "error",
    },
  },

  // Complexity metric gate (ADOPT.md A1; cat 09 quality). A quantified cyclomatic
  // complexity ceiling turns "keep functions simple" from a vibe into a gate.
  // Scoped to PRODUCT runtime code (app/components/lib/hooks/i18n/middleware) --
  // not the build/CI tooling under scripts/ + .claude/hooks/, whose codegen and
  // scanners are legitimately branchy. Set at 24: just above the current in-scope
  // maximum (components/shared/DataTable.tsx at 23, a shared primitive owned by the
  // UI-layer workstream), so the template ships green. TODO(maintainable): tighten
  // toward ~15 as DataTable is decomposed by the replatform. Waiver: the standard
  // single-line `// eslint-disable-next-line complexity`.
  {
    files: [
      "app/**/*.{js,jsx,ts,tsx}",
      "components/**/*.{js,jsx,ts,tsx}",
      "lib/**/*.{js,ts}",
      "hooks/**/*.{js,ts,tsx}",
      "i18n/**/*.{js,ts}",
      "middleware.ts",
      "auth.ts",
    ],
    rules: { complexity: ["error", 24] },
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
      // React Compiler visibility (ADR-048 follow-on). This diagnostic fires when
      // the compiler CANNOT memoize a component (a Rules-of-React violation / an
      // incompatible library), so it silently skips it — the auto-memoization win
      // is then quietly incomplete. At `error` (not the eslint-config-next default
      // `warn`, which `/ship`'s lint phase doesn't fail on) a newly-skipped
      // component BLOCKS: fix the violation, or add a justified single-line
      // `eslint-disable-next-line` as `components/shared/DataTable.tsx` does for
      // TanStack Table's known-incompatible `useReactTable`.
      "react-hooks/incompatible-library": "error",
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
      // Playwright / playwright-bdd fixtures take a `use` callback
      // (`async ({}, use) => { await use(value) }`) that the react-hooks plugin
      // misreads as a React Hook. Test harness code is not React — the rule
      // doesn't apply here (ADR-058 BDD step fixtures).
      "react-hooks/rules-of-hooks": "off",
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
    ".source/**", // fumadocs generated collections (enable-docs-site, ADR-053)
    "out/**",
    "build/**",
    "next-env.d.ts",
    "generated/**",
    "eslint-rules/**",
    // Transient parallel-session worktrees (isolated copies of the repo under
    // .claude/worktrees/); linting into them double-counts files and picks up
    // other agents' in-flight code. Gitignored already; ignore for lint too.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
