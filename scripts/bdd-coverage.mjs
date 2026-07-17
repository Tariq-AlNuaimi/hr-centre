#!/usr/bin/env node
// scripts/bdd-coverage.mjs — story→scenario→step traceability gate (V2-207, ADR-058).
//
// The owned half of the BDD adoption: playwright-bdd EXECUTES `.feature` files; THIS
// script VERIFIES coverage, with a dependency-free, unit-tested core. It reds when the
// machine-checkable coverage contract breaks:
//   1. a `.feature` scenario has no `@US<n>` tag                     (untraceable scenario)
//   2. a scenario's `@US<n>` names no story in any blueprint         (dangling tag)
//   3. a scenario has zero steps                                     (empty = not a test)
//   4. a step has no matching step definition                        (UNIMPLEMENTED — the
//                                                                      "delete a step def → red" case)
//   5. a blueprint that opted into BDD (`BDD:` marker) has a `US<n>`  (story without a scenario)
//      story with no `@US<n>` scenario
//
// Dormant by design: no `tests/features/*.feature` → exit 0. Wired as a `/ship --full`
// gate (V2-401, Phase 4); NOT in warm `/ship`. Run directly: `npm run bdd-coverage`.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Parse one `.feature` file into { file, scenarios: [{ name, line, tags, steps }] }. */
export function parseFeature(text, file = "<feature>") {
  const scenarios = [];
  let pendingTags = [];
  let current = null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("@")) {
      pendingTags.push(
        ...line
          .split(/\s+/)
          .filter((t) => t.startsWith("@"))
          .map((t) => t.slice(1)),
      );
      continue;
    }
    const scen = /^Scenario(?:\s+Outline)?:\s*(.*)$/i.exec(line);
    if (scen) {
      current = { name: scen[1].trim(), line: i + 1, tags: pendingTags, steps: [] };
      scenarios.push(current);
      pendingTags = [];
      continue;
    }
    const step = /^(Given|When|Then|And|But|\*)\s+(.*)$/i.exec(line);
    if (step && current) {
      current.steps.push({ keyword: step[1], text: step[2].trim() });
      continue;
    }
    // Feature:, Background:, Examples:, table rows, etc. reset stray tags but don't error here.
    if (/^(Feature|Background|Examples|Rule):/i.test(line)) pendingTags = [];
  }
  const usTags = (s) => s.tags.filter((t) => /^US\d+$/i.test(t));
  return { file, scenarios, usTagsOf: usTags };
}

/** Convert a step-definition pattern string to an anchored RegExp (cucumber-expression subset). */
export function stepPatternToRe(pattern) {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex metachars (not our {…} placeholders)
    .replace(/\\\{(?:int|float|word|string)\\\}/g, "(.+?)") // {int}/{string}/… → capture
    .replace(/\\\{\\\}/g, "(.+?)");
  return new RegExp(`^${esc}$`);
}

/** Extract step-definition matchers from step-definition source (Given/When/Then/Step calls). */
export function parseStepDefs(text) {
  const out = [];
  // string patterns: Given('...'), When("..."), Then(`...`), Step('...')
  for (const m of text.matchAll(/\b(?:Given|When|Then|And|But|Step)\s*\(\s*(['"`])([\s\S]*?)\1/g))
    out.push({ raw: m[2], re: stepPatternToRe(m[2]) });
  // regex patterns: Given(/.../)
  for (const m of text.matchAll(
    /\b(?:Given|When|Then|And|But|Step)\s*\(\s*\/([\s\S]*?)\/([a-z]*)\s*[,)]/g,
  )) {
    try {
      out.push({ raw: `/${m[1]}/`, re: new RegExp(m[1], m[2].replace(/[gy]/g, "")) });
    } catch {
      /* skip an unparseable regex literal */
    }
  }
  return out;
}

/** Does any step definition match this step text? */
export function stepMatches(stepText, defs) {
  return defs.some((d) => d.re.test(stepText));
}

/**
 * Pure coverage check.
 * @param {Array} features - parseFeature() results.
 * @param {Array} defs - parseStepDefs() results (flattened across step files).
 * @param {Set<string>} allStories - every US id declared in any blueprint (upper-case).
 * @param {Set<string>} requiredStories - US ids whose blueprint opted into BDD (must have a scenario).
 * @returns {string[]} error messages (empty = clean).
 */
export function checkBddCoverage(features, defs, allStories, requiredStories) {
  const errors = [];
  const covered = new Set();
  for (const f of features) {
    for (const s of f.scenarios) {
      const us = s.tags.filter((t) => /^US\d+$/i.test(t)).map((t) => t.toUpperCase());
      const where = `${f.file}:${s.line} "${s.name}"`;
      if (us.length === 0) errors.push(`${where} — scenario has no @US<n> tag (untraceable)`);
      for (const u of us) {
        covered.add(u);
        if (!allStories.has(u)) errors.push(`${where} — @${u} names no story in any blueprint`);
      }
      if (s.steps.length === 0)
        errors.push(`${where} — scenario has no steps (empty is not a test)`);
      for (const st of s.steps)
        if (!stepMatches(st.text, defs))
          errors.push(`${where} — step "${st.keyword} ${st.text}" has no matching step definition`);
    }
  }
  for (const u of requiredStories)
    if (!covered.has(u)) errors.push(`story ${u} has no @${u} scenario (BDD-opted blueprint)`);
  return errors;
}

// ── CLI I/O ────────────────────────────────────────────────────────────────────
function listFiles(dir, test) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, test));
    else if (test(name)) out.push(p);
  }
  return out;
}

/** All US ids declared in blueprints, and the subset required (blueprint has a `BDD:` marker). */
function scanBlueprintStories(root) {
  const all = new Set();
  const required = new Set();
  const dir = join(root, "docs/blueprints");
  if (!existsSync(dir)) return { all, required };
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    let text = "";
    try {
      text = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    const ids = [...text.matchAll(/\*\*(US\d+)\*\*/g)].map((m) => m[1].toUpperCase());
    ids.forEach((id) => all.add(id));
    if (/^\s*BDD:\s*\S/im.test(text)) ids.forEach((id) => required.add(id));
  }
  return { all, required };
}

function main() {
  const featureFiles = listFiles(join(ROOT, "tests/features"), (n) => n.endsWith(".feature"));
  if (featureFiles.length === 0) {
    process.stdout.write("[bdd-coverage] dormant — no tests/features/*.feature yet (exit 0).\n");
    return;
  }
  const features = featureFiles.map((p) =>
    parseFeature(readFileSync(p, "utf8"), p.replace(`${ROOT}/`, "")),
  );
  const defFiles = listFiles(join(ROOT, "tests/features"), (n) => /\.(ts|mjs|js)$/.test(n));
  const defs = defFiles.flatMap((p) => parseStepDefs(readFileSync(p, "utf8")));
  const { all, required } = scanBlueprintStories(ROOT);
  const errors = checkBddCoverage(features, defs, all, required);
  if (errors.length === 0) {
    process.stdout.write(
      `[bdd-coverage] OK — ${features.reduce((n, f) => n + f.scenarios.length, 0)} scenario(s) ` +
        `across ${featureFiles.length} feature file(s), ${required.size} required story(ies) covered.\n`,
    );
    return;
  }
  process.stderr.write("[bdd-coverage] RED — traceability gaps:\n");
  for (const e of errors) process.stderr.write(`  • ${e}\n`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
