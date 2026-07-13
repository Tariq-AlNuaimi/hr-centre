#!/usr/bin/env node
// Opt-in enabler for the internal Fumadocs docs site (ADR-053).
//
// WHY THIS IS OPT-IN: the docs site adds three runtime deps (fumadocs-ui/-core/-mdx,
// each >50KB — the Ask-before dep line) plus ~213kB gzip of client chunk, an MDX
// compile step in `next build`, and a generated `.source/` dir. Most forks never
// need a docs site, so the default template ships none of it: no deps, no config
// hooks, byte-identical build. A fork that wants browsable internal docs + the ADR
// series runs this once.
//
// Mirrors enable-api-reference.mjs / the scaffold-* generators: writes via `fs`
// (a plain Node process), so the blueprint/build-vs-buy PreToolUse hooks — which
// only intercept Claude's Write/Edit tools — don't fire; the emitted surface is
// pre-authorized by docs/blueprints/docs-site-fumadocs.md (its Scope line covers
// the emitted files and these templates), so a later human edit is gate-clean.
//
// The emitted files live as byte-exact `.tpl` snapshots under
// scripts/templates/docs-site/** (verified end-to-end: build green, authed render,
// search, AC-2.2 frontmatter failure, anon 307 — see the blueprint). The `.tpl`
// suffix keeps them out of tsc/eslint in the dep-free default template.
//
// FAILURE ORDERING (all-or-nothing, like scaffold-entity): every config patch is
// computed and validated BEFORE anything is written or installed — a diverged
// anchor aborts with the manual instruction and an untouched tree. The real run
// then installs deps FIRST (a transient npm failure also leaves the tree
// untouched), and only after a successful install writes files + configs.
//
// Usage:
//   npm run enable:docs-site                 # install deps, write files, patch configs
//   npm run enable:docs-site -- --no-install # write/patch only (you install + run `npx fumadocs-mdx`)
//   npm run enable:docs-site -- --dry-run    # validate + show what would happen
//   npm run enable:docs-site -- --force      # overwrite already-emitted files
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const TAG = "[enable:docs-site]";
const ROOT = process.cwd();
const TEMPLATE_DIR = path.join(ROOT, "scripts", "templates", "docs-site");

// Versions the prototype was verified against (blueprint AC run, 2026-07-12).
const DEPS = {
  "fumadocs-ui": "^16.11.3",
  "fumadocs-core": "^16.11.3",
  "fumadocs-mdx": "^15.1.0",
  "@types/mdx": "^2.0.14",
};

const argv = new Set(process.argv.slice(2));
const dryRun = argv.has("--dry-run");
const noInstall = argv.has("--no-install");
const force = argv.has("--force");

// npm/npx are .cmd shims on Windows; spawnSync needs a shell there. The command
// strings are static (never user input), so shell:true is injection-safe.
function run(cmd, args) {
  return spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
}

// ---------------------------------------------------------------------------
// 1. Files: every *.tpl under scripts/templates/docs-site/** copies to the same
//    repo-relative path minus the .tpl suffix.
// ---------------------------------------------------------------------------
function walkTemplates(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTemplates(abs));
    else if (entry.name.endsWith(".tpl")) out.push(abs);
  }
  return out;
}

const templates = walkTemplates(TEMPLATE_DIR).map((abs) => ({
  src: abs,
  rel: path.relative(TEMPLATE_DIR, abs).replace(/\.tpl$/, ""),
}));

