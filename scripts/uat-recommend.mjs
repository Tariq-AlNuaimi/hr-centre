#!/usr/bin/env node
// uat-recommend.mjs — P5 (Build D): Logic + UX recommendations.
//
// Synthesizes a PRIORITIZED recommendation list from two evidence sources:
//   1. The UAT run outcomes — the Playwright JSON results plus the P2/P3/P4 JSON
//      sinks (role-matrix, crud-journeys, uiux-findings). A failed flow, an
//      authorization mismatch, a blank shell, an RTL regression, or a console
//      error becomes an evidence-backed recommendation.
//   2. A lightweight STATIC scan of the source for stub/incomplete markers
//      (TODO/FIXME/HACK, "not implemented", "coming soon"/WIP) with file:line.
//
// Everything is DISCOVERY-DRIVEN and app-agnostic: sections/entities/roles come
// from the run sinks, never a hardcoded list. Output is written to
// uat-results/recommendations.json and consumed by scripts/uat-pdf.mjs (P5
// section). Run standalone via `npm run uat:recommend`, or it is auto-invoked by
// `npm run uat:pdf` so the report is always fresh.
//
// Priorities:
//   P0 — broken / security-relevant: failing flow, authz mismatch, uncaught
//        runtime error. Fix before sharing.
//   P1 — incomplete: a CRUD phase that couldn't be exercised, a blank shell, an
//        RTL regression, or a stub marker in code.
//   P2 — polish: console errors, leftover debug, minor markers.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RESULTS_DIR = path.join(ROOT, "uat-results");
const OUT_JSON = path.join(RESULTS_DIR, "recommendations.json");

const SRC_DIRS = ["app", "components", "lib", "hooks", "middleware.ts"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "generated",
  "uat-results",
  "uat-report",
  "test-results",
]);

