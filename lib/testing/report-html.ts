/* eslint-disable rihal-template/no-raw-hex-color --
   This file is a STANDALONE PRINT DOCUMENT (the PDF report), not a themed React
   surface. It renders in a headless browser with its own self-contained CSS and has
   no access to the AntD theme tokens / dark mode that the rule enforces for the app
   UI. Severity/status colours are intentionally fixed print colours. (Same spirit as
   the context-free root not-found.tsx exemption.) */
// Vibe Inspector — standalone HTML report for PDF export (ADR-016).
// Pure string builder (no React) so it can render in the headless browser. All
// dynamic text is HTML-escaped — model output is untrusted.

import { dimensionLabel } from "./dimensions";
import { isSafePublicUrl } from "@/lib/validations/url-safety";
import type { TestDimension } from "@/generated/prisma/client";

export interface ReportFindingInput {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  detail: string;
  recommendation: string | null;
  evidence: string | null;
}
export interface ReportDimensionInput {
  dimension: string;
  score: number | null;
  status: "PASS" | "WARN" | "FAIL";
  summary: string;
  findings: ReportFindingInput[];
}
export interface ReportRequirementInput {
  requirement: string;
  status: "MET" | "PARTIAL" | "MISSING";
  evidence: string | null;
}
export interface ReportRunInput {
  overallScore: number | null;
  summary: string | null;
  finalUrl: string | null;
  createdAt: string | Date;
  assessment: { name: string; targetUrl: string } | null;
  dimensionResults: ReportDimensionInput[];
  requirements: ReportRequirementInput[];
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#cf1322",
  HIGH: "#d4380d",
  MEDIUM: "#d46b08",
  LOW: "#d4b106",
  INFO: "#096dd9",
};
const STATUS_COLOR: Record<string, string> = { PASS: "#389e0d", WARN: "#d48806", FAIL: "#cf1322" };
const COVERAGE_COLOR: Record<string, string> = { MET: "#389e0d", PARTIAL: "#d48806", MISSING: "#cf1322" };

function scoreColor(score: number | null): string {
  if (score == null) return "#8c8c8c";
  if (score >= 70) return "#389e0d";
  if (score >= 50) return "#d48806";
  return "#cf1322";
}

