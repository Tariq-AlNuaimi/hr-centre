#!/usr/bin/env node
// scripts/run-evals.mjs (V2-eval)
//
// Tier-2 skill-routing eval: deterministic, no tokens, no network, zero new
// dependencies. Ported from Addy Osmani's agent-skills eval harness (MIT) and
// reimplemented against this repo's `.claude/skills/*/SKILL.md` catalog + a
// simpler `evals/cases/<skill>.json` shape (trigger-routing only -- no
// behavioral/Tier-3 evals here; this repo has no headless-claude fixture
// tier to run them against).
//
// What it checks:
//   1. Build a stemmed TF-IDF corpus from every skill's frontmatter
//      description (+ name tokens, weighted 2x) -- scripts/lib/skill-routing.mjs.
//   2. For each evals/cases/<skill>.json: positive prompts must rank their
//      skill within top_k (default 3); negative prompts must not outrank
//      the declared `owner` skill.
//   3. Report a rank-1 rate (share of positive prompts ranking their skill
//      FIRST, not merely top-k). `--min-rank1 <pct>` fails below the floor.
//   4. Collision check across the whole catalog: ERROR at >=0.75 pairwise
//      cosine similarity between two descriptions, WARN at >=0.50 (a WARN
//      never fails the build -- design-qa/design-system sit at ~59% by
//      design and must stay a warning, not a break).
//   5. A skill with no case file is a WARNING (not an error) -- new skills
//      can land mid-catalog before their cases are written in a follow-up.
//
// Exit 0 clean, non-zero on any ERROR-level failure.
//
// Usage:
//   node scripts/run-evals.mjs
//   node scripts/run-evals.mjs --min-rank1 70

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadSkills, buildCorpus, vec, cosine, rankSkills } from "./lib/skill-routing.mjs";

const ROOT = process.cwd();
const SKILLS_DIR = join(ROOT, ".claude", "skills");
const CASES_DIR = join(ROOT, "evals", "cases");

const COLLISION_WARN = 0.5; // cosine similarity between two descriptions
const COLLISION_ERROR = 0.75;

const MIN_POSITIVE = 3;
const MIN_NEGATIVE = 2;

function loadCases() {
  if (!existsSync(CASES_DIR)) return [];
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const raw = readFileSync(join(CASES_DIR, f), "utf8");
      try {
        return { file: f, data: JSON.parse(raw) };
      } catch (e) {
        return { file: f, parseError: e.message };
      }
    });
}

function parseArgs(argv) {
  const rankIdx = argv.indexOf("--min-rank1");
  let minRank1 = null;
  if (rankIdx !== -1) {
    const raw = argv[rankIdx + 1];
    minRank1 = Number(raw);
    if (
      raw === undefined ||
      raw === "" ||
      !Number.isFinite(minRank1) ||
      minRank1 < 0 ||
      minRank1 > 100
    ) {
      console.error("--min-rank1 must be a number from 0 to 100");
      process.exit(1);
    }
  }
  return { minRank1 };
}

