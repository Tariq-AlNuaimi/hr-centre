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
import { synthesizeRecommendations } from "./uat-recommend.mjs";
import { loadBenchmark } from "./uat-benchmark.mjs";

const ROOT = process.cwd();
const RESULTS_DIR = path.join(ROOT, "uat-results");
const RESULTS_JSON = path.join(RESULTS_DIR, "results.json");
// P2 (Build B): the per-role permission matrix written by roles.full.uat.ts.
const MATRIX_JSON = path.join(RESULTS_DIR, "role-matrix.json");
// P3 (Build C): per-entity CRUD journeys written by crud.full.uat.ts.
const CRUD_JSON = path.join(RESULTS_DIR, "crud-journeys.json");
// P4 (Build C): per-section UI/UX findings written by uiux.full.uat.ts.
const UIUX_JSON = path.join(RESULTS_DIR, "uiux-findings.json");
const OUT_DIR = path.join(ROOT, "uat-report");
const OUT_PDF = path.join(OUT_DIR, "uat-report.pdf");
// A self-contained single-file HTML twin of the PDF (screenshots inlined as data
// URIs) — handy to browse/share without a PDF viewer, and the exact source the
// PDF is rendered from.
const OUT_HTML = path.join(OUT_DIR, "uat-report.html");

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

/**
 * P2 (Build B): build the permission-matrix HTML section from role-matrix.json
 * (written by roles.full.uat.ts). Rows = sections, columns = roles. Each cell
 * shows expected-vs-actual: ✓ = reached, — = blocked. A cell where actual differs
 * from expected is flagged (mismatch) so a regression is visible at a glance.
 *
 * Returns "" when there is no matrix (lean run, or full run that skipped the
 * matrix) so the section is simply omitted.
 */
