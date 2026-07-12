#!/usr/bin/env node
// Opt-in enabler for the interactive Scalar API-reference page (ADR-052).
//
// WHY THIS IS OPT-IN: the OpenAPI *contract seam* (lib/openapi + GET /api/openapi)
// ships in every fork — it's tiny and server-side. But the Scalar *renderer*
// (`@scalar/api-reference-react`) adds ~0.67MB gzipped of client chunk, and
// .size-limit.json sums ALL route chunks, so shipping it by default blows the
// template's 1.2MB budget for the ~all forks that never expose `/api/v1`. So the
// default template does NOT depend on Scalar or ship the page; a fork that actually
// serves a versioned public API runs this to add the human-facing docs UI.
//
// Mirrors the scaffold-* generators: writes via `fs` (a plain Node process), so the
// blueprint/build-vs-buy PreToolUse hooks — which only intercept Claude's Write/Edit
// tools — don't fire; the page is pre-authorized by docs/blueprints/openapi-contract-seam.md
// (Scope covers app/(docs)/api-reference/page.tsx), so a later human edit is gate-clean.
//
// Usage:
//   npm run enable:api-reference            # write page + install @scalar dep
//   npm run enable:api-reference -- --no-install   # write files only (you install)
//   npm run enable:api-reference -- --dry-run       # show what would happen
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SCALAR_DEP = "@scalar/api-reference-react";
const SCALAR_VERSION = "^0.9.54";
const ROOT = process.cwd();
const PAGE_DIR = path.join(ROOT, "app", "(docs)", "api-reference");

const argv = new Set(process.argv.slice(2));
const dryRun = argv.has("--dry-run");
const noInstall = argv.has("--no-install");
const force = argv.has("--force"); // overwrite an already-customized page

const PAGE_TSX = `import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { defaultLocale } from "@/i18n/config";
import ApiReferenceView from "./ApiReferenceView";

export const metadata = { title: "API Reference" };

// GET /api-reference -- the interactive Scalar API reference (ADR-052, US2).
//
// Internal-gated (ADR-052 decision 1 / US2-worst): a server-side session check,
// the same way other authed pages gate (mirrors the audit-log page). \`middleware\`
// also gates this path, so this check is defense in depth. Scalar fetches
// \`/api/openapi\` same-origin, so the request carries the session cookie and the
// \`withAuth\`-wrapped spec route authorizes it.
export default async function ApiReferencePage() {
  const session = await auth();
  if (!session) redirect(\`/\${defaultLocale}/login\`);
  return <ApiReferenceView />;
}
`;

const VIEW_TSX = `"use client";

import dynamic from "next/dynamic";
import "@scalar/api-reference-react/style.css";

// Scalar renders in the browser only: it touches \`window\` at mount, so we load
// it via a client-side dynamic import with \`ssr: false\` (permitted inside a
// client component) to keep it out of the server render. It fetches the spec
// same-origin from \`/api/openapi\`, carrying the session cookie.
const ApiReferenceReact = dynamic(
  () => import("@scalar/api-reference-react").then((m) => m.ApiReferenceReact),
  { ssr: false },
);

export default function ApiReferenceView() {
  return <ApiReferenceReact configuration={{ url: "/api/openapi" }} />;
}
`;

const files = [
  { rel: "app/(docs)/api-reference/page.tsx", body: PAGE_TSX },
  { rel: "app/(docs)/api-reference/ApiReferenceView.tsx", body: VIEW_TSX },
];

if (dryRun) {
  console.log("[enable:api-reference] --dry-run — would:");
  for (const f of files) console.log(`  write ${f.rel}`);
  if (!noInstall) console.log(`  npm i ${SCALAR_DEP}@${SCALAR_VERSION}`);
  process.exit(0);
}

mkdirSync(PAGE_DIR, { recursive: true });
for (const f of files) {
  const abs = path.join(ROOT, f.rel);
  // Don't clobber a fork's local customizations on re-run (e.g. reinstalling the dep
  // after a node_modules wipe). Pass --force to overwrite intentionally.
  if (existsSync(abs) && !force) {
    console.log(
      `[enable:api-reference] ${f.rel} already exists — skipping (pass --force to overwrite)`,
    );
    continue;
  }
  writeFileSync(abs, f.body);
  console.log(`[enable:api-reference] wrote ${f.rel}`);
}

if (!noInstall) {
  if (existsSync(path.join(ROOT, "node_modules", "@scalar", "api-reference-react"))) {
    console.log(`[enable:api-reference] ${SCALAR_DEP} already installed — skipping npm i`);
  } else {
    console.log(`[enable:api-reference] installing ${SCALAR_DEP}@${SCALAR_VERSION} …`);
    const r = spawnSync("npm", ["i", `${SCALAR_DEP}@${SCALAR_VERSION}`], { stdio: "inherit" });
    if (r.status !== 0) {
      console.error(
        `[enable:api-reference] npm i failed. Files are written; install ${SCALAR_DEP} manually.`,
      );
      process.exit(r.status ?? 1);
    }
  }
}

if (noInstall) {
  console.log(
    `[enable:api-reference] --no-install: install the dep before building — ` +
      `\`npm i ${SCALAR_DEP}@${SCALAR_VERSION}\` (tsc/build fail with TS2307 until you do).`,
  );
}
console.log(
  "[enable:api-reference] done. The Scalar docs live at /api-reference (auth-gated). " +
    "Run `npm run ship` — note it will now count the Scalar chunk against .size-limit.json; " +
    "raise the budget or set sizeLimitAck if your fork accepts the ~0.67MB cost.",
);
