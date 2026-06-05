#!/usr/bin/env node
// uat-pdf.mjs — assemble a single PDF report from the last UAT run.
//
// Reads the Playwright JSON reporter output (uat-results/results.json) plus the
// screenshots it attached (under uat-results/), builds one summary HTML page
// (title + run metadata + a pass/fail table per spec + every screenshot inline
// with its step name), and renders it to uat-report/uat-report.pdf using the
// Chromium that ships with @playwright/test — NO new dependencies.
//
// Usage:  npm run uat:pdf   (after `npm run uat` / `npm run uat:full`)
//
// Honors PLAYWRIGHT_BROWSERS_PATH (e.g. /opt/pw-browsers in CI / web sessions).
// Degrades gracefully when there are no results yet.
//
// FUTURE (Builds B–E): Full mode adds report sections here —
//   - P2 permission-matrix table        (TODO: inject after the summary table)
//   - P3 per-entity CRUD journey results (TODO: one sub-section per entity)
//   - P5 logic + UX recommendations      (TODO: prioritized P0/P1/P2 list)
//   - P6 peer + enterprise benchmark      (TODO: comparison tables, web-sourced)
// Each is marked with a `TODO(P#)` anchor below so future builds slot in cleanly.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const RESULTS_DIR = path.join(ROOT, "uat-results");
const RESULTS_JSON = path.join(RESULTS_DIR, "results.json");
const OUT_DIR = path.join(ROOT, "uat-report");
const OUT_PDF = path.join(OUT_DIR, "uat-report.pdf");

const __filename = fileURLToPath(import.meta.url);

/** Minimal HTML escaper for text injected into the report. */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Flatten the Playwright JSON report (nested suites -> specs -> tests -> results)
 * into a flat list of spec rows with an aggregated status, plus the screenshot
 * attachments found on each test result.
 */
function flatten(report) {
  const rows = [];

  const visitSuite = (suite, fileHint) => {
    const file = suite.file ?? fileHint;
    for (const spec of suite.specs ?? []) {
      // A spec's status: ok if every contained test passed/skipped/flaky-ok.
      let status = spec.ok ? "passed" : "failed";
      const attachments = [];
      let duration = 0;
      for (const t of spec.tests ?? []) {
        for (const r of t.results ?? []) {
          duration += r.duration ?? 0;
          if (r.status && r.status !== "passed" && r.status !== "skipped") {
            // surface the most interesting status
            if (status === "passed") status = r.status;
          }
          for (const a of r.attachments ?? []) {
            if (a.contentType?.startsWith("image/") && a.path) {
              attachments.push({ name: a.name ?? "screenshot", path: a.path });
            }
          }
        }
      }
      rows.push({
        title: spec.title,
        file: spec.file ?? file,
        status,
        duration,
        attachments,
      });
    }
    for (const child of suite.suites ?? []) visitSuite(child, file);
  };

  for (const suite of report.suites ?? []) visitSuite(suite, suite.file);
  return rows;
}

/** Inline a screenshot as a data URI so the PDF is self-contained. */
function imgDataUri(absOrRel) {
  try {
    const p = path.isAbsolute(absOrRel) ? absOrRel : path.join(ROOT, absOrRel);
    if (!fs.existsSync(p)) return null;
    const b64 = fs.readFileSync(p).toString("base64");
    return `data:image/png;base64,${b64}`;
  } catch {
    return null;
  }
}