function buildMatrixSection() {
  let cells;
  try {
    if (!fs.existsSync(MATRIX_JSON)) return "";
    cells = JSON.parse(fs.readFileSync(MATRIX_JSON, "utf8"));
  } catch {
    return "";
  }
  if (!Array.isArray(cells) || cells.length === 0) return "";

  // Stable axes derived from the data (never hardcoded).
  const roles = [...new Set(cells.map((c) => c.role))];
  // Sections in first-seen order, carrying their adminOnly flag + path.
  const sectionOrder = [];
  const sectionMeta = new Map();
  for (const c of cells) {
    if (!sectionMeta.has(c.section)) {
      sectionMeta.set(c.section, {
        adminOnly: c.adminOnly,
        path: c.sectionPath,
      });
      sectionOrder.push(c.section);
    }
  }

  const byKey = new Map(cells.map((c) => [`${c.role}::${c.section}`, c]));

  const headRoles = roles.map((r) => `<th class="rc">${esc(r)}</th>`).join("");

  const bodyRows = sectionOrder
    .map((section) => {
      const meta = sectionMeta.get(section);
      const tag = meta.adminOnly
        ? '<span class="tag admin">admin-only</span>'
        : '<span class="tag all">all roles</span>';
      const cellsHtml = roles
        .map((role) => {
          const c = byKey.get(`${role}::${section}`);
          if (!c) return '<td class="cell na">·</td>';
          // Expected glyph vs actual glyph.
          const reached = c.reached;
          const expected = c.expectedReach;
          const glyph = reached ? "✓" : "—";
          const cls = reached ? "reach" : "block";
          const mismatch = c.ok === false;
          const title = `expected ${expected ? "reach" : "blocked"}, ` +
            `actual ${c.outcome}`;
          return `<td class="cell ${cls}${mismatch ? " bad" : ""}" title="${esc(title)}">` +
            `${glyph}${mismatch ? '<span class="flag">!</span>' : ""}` +
            `<div class="oc">${esc(c.outcome)}</div></td>`;
        })
        .join("");
      return `<tr>
        <td class="sec"><b>${esc(section)}</b> ${tag}<div class="path">${esc(meta.path)}</div></td>
        ${cellsHtml}
      </tr>`;
    })
    .join("\n");

  const mismatches = cells.filter((c) => c.ok === false).length;
  const note = mismatches
    ? `<p class="mx-bad">${mismatches} cell(s) did not match the expected access derived from the app's sidebar gating.</p>`
    : `<p class="mx-ok">All role×section outcomes matched the access expected from the app's own gating.</p>`;

  return `<h2>Permission matrix (per role)</h2>
  <p class="meta">✓ = role reached the section · — = role was blocked (redirected / forbidden). Admin-only sections (GET API is <code>withAdminAuth</code>) should be reachable only by ADMIN.</p>
  ${note}
  <table class="matrix">
    <thead><tr><th>Section</th>${headRoles}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

/**
 * P3 (Build C): per-entity CRUD-journey section from crud-journeys.json (written
 * by crud.full.uat.ts). One row per entity, one pill per phase (create → confirm
 * → edit → delete). Returns "" when there were no journeys (lean run, or a
 * read-only fork) so the section is simply omitted.
 */
function buildCrudSection() {
  let journeys;
  try {
    if (!fs.existsSync(CRUD_JSON)) return "";
    journeys = JSON.parse(fs.readFileSync(CRUD_JSON, "utf8"));
  } catch {
    return "";
  }
  if (!Array.isArray(journeys) || journeys.length === 0) return "";

  const pill = (p) => {
    const cls =
      p.status === "passed" ? "pass" : p.status === "skipped" ? "skip" : "fail";
    return `<span class="phase ${cls}" title="${esc(p.detail ?? "")}">${esc(p.phase)}</span>`;
  };

  const rowsHtml = journeys
    .map((j) => {
      const phases = (j.phases ?? []).map(pill).join(" ");
      const anyFail = (j.phases ?? []).some((p) => p.status === "failed");
      const errs = [
        ...(j.pageErrors ?? []).map((e) => ({ kind: "runtime", text: e })),
        ...(j.consoleErrors ?? []).map((e) => ({ kind: "console", text: e })),
      ];
      const errHtml = errs.length
        ? `<details class="errs"><summary>${errs.length} error(s) seen during the journey</summary><ul>${errs
            .map(
              (e) =>
                `<li><span class="ek ${e.kind === "runtime" ? "bad" : "warn"}">${e.kind}</span> ${esc(e.text)}</li>`,
            )
            .join("")}</ul></details>`
        : "";
      return `<tr>
        <td><b>${esc(j.entity)}</b><div class="path">${esc(j.listPath)}</div></td>
        <td>${phases || "<i>no phases recorded</i>"}${errHtml}</td>
        <td class="${anyFail ? "j-bad" : "j-ok"}">${anyFail ? "needs attention" : "ok"}</td>
      </tr>`;
    })
    .join("\n");

  return `<h2>CRUD journeys (per entity)</h2>
  <p class="meta">Each entity discovered with a create form + record page is driven through create → confirm-in-list → edit → soft-delete. <span class="phase pass">green</span> passed · <span class="phase skip">amber</span> skipped (non-standard, not fatal) · <span class="phase fail">red</span> failed. Console/runtime errors seen on the (otherwise un-swept) create + edit forms are listed inline.</p>
  <table>
    <thead><tr><th>Entity</th><th>Phases</th><th>Result</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

/**
 * P4 (Build C): UI/UX-sweep section from uiux-findings.json (written by
 * uiux.full.uat.ts). One row per main section with runtime-error / heading /
 * RTL / console-error signals. Returns "" when there are no findings.
 */
function buildUiuxSection() {
  let findings;
  try {
    if (!fs.existsSync(UIUX_JSON)) return "";
    findings = JSON.parse(fs.readFileSync(UIUX_JSON, "utf8"));
  } catch {
    return "";
  }
  if (!Array.isArray(findings) || findings.length === 0) return "";

  const yn = (ok) =>
    ok
      ? '<span class="chip ok">✓</span>'
      : '<span class="chip bad">✗</span>';
  const num = (n, badWhenPositive) =>
    `<span class="chip ${badWhenPositive && n > 0 ? "bad" : n > 0 ? "warn" : "ok"}">${n}</span>`;

  const rowsHtml = findings
    .map((f) => {
      const notes = (f.notes ?? []).map((n) => esc(n)).join("<br>");
      return `<tr>
        <td><b>${esc(f.section)}</b><div class="path">${esc(f.path)}</div></td>
        <td>${num(f.pageErrors, true)}</td>
        <td>${yn(f.headingOk)}</td>
        <td>${yn(f.rtlOk)}</td>
        <td>${num(f.consoleErrors, false)}</td>
        <td class="notes">${notes || "—"}</td>
      </tr>`;
    })
    .join("\n");

  return `<h2>UI/UX sweep (per section)</h2>
  <p class="meta">Runtime errors gate the run; console errors are tallied (library dev-warnings are common). RTL checks the Arabic (<code>ar</code>) variant flips <code>dir="rtl"</code>.</p>
  <table>
    <thead><tr><th>Section</th><th>Runtime errors</th><th>Heading</th><th>RTL (ar)</th><th>Console errors</th><th>Notes</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

/**
 * P5 (Build D): logic + UX recommendations. Re-synthesizes from the current run
 * sinks (so the PDF always reflects the latest results) and renders a prioritized
 * P0/P1/P2 list with file:line evidence. Returns "" when there is nothing to
 * recommend (a clean run with no stub markers) — a green report needs no section.
 */
function buildRecommendationsSection() {
  let report;
  try {
    report = synthesizeRecommendations(ROOT);
  } catch {
    return "";
  }
  if (!report || !Array.isArray(report.items) || report.items.length === 0) {
    return "";
  }

  const tierMeta = {
    P0: { cls: "p0", label: "P0 — fix before sharing" },
    P1: { cls: "p1", label: "P1 — incomplete" },
    P2: { cls: "p2", label: "P2 — polish" },
  };

  const tiers = ["P0", "P1", "P2"]
    .map((tier) => {
      const items = report.items.filter((it) => it.priority === tier);
      if (items.length === 0) return "";
      const lis = items
        .map((it) => {
          const ev = (it.evidence ?? [])
            .map((e) => `<code>${esc(e)}</code>`)
            .join(" · ");
          const detail = it.detail
            ? `<div class="rec-detail">${esc(it.detail)}</div>`
            : "";
          return `<li>
            <div class="rec-title"><span class="src ${it.source}">${esc(it.source)}</span> ${esc(it.title)}</div>
            ${detail}
            ${ev ? `<div class="rec-ev">${ev}</div>` : ""}
          </li>`;
        })
        .join("\n");
      return `<h3 class="rec-h ${tierMeta[tier].cls}">${tierMeta[tier].label} <span class="rec-n">${items.length}</span></h3>
      <ul class="recs">${lis}</ul>`;
    })
    .join("\n");

  const { P0, P1, P2 } = report.counts;
  return `<h2>Logic + UX recommendations</h2>
  <p class="meta">Synthesized from this run's outcomes (failing flows, authorization mismatches, runtime/console errors) plus a static scan for stub markers. ${P0} P0 · ${P1} P1 · ${P2} P2.</p>
  ${tiers}`;
}

/**
 * P6 (Build E): peer + enterprise benchmark. Renders uat-results/benchmark.json
 * (produced by the agent via web search during a full run — see uat-benchmark.mjs
 * + the skill). When the file is absent we NOTE the skip in full mode (P6 never
 * fails a run); in lean mode the section is omitted entirely.
 */
function buildBenchmarkSection(mode) {
  // P6 is a full-mode phase only — never render it in a lean report.
  if (mode !== "full") return "";

  const loaded = loadBenchmark(ROOT);

  if (!loaded || !loaded.data) {
    const why = loaded?.errors?.length
      ? `benchmark.json present but invalid: ${esc(loaded.errors.join("; "))}`
      : "no <code>uat-results/benchmark.json</code> was produced (web search unavailable or skipped)";
    return `<h2>Peer + enterprise benchmark</h2>
    <p class="bench-skip">P6 skipped — ${why}. This phase compares the app against enterprise norms + peer products and needs web access; it never fails the run.</p>`;
  }

  const d = loaded.data;
  const statusChip = (s) => {
    const cls =
      s === "present" ? "ok" : s === "partial" ? "warn" : s === "absent" ? "bad" : "na";
    return `<span class="chip ${cls}">${esc(s ?? "—")}</span>`;
  };

  const norms = (d.enterpriseNorms ?? [])
    .map(
      (n) => `<tr>
        <td><b>${esc(n.capability)}</b></td>
        <td>${esc(n.norm ?? "—")}</td>
        <td>${statusChip(n.appStatus)}</td>
        <td>${esc(n.evidence ?? "—")}</td>
        <td class="notes">${esc(n.recommendation ?? "—")}</td>
      </tr>`,
    )
    .join("\n");

  const peers = (d.peers ?? [])
    .map((p) => {
      const better = (p.betterAtThanUs ?? []).map((x) => esc(x)).join(" · ");
      const name = p.url
        ? `<a href="${esc(p.url)}">${esc(p.name)}</a>`
        : `<b>${esc(p.name)}</b>`;
      return `<tr>
        <td>${name}</td>
        <td>${esc(p.positioning ?? "—")}</td>
        <td class="notes">${better || "—"}</td>
      </tr>`;
    })
    .join("\n");

  const normsTable = norms
    ? `<h3 class="rec-h p2">Enterprise norms</h3>
      <table>
        <thead><tr><th>Capability</th><th>Norm</th><th>Our status</th><th>Evidence</th><th>Recommendation</th></tr></thead>
        <tbody>${norms}</tbody>
      </table>`
    : "";
  const peersTable = peers
    ? `<h3 class="rec-h p2">Peer products</h3>
      <table>
        <thead><tr><th>Product</th><th>Positioning</th><th>Leads us on</th></tr></thead>
        <tbody>${peers}</tbody>
      </table>`
    : "";

  return `<h2>Peer + enterprise benchmark</h2>
  <p class="meta"><b>Domain:</b> ${esc(d.domain)}${d.generatedAt ? ` · sourced ${esc(String(d.generatedAt).slice(0, 10))}` : ""}</p>
  ${d.summary ? `<p class="bench-summary">${esc(d.summary)}</p>` : ""}
  ${normsTable}
  ${peersTable}`;
}

function buildHtml(report, rows) {
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
  /* P2 permission matrix */
  table.matrix td, table.matrix th { text-align: center; }
  table.matrix td.sec { text-align: left; }
  table.matrix th.rc { font-size: 11px; color: #1f1f1f; }
  .matrix .sec .path { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: #999; margin-top: 2px; }
  .matrix .tag { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-inline-start: 6px; }
  .matrix .tag.admin { background: #fff7e6; color: #ad6800; }
  .matrix .tag.all { background: #e6f4ff; color: #0958d9; }
  .matrix td.cell { font-size: 15px; font-weight: 700; position: relative; }
  .matrix td.cell.reach { background: #f6ffed; color: #237804; }
  .matrix td.cell.block { background: #fafafa; color: #8c8c8c; }
  .matrix td.cell.bad { outline: 2px solid #cf1322; outline-offset: -2px; }
  .matrix td.cell.na { color: #ccc; }
  .matrix td.cell .oc { font-size: 9px; font-weight: 500; color: #999; margin-top: 1px; }
  .matrix td.cell .flag { color: #cf1322; font-size: 11px; vertical-align: super; }
  .mx-ok { color: #389e0d; font-size: 12px; }
  .mx-bad { color: #cf1322; font-weight: 600; font-size: 12px; }
  .path { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: #999; margin-top: 2px; }
  /* P3 CRUD journeys */
  .phase { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; margin: 0 3px 3px 0; }
  .phase.pass { background: #d9f7be; color: #237804; }
  .phase.skip { background: #fff1b8; color: #ad6800; }
  .phase.fail { background: #ffccc7; color: #a8071a; }
  td.j-ok { color: #389e0d; font-weight: 600; }
  td.j-bad { color: #cf1322; font-weight: 700; }
  .errs { margin-top: 6px; }
  .errs summary { font-size: 10px; color: #ad6800; cursor: pointer; }
  .errs ul { margin: 4px 0 0; padding-inline-start: 16px; }
  .errs li { font-size: 10px; color: #555; margin-bottom: 2px; }
  .ek { display: inline-block; font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 0 5px; border-radius: 8px; margin-inline-end: 4px; }
  .ek.bad { background: #fff1f0; color: #cf1322; }
  .ek.warn { background: #fff7e6; color: #ad6800; }
  /* P4 UI/UX sweep */
  .chip { display: inline-block; min-width: 18px; text-align: center; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 10px; }
  .chip.ok { background: #f6ffed; color: #237804; }
  .chip.warn { background: #fff7e6; color: #ad6800; }
  .chip.bad { background: #fff1f0; color: #cf1322; }
  td.notes { font-size: 10px; color: #8c4b00; }
  /* P5 recommendations */
  .rec-h { font-size: 13px; margin: 16px 0 6px; padding: 4px 10px; border-radius: 4px; display: inline-block; }
  .rec-h .rec-n { font-weight: 400; opacity: 0.7; }
  .rec-h.p0 { background: #fff1f0; color: #a8071a; }
  .rec-h.p1 { background: #fff7e6; color: #ad6800; }
  .rec-h.p2 { background: #f0f5ff; color: #1d39c4; }
  ul.recs { list-style: none; margin: 0 0 8px; padding: 0; }
  ul.recs li { border-inline-start: 3px solid #eee; padding: 4px 0 4px 10px; margin-bottom: 8px; page-break-inside: avoid; }
  .rec-title { font-size: 12px; font-weight: 600; }
  .rec-detail { font-size: 11px; color: #555; margin-top: 2px; }
  .rec-ev { font-size: 10px; color: #888; margin-top: 3px; }
  .rec-ev code, .rec-title code { background: #f5f5f5; padding: 0 4px; border-radius: 3px; }
  .src { display: inline-block; font-size: 8px; font-weight: 700; text-transform: uppercase; padding: 0 5px; border-radius: 8px; margin-inline-end: 5px; vertical-align: middle; }
  .src.uat { background: #e6f4ff; color: #0958d9; }
  .src.static { background: #f9f0ff; color: #722ed1; }
  /* P6 benchmark */
  .bench-skip { color: #ad6800; background: #fffbe6; border: 1px solid #ffe58f; padding: 8px 12px; border-radius: 6px; font-size: 12px; }
  .bench-summary { font-size: 12px; color: #333; background: #fafafa; padding: 8px 12px; border-radius: 6px; }
  .chip.na { background: #f0f0f0; color: #999; }
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

  <!-- P2 (Build B): permission-matrix table. Omitted when there is no matrix. -->
  ${buildMatrixSection()}
  <!-- P3 (Build C): per-entity CRUD journey results. Omitted when none ran. -->
  ${buildCrudSection()}
  <!-- P4 (Build C): per-section UI/UX sweep. Omitted when none ran. -->
  ${buildUiuxSection()}

  <!-- P5 (Build D): logic + UX recommendations (P0/P1/P2). Omitted when clean. -->
  ${buildRecommendationsSection()}
  <!-- P6 (Build E): peer + enterprise benchmark. Skipped-note in full, omitted in lean. -->
  ${buildBenchmarkSection(mode)}

  <h2>Screenshots</h2>
  ${shotSections || `<p class="empty">No screenshots were attached in this run.</p>`}
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

  // Write the self-contained HTML twin first (so it exists even if the headless
  // Chromium render below is unavailable on this machine).
  fs.writeFileSync(OUT_HTML, html);

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
      `+ ${path.relative(ROOT, OUT_HTML)} ` +
      `(${rows.length} specs, ${rows.filter((r) => r.status === "passed").length} passed).`,
  );
}

main().catch((err) => {
  console.error(`uat:pdf — failed: ${err?.stack ?? err}`);
  process.exitCode = 1;
});