// ---------------------------------------------------------------------------
// 2. Config patches — idempotent anchored edits, computed up front. A missing
//    anchor means the file diverged from the template shape: the whole run
//    aborts BEFORE any write, with the manual instruction, instead of leaving a
//    half-enabled tree. `optional` configs (droppable dev tools) are skipped
//    with a warning when absent. isApplied() must be precise — a substring an
//    unrelated fork edit could contain is not enough (the knip check parses).
//    tests/contracts/enable-docs-site.test.ts pins these anchors against drift.
// ---------------------------------------------------------------------------
const PATCHES = [
  {
    rel: "next.config.ts",
    describe: "wire the fumadocs-mdx loader (createMDX) into the plugin chain",
    isApplied: (text) => text.includes("fumadocs-mdx/next"),
    apply(text) {
      const importAnchor = 'import createNextIntlPlugin from "next-intl/plugin";';
      const chainAnchor = "const baseConfig = withAnalyzer(withNextIntl(nextConfig));";
      if (!text.includes(importAnchor) || !text.includes(chainAnchor)) return null;
      return text
        .replace(
          importAnchor,
          importAnchor +
            "\n// fumadocs (enable-docs-site): compiles content/docs + ADR MDX collections (ADR-053)\n" +
            'import { createMDX } from "fumadocs-mdx/next";',
        )
        .replace(
          chainAnchor,
          "// fumadocs (enable-docs-site): withMDX generates .source/ and wires the MDX loader\n" +
            "const withMDX = createMDX();\n" +
            "const baseConfig = withMDX(withAnalyzer(withNextIntl(nextConfig)));",
        );
    },
  },
  {
    rel: "tsconfig.json",
    describe: 'add the "collections/*" -> ./.source/* path alias',
    isApplied: (text) => text.includes('"collections/*"'),
    apply(text) {
      const anchor = '"@/*": ["./*"]';
      if (!text.includes(anchor)) return null;
      return text.replace(anchor, '"@/*": ["./*"],\n      "collections/*": ["./.source/*"]');
    },
  },
  {
    rel: "app/globals.css",
    describe: "import fumadocs-ui styles + the app-token bridge",
    isApplied: (text) => text.includes("BEGIN fumadocs"),
    apply(text) {
      const anchor = '@import "./tokens.css";';
      if (!text.includes(anchor)) return null;
      return text.replace(
        anchor,
        anchor +
          "\n/* BEGIN fumadocs (enable-docs-site, ADR-053) — docs-site styles + token bridge */\n" +
          '@import "fumadocs-ui/css/neutral.css";\n' +
          '@import "fumadocs-ui/css/preset.css";\n' +
          '@import "./fumadocs-tokens.css";\n' +
          "/* END fumadocs (enable-docs-site) */",
      );
    },
  },
  {
    rel: "knip.json",
    optional: true, // a fork may have dropped knip entirely
    describe: "register source.config.ts as a knip entry (the fumadocs toolchain consumes it)",
    // Parse instead of substring-matching: "source.config.ts" appearing in an
    // unrelated knip field (ignore, a comment) must not skip the entry insert.
    isApplied(text) {
      try {
        return JSON.parse(text).entry?.includes("source.config.ts") ?? false;
      } catch {
        return false;
      }
    },
    apply(text) {
      const anchor = '"brand.config.ts"';
      if (!text.includes(anchor)) return null;
      return text.replace(anchor, '"brand.config.ts",\n    "source.config.ts"');
    },
  },
];

// Validate every patch up front. Result per patch: {patch, status, next?}
// status: "apply" | "already" | "skip-missing" | "fail"
function planPatches() {
  return PATCHES.map((patch) => {
    const abs = path.join(ROOT, patch.rel);
    if (!existsSync(abs)) {
      return { patch, status: patch.optional ? "skip-missing" : "fail" };
    }
    const text = readFileSync(abs, "utf8");
    if (patch.isApplied(text)) return { patch, status: "already" };
    const next = patch.apply(text);
    if (next === null) return { patch, status: "fail" };
    return { patch, status: "apply", next };
  });
}

// package.json is parsed as JSON (not string-patched). Deps are recorded by the
// npm install itself in the default path; this only handles --no-install dep
// recording plus the upstream-conventional postinstall so a fresh clone of an
// ENABLED fork regenerates .source/ before typecheck/build instead of failing
// TS2307 on the collections/* alias. An existing postinstall is CHAINED, never
// warn-and-skipped — a missed warning here would surface months later as a
// broken fresh clone.
function patchPackageJson(pkg, { recordDeps }) {
  const notes = [];
  if (recordDeps) {
    pkg.dependencies ??= {};
    for (const [dep, range] of Object.entries(DEPS)) {
      if (!pkg.dependencies[dep]) {
        pkg.dependencies[dep] = range;
        notes.push(`dependencies.${dep} = ${range}`);
      }
    }
  }
  pkg.scripts ??= {};
  if (!pkg.scripts.postinstall) {
    pkg.scripts.postinstall = "fumadocs-mdx";
    notes.push('scripts.postinstall = "fumadocs-mdx"');
  } else if (!pkg.scripts.postinstall.includes("fumadocs-mdx")) {
    pkg.scripts.postinstall = `${pkg.scripts.postinstall} && fumadocs-mdx`;
    notes.push('scripts.postinstall += " && fumadocs-mdx"');
  }
  return notes;
}

const plan = planPatches();
const failed = plan.filter((p) => p.status === "fail");
const depList = Object.entries(DEPS)
  .map(([d, r]) => `${d}@${r}`)
  .join(" ");