function buildHtml(report, rows) {
  const meta = report.stats ?? report.config?.metadata ?? {};
  const startTime =
    report.stats?.startTime ?? report.config?.metadata?.startTime ?? null;
  const total = rows.length;
  const passed = rows.filter((r) => r.status === "passed").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const other = total - passed - failed;
  const mode = process.env.UAT_MODE ?? "lean";
  const baseURL =
    report.config?.projects?.[0]?.use?.baseURL ??
    process.env.UAT_BASE_URL ??
    "(local)";

  const summaryRows = rows
    .map((r) => {
      const badge =
        r.status === "passed"
          ? '<span class="b pass">PASS</span>'
          : r.status === "failed"
            ? '<span class="b fail">FAIL</span>'
            : `<span class="b skip">${esc(r.status.toUpperCase())}</span>`;
      return `<tr>
        <td>${badge}</td>
        <td>${esc(r.title)}</td>
        <td class="mono">${esc(r.file ?? "")}</td>
        <td class="num">${Math.round(r.duration)} ms</td>
      </tr>`;
    })
    .join("\n");

  // Screenshots, grouped per spec, inline with their step name.
  const shotSections = rows
    .map((r) => {
      if (!r.attachments.length) return "";
      const imgs = r.attachments
        .map((a) => {
          const uri = imgDataUri(a.path);
          if (!uri) return "";
          return `<figure>
            <img src="${uri}" />
            <figcaption>${esc(a.name)}</figcaption>
          </figure>`;
        })
        .filter(Boolean)
        .join("\n");
      if (!imgs) return "";
      return `<section class="shots">
        <h3>${esc(r.title)}</h3>
        ${imgs}
      </section>`;
    })
    .filter(Boolean)
    .join("\n");

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system, system-ui, sans-serif; color: #1f1f1f; margin: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 10px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 18px 0 8px; color: #444; }
  .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
  .meta b { color: #1f1f1f; }
  .tally { display: flex; gap: 12px; margin: 12px 0 4px; }
  .tally div { padding: 8px 14px; border-radius: 8px; font-weight: 600; }
  .t-pass { background: #f6ffed; color: #389e0d; }
  .t-fail { background: #fff1f0; color: #cf1322; }
  .t-other { background: #f5f5f5; color: #595959; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  th { color: #888; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
  td.num, td.mono { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #666; }
  td.num { text-align: right; white-space: nowrap; }
  .b { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; }
  .b.pass { background: #d9f7be; color: #237804; }
  .b.fail { background: #ffccc7; color: #a8071a; }
  .b.skip { background: #e6e6e6; color: #595959; }
  .shots figure { margin: 0 0 18px; page-break-inside: avoid; }
  .shots img { max-width: 100%; border: 1px solid #ddd; border-radius: 6px; }
  .shots figcaption { font-size: 11px; color: #888; margin-top: 4px; }
  .empty { color: #999; font-style: italic; }
</style></head>
<body>
  <h1>UAT Report</h1>
  <div class="meta">
    <b>Mode:</b> ${esc(mode)} &nbsp;·&nbsp;
    <b>Target:</b> ${esc(baseURL)} &nbsp;·&nbsp;
    <b>Run:</b> ${esc(startTime ? new Date(startTime).toISOString() : new Date().toISOString())} &nbsp;·&nbsp;
    <b>Generated:</b> ${esc(new Date().toISOString())}
  </div>

  <div class="tally">
    <div class="t-pass">${passed} passed</div>
    <div class="t-fail">${failed} failed</div>
    ${other ? `<div class="t-other">${other} other</div>` : ""}
  </div>

  <h2>Results by spec</h2>
  ${
    total
      ? `<table>
    <thead><tr><th>Status</th><th>Spec</th><th>File</th><th>Duration</th></tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>`
      : `<p class="empty">No spec results in this run.</p>`
  }

  <!-- TODO(P2): permission-matrix table injected here (Build B). -->
  <!-- TODO(P3): per-entity CRUD journey results injected here (Build C). -->

  <h2>Screenshots</h2>
  ${shotSections || `<p class="empty">No screenshots were attached in this run.</p>`}

  <!-- TODO(P5): logic + UX recommendations (P0/P1/P2) injected here (Build D). -->
  <!-- TODO(P6): peer + enterprise benchmark comparison injected here (Build E). -->
</body></html>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let report = null;
  if (fs.existsSync(RESULTS_JSON)) {
    try {
      report = JSON.parse(fs.readFileSync(RESULTS_JSON, "utf8"));
    } catch (err) {
      console.error(`uat:pdf — could not parse ${RESULTS_JSON}: ${err.message}`);
    }
  }

  if (!report) {
    // Graceful "no results yet" — still emit a placeholder PDF so the path exists.
    console.warn(
      `uat:pdf — no results at ${path.relative(ROOT, RESULTS_JSON)}. ` +
        `Run \`npm run uat\` (or \`npm run uat:full\`) first.`,
    );
    report = { suites: [], stats: {} };
  }

  const rows = flatten(report);
  const html = buildHtml(report, rows);

  // Render with the Chromium bundled in @playwright/test — no extra deps.
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    ({ chromium } = await import("playwright"));
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.pdf({ path: OUT_PDF, format: "A4", printBackground: true });
  } finally {
    await browser.close();
  }

  console.log(
    `uat:pdf — wrote ${path.relative(ROOT, OUT_PDF)} ` +
      `(${rows.length} specs, ${rows.filter((r) => r.status === "passed").length} passed).`,
  );
}

main().catch((err) => {
  console.error(`uat:pdf — failed: ${err?.stack ?? err}`);
  process.exitCode = 1;
});
