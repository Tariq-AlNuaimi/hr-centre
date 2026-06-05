#!/usr/bin/env node
// uat-benchmark.mjs — P6 (Build E): peer + enterprise benchmark.
//
// P6 compares the app against (a) enterprise norms for its domain and (b) a
// handful of peer products. Unlike the other phases it needs WEB SEARCH, which
// is an agent capability, not a Node API — so the data is produced by the
// operator/agent during a `/uat full` run (see the skill) and written to
// uat-results/benchmark.json in the schema below. This module just LOADS +
// VALIDATES that file; scripts/uat-pdf.mjs renders it. When the file is absent
// (no web access, or a lean run), P6 is noted as skipped — it never fails a run.
//
// benchmark.json schema (all fields optional except where noted):
// {
//   "domain": "Internal admin tools / RBAC dashboards",   // required (string)
//   "generatedAt": "2026-06-05T...Z",
//   "summary": "one short paragraph",
//   "peers": [
//     { "name": "Retool",            // required
//       "url": "https://retool.com",
//       "positioning": "low-code internal tool builder",
//       "betterAtThanUs": ["drag-drop UI builder", "100+ data connectors"] }
//   ],
//   "enterpriseNorms": [
//     { "capability": "RBAC",                         // required
//       "norm": "granular roles + per-resource perms",
//       "appStatus": "present" | "partial" | "absent",  // required
//       "evidence": "Role enum + withAdminAuth wrappers",
//       "recommendation": "add per-resource permissions when needed" }
//   ]
// }
//
// Usage:
//   npm run uat:benchmark -- --check     validate uat-results/benchmark.json
//   npm run uat:benchmark -- --schema    print the JSON schema skeleton

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();

const VALID_STATUS = new Set(["present", "partial", "absent"]);

export function benchmarkPath(root = ROOT) {
  return path.join(root, "uat-results", "benchmark.json");
}

/** Load + lightly validate benchmark.json. Returns { data, errors } or null. */
export function loadBenchmark(root = ROOT) {
  const file = benchmarkPath(root);
  if (!fs.existsSync(file)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { data: null, errors: [`benchmark.json is not valid JSON: ${e.message}`] };
  }

  const errors = [];
  if (!data || typeof data !== "object")
    errors.push("benchmark.json must be a JSON object");
  if (!data?.domain || typeof data.domain !== "string")
    errors.push('benchmark.json needs a "domain" string');

  for (const [i, p] of (data?.peers ?? []).entries()) {
    if (!p?.name) errors.push(`peers[${i}] needs a "name"`);
  }
  for (const [i, n] of (data?.enterpriseNorms ?? []).entries()) {
    if (!n?.capability) errors.push(`enterpriseNorms[${i}] needs a "capability"`);
    if (n?.appStatus && !VALID_STATUS.has(n.appStatus))
      errors.push(
        `enterpriseNorms[${i}].appStatus "${n.appStatus}" must be present|partial|absent`,
      );
  }

  return { data, errors };
}

const SCHEMA_SKELETON = {
  domain: "<the app's domain, e.g. Internal admin tools / RBAC dashboards>",
  generatedAt: new Date().toISOString(),
  summary: "<one short paragraph: where the app stands vs the market>",
  peers: [
    {
      name: "<Peer product>",
      url: "<https://...>",
      positioning: "<one line>",
      betterAtThanUs: ["<capability they lead on>"],
    },
  ],
  enterpriseNorms: [
    {
      capability: "<e.g. RBAC>",
      norm: "<what enterprises expect>",
      appStatus: "present | partial | absent",
      evidence: "<file/feature that backs the status>",
      recommendation: "<what to add, if anything>",
    },
  ],
};

function main() {
  const arg = process.argv[2];
  if (arg === "--schema") {
    console.log(JSON.stringify(SCHEMA_SKELETON, null, 2));
    return;
  }
  // default + --check: validate the current file.
  const loaded = loadBenchmark();
  if (!loaded) {
    console.log(
      `uat:benchmark — no ${path.relative(ROOT, benchmarkPath())} yet. ` +
        `P6 will be noted as skipped. Run \`--schema\` to see the shape the ` +
        `agent fills via web search.`,
    );
    return;
  }
  if (loaded.errors.length) {
    console.error("uat:benchmark — benchmark.json has issues:");
    for (const e of loaded.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  const d = loaded.data;
  console.log(
    `uat:benchmark — OK. domain="${d.domain}", ` +
      `${(d.peers ?? []).length} peer(s), ` +
      `${(d.enterpriseNorms ?? []).length} enterprise norm(s).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