// High-signal stub/incomplete markers. Each maps to a default priority. The
// patterns are deliberately strict to avoid false positives: a real task marker
// is written `TODO:` / `FIXME(owner):`, not the string "TODO" used as example
// data; and "placeholder" is an everyday form prop, so it is NOT a marker.
const MARKERS = [
  {
    re: /\b(TODO|FIXME|HACK|XXX)\b\s*[:(]/,
    priority: "P1",
    label: "incomplete marker",
  },
  {
    re: /not[\s_-]?implemented|throw new Error\(\s*['"`][^'"`]*implement/i,
    priority: "P1",
    label: "unimplemented stub",
  },
  {
    re: /coming soon|\bWIP\b|\bTBD\b/i,
    priority: "P2",
    label: "WIP / TBD",
  },
];

// One recommendation record. Positional so the ~12 push sites stay compact;
// key ORDER here is load-bearing — it fixes the JSON output shape.
const rec = (priority, category, title, detail, evidence, source = "uat") => ({
  priority,
  category,
  title,
  detail,
  evidence,
  source,
});

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Recursively collect source files under the given roots (relative to `base`). */
function collectFiles(roots, base) {
  const out = [];
  const walk = (p) => {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch {
      return;
    }
    if (stat.isFile()) {
      if (/\.(ts|tsx|mjs|js|jsx)$/.test(p)) out.push(p);
      return;
    }
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(p, entry.name));
    }
  };
  for (const r of roots) walk(path.join(base, r));
  return out;
}

/** Static scan: find stub/incomplete markers as P1/P2 recommendations. */
function staticFindings(base) {
  const recs = [];
  const seen = new Set();
  for (const file of collectFiles(SRC_DIRS, base)) {
    let lines;
    try {
      lines = fs.readFileSync(file, "utf8").split("\n");
    } catch {
      continue;
    }
    const rel = path.relative(base, file);
    lines.forEach((line, i) => {
      // Don't flag eslint-disable directives or this file's own marker list.
      if (/eslint-disable/.test(line)) return;
      for (const m of MARKERS) {
        if (m.re.test(line)) {
          const key = `${rel}:${i + 1}`;
          if (seen.has(key)) return;
          seen.add(key);
          recs.push(rec(m.priority, "code",
            `${m.label} in ${path.basename(rel)}`,
            line.trim().slice(0, 160),
            [`${rel}:${i + 1}`],
            "static",
          ));
          return;
        }
      }
    });
  }
  return recs;
}

/** Flatten the Playwright JSON report into failed-spec recommendations (P0). */
function failedSpecFindings(results) {
  const recs = [];
  if (!results) return recs;
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      if (spec.ok === false) {
        recs.push(rec("P0", "flow",
          `Failing UAT flow: ${spec.title}`,
          "A browser-driven flow failed; the app does not behave as expected here.",
          [spec.file ?? suite.file ?? "(unknown spec file)"],
        ));
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of results.suites ?? []) visit(suite);
  return recs;
}

/** Permission-matrix mismatches -> P0 authorization recommendations. */
function matrixFindings(matrix) {
  const recs = [];
  if (!Array.isArray(matrix)) return recs;
  for (const c of matrix) {
    if (c.ok === false) {
      const reachedButShouldNot = c.reached && !c.expectedReach;
      recs.push(rec("P0", "authorization",
        reachedButShouldNot
          ? `Authorization gap: ${c.role} reached admin-only "${c.section}"`
          : `Access regression: ${c.role} was blocked from "${c.section}" it should reach`,
        `Expected ${c.expectedReach ? "reach" : "blocked"}, observed outcome "${c.outcome}". Derived from the app's own sidebar gating.`,
        [`section ${c.section} (${c.sectionPath})`, `role ${c.role}`],
      ));
    }
  }
  return recs;
}

/** CRUD-journey findings: failed phase -> P0, skipped -> P1, console errors -> P2. */
function crudFindings(journeys) {
  const recs = [];
  if (!Array.isArray(journeys)) return recs;
  for (const j of journeys) {
    for (const p of j.phases ?? []) {
      if (p.status === "failed") {
        recs.push(rec("P0", "crud",
          `CRUD "${p.phase}" failed for ${j.entity}`,
          p.detail ?? "",
          [`entity ${j.entity} (${j.listPath})`],
        ));
      } else if (p.status === "skipped") {
        recs.push(rec("P1", "crud",
          `CRUD "${p.phase}" could not be exercised for ${j.entity}`,
          (p.detail ?? "").slice(0, 160) ||
            "The step was skipped — the form/flow may be non-standard.",
          [`entity ${j.entity} (${j.listPath})`],
        ));
      }
    }
    for (const e of j.pageErrors ?? []) {
      recs.push(rec("P0", "runtime",
        `Runtime error on the ${j.entity} create/edit form`,
        e.slice(0, 160),
        [`entity ${j.entity} (${j.listPath})`],
      ));
    }
    for (const e of j.consoleErrors ?? []) {
      recs.push(rec("P2", "console",
        `Console error on the ${j.entity} form`,
        e.slice(0, 160),
        [`entity ${j.entity} (${j.listPath})`],
      ));
    }
  }
  return recs;
}

/** UI/UX sweep findings: pageErrors -> P0, blank shell / RTL -> P1, console -> P2. */
function uiuxFindings(findings) {
  const recs = [];
  if (!Array.isArray(findings)) return recs;
  for (const f of findings) {
    if (f.pageErrors > 0) {
      recs.push(rec("P0", "runtime",
        `Uncaught runtime error on "${f.section}"`,
        `${f.pageErrors} uncaught error(s) while loading the screen.`,
        [`${f.section} (${f.path})`],
      ));
    }
    if (f.headingOk === false) {
      recs.push(rec("P1", "ux",
        `"${f.section}" renders no heading (possible blank shell)`,
        "The screen may be failing to render its content / hitting an error boundary.",
        [`${f.section} (${f.path})`],
      ));
    }
    if (f.rtlOk === false) {
      recs.push(rec("P1", "i18n",
        `RTL regression on "${f.section}" (ar variant did not flip dir)`,
        "The Arabic locale should render right-to-left; this screen did not.",
        [`${f.section} (${f.path})`],
      ));
    }
    if (f.consoleErrors > 0) {
      recs.push(rec("P2", "console",
        `Console error(s) on "${f.section}"`,
        `${f.consoleErrors} console error(s) — triage for library warnings vs real defects.`,
        [`${f.section} (${f.path})`],
      ));
    }
  }
  return recs;
}

/**
 * Synthesize the full recommendation set. Returns { generatedAt, counts, items }.
 * `items` is sorted P0 → P1 → P2, UAT-sourced before static within a tier.
 */
export function synthesizeRecommendations(root = ROOT) {
  const dir = path.join(root, "uat-results");
  const results = readJson(path.join(dir, "results.json"));
  const matrix = readJson(path.join(dir, "role-matrix.json"));
  const journeys = readJson(path.join(dir, "crud-journeys.json"));
  const uiux = readJson(path.join(dir, "uiux-findings.json"));

  const items = [
    ...failedSpecFindings(results),
    ...matrixFindings(matrix),
    ...crudFindings(journeys),
    ...uiuxFindings(uiux),
    ...staticFindings(root),
  ];

  const rank = { P0: 0, P1: 1, P2: 2 };
  items.sort((a, b) => {
    if (rank[a.priority] !== rank[b.priority])
      return rank[a.priority] - rank[b.priority];
    if (a.source !== b.source) return a.source === "uat" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const it of items) counts[it.priority]++;

  return { generatedAt: new Date().toISOString(), counts, items };
}

function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const report = synthesizeRecommendations();
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  const { P0, P1, P2 } = report.counts;
  console.log(
    `uat:recommend — wrote ${path.relative(ROOT, OUT_JSON)} ` +
      `(${report.items.length} recommendations: ${P0} P0, ${P1} P1, ${P2} P2).`,
  );
}

// Run as a script (not when imported by uat-pdf.mjs).
import { fileURLToPath } from "node:url";
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