// ---------------------------------------------------------------------------
// Dry run: report the validated plan, touch nothing. Exits 1 when a patch
// would fail so the plan is trustworthy — the real run aborts on the same
// condition.
// ---------------------------------------------------------------------------
if (dryRun) {
  console.log(`${TAG} --dry-run — would:`);
  for (const t of templates) console.log(`  write ${t.rel}`);
  for (const { patch, status } of plan) {
    const note = {
      apply: "",
      already: " (already applied)",
      "skip-missing": " (file absent — skipped)",
      fail: " (WOULD FAIL — file diverged/missing, see docs/blueprints/docs-site-fumadocs.md)",
    }[status];
    console.log(`  patch ${patch.rel} — ${patch.describe}${note}`);
  }
  console.log(`  patch package.json — postinstall${noInstall ? " + deps" : ""}`);
  if (!noInstall) console.log(`  npm install (${depList}) + npx fumadocs-mdx`);
  if (failed.length > 0) {
    console.error(
      `${TAG} --dry-run: ${failed.length} config patch(es) WOULD FAIL — fix before enabling.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

// Abort before ANY mutation when a required patch can't apply.
if (failed.length > 0) {
  for (const { patch } of failed) {
    console.error(
      `${TAG} ERROR: ${patch.rel} is missing or diverged from the expected shape — ` +
        `could not ${patch.describe}. Apply that change manually ` +
        `(see docs/blueprints/docs-site-fumadocs.md), then re-run. Nothing was written.`,
    );
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Install deps FIRST (unless --no-install): `npm install <specs>` records
//    them in package.json AND installs atomically, so a transient npm failure
//    leaves the tree completely untouched (no files, no config patches, no
//    import of a module that isn't installed).
// ---------------------------------------------------------------------------
if (!noInstall) {
  if (existsSync(path.join(ROOT, "node_modules", "fumadocs-ui"))) {
    console.log(`${TAG} fumadocs deps already installed — skipping npm install`);
  } else {
    console.log(`${TAG} installing ${depList} …`);
    const r = run("npm", ["install", ...Object.entries(DEPS).map(([d, v]) => `${d}@${v}`)]);
    if (r.status !== 0) {
      console.error(`${TAG} npm install failed — nothing was written; fix the install and re-run.`);
      process.exit(r.status ?? 1);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Write the files.
// ---------------------------------------------------------------------------
for (const t of templates) {
  const abs = path.join(ROOT, t.rel);
  // Don't clobber a fork's local customizations on re-run. --force overwrites.
  if (existsSync(abs) && !force) {
    console.log(`${TAG} ${t.rel} already exists — skipping (pass --force to overwrite)`);
    continue;
  }
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, readFileSync(t.src));
  console.log(`${TAG} wrote ${t.rel}`);
}

// ---------------------------------------------------------------------------
// 5. Apply the pre-validated config patches + package.json.
// ---------------------------------------------------------------------------
for (const { patch, status, next } of plan) {
  if (status === "already") {
    console.log(`${TAG} ${patch.rel} already patched — skipping`);
    continue;
  }
  if (status === "skip-missing") {
    console.warn(`${TAG} ${patch.rel} not found — skipped (${patch.describe})`);
    continue;
  }
  writeFileSync(path.join(ROOT, patch.rel), next);
  console.log(`${TAG} patched ${patch.rel} — ${patch.describe}`);
}

const pkgPath = path.join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const pkgNotes = patchPackageJson(pkg, { recordDeps: noInstall });
if (pkgNotes.length > 0) {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`${TAG} patched package.json — ${pkgNotes.join(", ")}`);
} else {
  console.log(`${TAG} package.json already patched — skipping`);
}

// ---------------------------------------------------------------------------
// 6. Generate .source/ for this working tree (postinstall covers future
//    installs). Re-running the enabler is idempotent, so a failure here is
//    recoverable by re-running (or `npx fumadocs-mdx` directly).
// ---------------------------------------------------------------------------
if (!noInstall) {
  const g = run("npx", ["fumadocs-mdx"]);
  if (g.status !== 0) {
    console.error(`${TAG} \`npx fumadocs-mdx\` failed — run it manually before building.`);
    process.exit(g.status ?? 1);
  }
} else {
  console.log(
    `${TAG} --no-install: run \`npm install\` then \`npx fumadocs-mdx\` before building ` +
      `(tsc/build fail with TS2307 until you do).`,
  );
}

console.log(
  `${TAG} done. Docs live at /{locale}/docs (auth-gated; internal-only by default — ` +
    `see content/docs/adding-pages.mdx for the public posture). Adds ~213kB gzip of ` +
    `client chunk; an enabled fork stays under the 1.2MB size-limit budget (918kB verified). ` +
    `Run \`npm run ship\` to confirm.`,
);