export function buildReportHtml(run: ReportRunInput): string {
  const name = run.assessment?.name ?? "Website audit";
  const url = run.finalUrl || run.assessment?.targetUrl || "";
  const date = new Date(run.createdAt).toLocaleString();
  const overall = run.overallScore ?? 0;

  const findingsRows = (findings: ReportFindingInput[]) =>
    findings.length === 0
      ? `<p class="muted">No findings for this dimension.</p>`
      : `<table class="findings">
          <thead><tr><th style="width:90px">Severity</th><th>Finding</th></tr></thead>
          <tbody>${findings
            .map(
              (f) => `<tr>
                <td><span class="tag" style="background:${SEV_COLOR[f.severity] ?? "#888"}">${esc(f.severity)}</span></td>
                <td>
                  <div class="f-title">${esc(f.title)}</div>
                  <div class="f-detail">${esc(f.detail)}</div>
                  ${f.recommendation ? `<div class="f-rec"><b>Recommendation:</b> ${esc(f.recommendation)}</div>` : ""}
                  ${f.evidence ? `<div class="f-ev"><b>Evidence:</b> ${esc(f.evidence)}</div>` : ""}
                </td>
              </tr>`
            )
            .join("")}</tbody>
        </table>`;

  const coverageBlock =
    run.requirements.length === 0
      ? ""
      : `<div class="coverage">
          <h4>Requirement coverage</h4>
          ${run.requirements
            .map(
              (r) => `<div class="req">
                <span class="tag" style="background:${COVERAGE_COLOR[r.status] ?? "#888"}">${esc(r.status)}</span>
                <span>${esc(r.requirement)}</span>
                ${r.evidence ? `<div class="req-ev">${esc(r.evidence)}</div>` : ""}
              </div>`
            )
            .join("")}
        </div>`;

  const dimensions = run.dimensionResults
    .map(
      (d) => `<section class="dim">
        <div class="dim-head">
          <h3>${esc(dimensionLabel(d.dimension as TestDimension))}</h3>
          <div>
            <span class="tag" style="background:${STATUS_COLOR[d.status] ?? "#888"}">${esc(d.status)}</span>
            <span class="tag" style="background:${scoreColor(d.score)}">${d.score ?? "-"}/100</span>
          </div>
        </div>
        <p class="summary">${esc(d.summary)}</p>
        ${d.dimension === "BRD_COVERAGE" ? coverageBlock : ""}
        ${findingsRows(d.findings)}
      </section>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} — Vibe Inspector report</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f1f1f; font-size: 12px; line-height: 1.5; margin: 0; }
    .header { border-bottom: 3px solid #1677ff; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; }
    .brand { font-size: 13px; color: #1677ff; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    h1 { font-size: 22px; margin: 4px 0 6px; }
    .meta { color: #595959; font-size: 11px; }
    .meta a { color: #1677ff; text-decoration: none; }
    .scorebox { text-align: center; min-width: 96px; }
    .scorebox .num { font-size: 34px; font-weight: 800; line-height: 1; }
    .scorebox .lbl { font-size: 10px; color: #8c8c8c; text-transform: uppercase; letter-spacing: .05em; }
    .intro { background: #f5f7fa; border: 1px solid #e8e8e8; border-radius: 6px; padding: 10px 12px; margin-bottom: 18px; }
    .dim { border: 1px solid #e8e8e8; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; page-break-inside: avoid; }
    .dim-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .dim-head h3 { margin: 0; font-size: 15px; }
    .tag { color: #fff; border-radius: 4px; padding: 1px 7px; font-size: 10px; font-weight: 700; margin-left: 4px; white-space: nowrap; }
    .summary { margin: 4px 0 10px; }
    table.findings { width: 100%; border-collapse: collapse; }
    table.findings th { text-align: left; font-size: 10px; color: #8c8c8c; text-transform: uppercase; border-bottom: 1px solid #eee; padding: 4px 6px; }
    table.findings td { border-bottom: 1px solid #f0f0f0; padding: 6px; vertical-align: top; }
    .f-title { font-weight: 700; }
    .f-detail { color: #333; }
    .f-rec, .f-ev { color: #595959; font-size: 11px; margin-top: 2px; }
    .coverage { margin: 6px 0 12px; }
    .coverage h4 { margin: 0 0 6px; font-size: 12px; }
    .req { margin-bottom: 5px; }
    .req-ev { color: #8c8c8c; font-size: 11px; margin-left: 4px; }
    .muted { color: #8c8c8c; font-style: italic; }
    .footer { margin-top: 18px; border-top: 1px solid #e8e8e8; padding-top: 8px; color: #8c8c8c; font-size: 10px; }
  </style></head>
  <body>
    <div class="header">
      <div>
        <div class="brand">Vibe Inspector</div>
        <h1>${esc(name)}</h1>
        <div class="meta">${
          url ? `${isSafePublicUrl(url) ? `<a href="${esc(url)}">${esc(url)}</a>` : esc(url)} · ` : ""
        }${esc(date)}</div>
      </div>
      <div class="scorebox">
        <div class="num" style="color:${scoreColor(run.overallScore)}">${overall}</div>
        <div class="lbl">Overall / 100</div>
      </div>
    </div>
    ${run.summary ? `<div class="intro">${esc(run.summary)}</div>` : ""}
    ${dimensions}
    <div class="footer">
      Generated by Vibe Inspector. Findings are AI-assisted and graded against the QA + OWASP methodology in this
      project's docs/uat-rubric.md and SECURITY.md. The security review is passive/observational — not a penetration test.
    </div>
  </body></html>`;
}
