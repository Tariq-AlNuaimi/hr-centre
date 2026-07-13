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
// pre-authorized by docs/blueprints/docs-site-fumadocs.md (Scope covers
// app/[locale]/docs/**, app/api/docs-search/**, content/docs/**, lib/docs/**,
// source.config.ts), so a later human edit is gate-clean.
//
// The emitted files live as byte-exact `.tpl` snapshots under
// scripts/templates/docs-site/** (verified end-to-end: build green, authed render,
// search, AC-2.2 frontmatter failure, anon 307 — see the blueprint). The `.tpl`
// suffix keeps them out of tsc/eslint in the dep-free default template.
//
// Usage:
//   npm run enable:docs-site                 # write files, patch configs, install deps
//   npm run enable:docs-site -- --no-install # write/patch only (you install + run `npx fumadocs-mdx`)
//   npm run enable:docs-site -- --dry-run    # show what would happen
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
// 2. Config patches — idempotent (marker-guarded) anchored edits. A missing
//    anchor means the file diverged from the template shape: FAIL LOUDLY with
//    the manual instruction instead of writing a corrupt config.
//    tests/contracts/enable-docs-site.test.ts pins these anchors against drift.
// ---------------------------------------------------------------------------
const PATCHES = [
  {
    rel: "next.config.ts",
    marker: "fumadocs-mdx/next",
    describe: "wire the fumadocs-mdx loader (createMDX) into the plugin chain",
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
    marker: '"collections/*"',
    describe: 'add the "collections/*" -> ./.source/* path alias',
    apply(text) {
      const anchor = '"@/*": ["./*"]';
      if (!text.includes(anchor)) return null;
      return text.replace(anchor, '"@/*": ["./*"],\n      "collections/*": ["./.source/*"]');
    },
  },
  {
    rel: "app/globals.css",
    marker: "BEGIN fumadocs",
    describe: "import fumadocs-ui styles + the app-token bridge",
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
    marker: "source.config.ts",
    describe: "register source.config.ts as a knip entry (the fumadocs toolchain consumes it)",
    apply(text) {
      const anchor = '"brand.config.ts"';
      if (!text.includes(anchor)) return null;
      return text.replace(anchor, '"brand.config.ts",\n    "source.config.ts"');
    },
  },
];

// package.json is parsed as JSON (not string-patched): add the deps at pinned
// ranges and the upstream-conventional `postinstall: fumadocs-mdx`, so a fresh
// clone of an ENABLED fork regenerates .source/ before typecheck/build instead
// of failing TS2307 on the collections/* alias.
function patchPackageJson(pkg) {
  const notes = [];
  pkg.dependencies ??= {};
  for (const [dep, range] of Object.entries(DEPS)) {
    if (!pkg.dependencies[dep]) {
      pkg.dependencies[dep] = range;
      notes.push(`dependencies.${dep} = ${range}`);
    }
  }
  pkg.scripts ??= {};
  if (!pkg.scripts.postinstall) {
    pkg.scripts.postinstall = "fumadocs-mdx";
    notes.push('scripts.postinstall = "fumadocs-mdx"');
  } else if (!pkg.scripts.postinstall.includes("fumadocs-mdx")) {
    console.warn(
      `${TAG} WARNING: scripts.postinstall already exists ("${pkg.scripts.postinstall}") — ` +
        `chain \`fumadocs-mdx\` into it manually so fresh clones regenerate .source/.`,
    );
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Dry run: report, touch nothing.
// ---------------------------------------------------------------------------
if (dryRun) {
  console.log(`${TAG} --dry-run — would:`);
  for (const t of templates) console.log(`  write ${t.rel}`);
  for (const p of PATCHES) {
    const abs = path.join(ROOT, p.rel);
    const done = existsSync(abs) && readFileSync(abs, "utf8").includes(p.marker);
    console.log(`  patch ${p.rel} — ${p.describe}${done ? " (already applied)" : ""}`);
  }
  console.log(`  patch package.json — deps + postinstall`);
  const depList = Object.entries(DEPS)
    .map(([d, r]) => `${d}@${r}`)
    .join(" ");
  if (!noInstall) console.log(`  npm install (${depList}) + npx fumadocs-mdx`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 3. Write the files.
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
// 4. Patch the configs.
// ---------------------------------------------------------------------------
let patchFailed = false;
for (const p of PATCHES) {
  const abs = path.join(ROOT, p.rel);
  const text = readFileSync(abs, "utf8");
  if (text.includes(p.marker)) {
    console.log(`${TAG} ${p.rel} already patched — skipping`);
    continue;
  }
  const next = p.apply(text);
  if (next === null) {
    console.error(
      `${TAG} ERROR: ${p.rel} has diverged from the expected shape — could not ${p.describe}. ` +
        `Apply that change manually (see docs/blueprints/docs-site-fumadocs.md).`,
    );
    patchFailed = true;
    continue;
  }
  writeFileSync(abs, next);
  console.log(`${TAG} patched ${p.rel} — ${p.describe}`);
}

const pkgPath = path.join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const pkgNotes = patchPackageJson(pkg);
if (pkgNotes.length > 0) {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`${TAG} patched package.json — ${pkgNotes.join(", ")}`);
} else {
  console.log(`${TAG} package.json already patched — skipping`);
}

// ---------------------------------------------------------------------------
// 5. Install + generate .source/.
// ---------------------------------------------------------------------------
if (!noInstall) {
  if (existsSync(path.join(ROOT, "node_modules", "fumadocs-ui"))) {
    console.log(`${TAG} fumadocs deps already installed — skipping npm install`);
  } else {
    console.log(`${TAG} installing fumadocs deps …`);
    const r = spawnSync("npm", ["install"], { stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`${TAG} npm install failed. Files are written; install manually.`);
      process.exit(r.status ?? 1);
    }
  }
  // postinstall covers future installs; generate now for this working tree.
  const g = spawnSync("npx", ["fumadocs-mdx"], { stdio: "inherit" });
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

if (patchFailed) {
  console.error(`${TAG} done WITH ERRORS — one or more config patches need manual attention.`);
  process.exit(1);
}
console.log(
  `${TAG} done. Docs live at /{locale}/docs (auth-gated; internal-only by default — ` +
    `see content/docs/adding-pages.mdx for the public posture). Adds ~213kB gzip of ` +
    `client chunk; an enabled fork stays under the 1.2MB size-limit budget (918kB verified). ` +
    `Run \`npm run ship\` to confirm.`,
);