function main() {
  const { minRank1 } = parseArgs(process.argv.slice(2));

  const skills = loadSkills(SKILLS_DIR);
  const cases = loadCases();
  const corpus = buildCorpus(skills);
  const skillNames = new Set(skills.map((s) => s.name));

  let errors = 0;
  let warnings = 0;
  let passed = 0;
  let rank1 = 0;
  let positives = 0;

  console.log(
    `Running skill-routing evals across ${skills.length} skills, ${cases.length} case files\n`,
  );

  // Coverage: a skill with no case file is a WARNING, not an error -- new
  // skills can land mid-catalog before their evals/cases entry follows.
  for (const s of skills) {
    if (!cases.some((c) => c.file === `${s.name}.json`)) {
      console.log(
        `  ⚠  ${s.name}: no eval case file (evals/cases/${s.name}.json) -- follow-up needed`,
      );
      warnings++;
    }
  }

  for (const c of cases) {
    if (c.parseError) {
      console.log(`  ✗  ${c.file}: invalid JSON -- ${c.parseError}`);
      errors++;
      continue;
    }
    const d = c.data;
    const expected = c.file.replace(/\.json$/, "");
    if (d.skill_name !== expected) {
      console.log(`  ✗  ${c.file}: skill_name "${d.skill_name}" does not match filename`);
      errors++;
    }
    if (!skillNames.has(expected)) {
      console.log(`  ✗  ${c.file}: no such skill directory (.claude/skills/${expected})`);
      errors++;
      continue;
    }

    // Trigger: positive -- must rank within top_k (default 3).
    for (const t of d.trigger?.positive || []) {
      positives++;
      const topK = t.top_k || 3;
      const ranking = rankSkills(t.prompt, corpus);
      const idx = ranking.findIndex((r) => r.name === expected);
      const hit = ranking[idx];
      if (idx === 0 && hit.score > 0) rank1++;
      if (idx >= 0 && idx < topK && hit.score > 0) {
        passed++;
      } else if (!hit || hit.score === 0) {
        console.log(
          `  ✗  ${expected}: description shares no vocabulary with a prompt users would say`,
        );
        console.log(`       "${t.prompt}"`);
        errors++;
      } else {
        const top = ranking.filter((r) => r.score > 0).slice(0, 3);
        console.log(`  ✗  ${expected}: positive prompt ranked #${idx + 1} (need top ${topK})`);
        console.log(`       "${t.prompt}"`);
        console.log(
          `       top 3: ${top.map((r) => `${r.name} (${r.score.toFixed(2)})`).join(", ")}`,
        );
        errors++;
      }
    }

    // Trigger: negative -- must not rank #1 (real, nonzero match), and the
    // declared owner must genuinely outrank this skill (pairwise routing
    // test, not a vacuous pass when the prompt matches nothing at all).
    for (const t of d.trigger?.negative || []) {
      const ranking = rankSkills(t.prompt, corpus);
      let ok = true;
      if (ranking[0].name === expected && ranking[0].score > 0) {
        console.log(`  ✗  ${expected}: ranked #1 for a negative prompt (over-broad description)`);
        console.log(`       "${t.prompt}"`);
        errors++;
        ok = false;
      }
      if (t.owner) {
        if (!skillNames.has(t.owner)) {
          console.log(`  ✗  ${c.file}: negative declares unknown owner "${t.owner}"`);
          errors++;
          ok = false;
        } else {
          const ownerIdx = ranking.findIndex((r) => r.name === t.owner);
          const selfIdx = ranking.findIndex((r) => r.name === expected);
          if (ranking[ownerIdx].score === 0 || ownerIdx > selfIdx) {
            console.log(
              `  ✗  ${expected}: declared owner ${t.owner} does not outrank it for negative prompt`,
            );
            console.log(
              `       "${t.prompt}" (owner #${ownerIdx + 1} @ ${ranking[ownerIdx].score.toFixed(2)}, self #${selfIdx + 1})`,
            );
            errors++;
            ok = false;
          }
        }
      }
      if (ok) passed++;
    }

    // Required minimums (evals/cases format: >=3 positive, >=2 negative).
    const pc = (d.trigger?.positive || []).length;
    const nc = (d.trigger?.negative || []).length;
    if (pc < MIN_POSITIVE || nc < MIN_NEGATIVE) {
      console.log(
        `  ✗  ${expected}: below required minimums (${pc} positive/${nc} negative; need ${MIN_POSITIVE}/${MIN_NEGATIVE})`,
      );
      errors++;
    }
  }

  // Collision check across the catalog -- ERROR at >=0.75 pairwise cosine
  // similarity, WARN at >=0.50 (a WARN never fails the build).
  const names = [...corpus.docs.keys()];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = vec(corpus.docs.get(names[i]), corpus.idf);
      const b = vec(corpus.docs.get(names[j]), corpus.idf);
      const sim = cosine(a, b);
      if (sim >= COLLISION_ERROR) {
        console.log(
          `  ✗  collision: ${names[i]} ↔ ${names[j]} descriptions ${(sim * 100).toFixed(0)}% similar`,
        );
        errors++;
      } else if (sim >= COLLISION_WARN) {
        console.log(
          `  ⚠  overlap: ${names[i]} ↔ ${names[j]} descriptions ${(sim * 100).toFixed(0)}% similar`,
        );
        warnings++;
      }
    }
  }

  const rank1Rate = positives ? (rank1 / positives) * 100 : 0;
  const rate = positives ? rank1Rate.toFixed(0) : "n/a";
  if (minRank1 !== null && (!positives || rank1Rate < minRank1)) {
    console.log(`  ✗  trigger rank-1 rate ${rate}% is below required ${minRank1}%`);
    errors++;
  }
  console.log(`\n${passed} checks passed -- ${errors} error(s), ${warnings} warning(s)`);
  console.log(
    `trigger rank-1 rate: ${rate}% (${rank1}/${positives} positive prompts rank their skill first)`,
  );
  console.log(errors ? "FAILED" : "PASSED");
  process.exit(errors ? 1 : 0);
}

main();
