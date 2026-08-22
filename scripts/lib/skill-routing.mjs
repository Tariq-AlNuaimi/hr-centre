// scripts/lib/skill-routing.mjs (V2-eval)
//
// Deterministic Tier-2 skill-routing pipeline, ported from Addy Osmani's
// agent-skills eval harness (MIT) and reimplemented against this repo's
// `.claude/skills/*/SKILL.md` catalog.
//
// A stemmed TF-IDF bag-of-words over each skill's frontmatter `description`,
// with the skill's own name tokens folded into that same document at 2x
// weight so a prompt that names the skill directly ("run /ship") still
// scores well even when the description text doesn't repeat that word.
// Cosine similarity between a prompt vector and each skill's document vector
// gives a ranking; the same corpus vectors also drive the catalog-wide
// collision check (two descriptions that read as near-duplicates).
//
// No network, no tokens, no dependencies -- Node built-ins only, mirroring
// scripts/skill-standard-check.mjs.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------- tiny text pipeline (ported faithfully) ----------

const STOP = new Set([
  "a",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "before",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "its",
  "my",
  "need",
  "needs",
  "of",
  "on",
  "or",
  "our",
  "so",
  "that",
  "the",
  "them",
  "this",
  "to",
  "use",
  "want",
  "we",
  "when",
  "with",
  "you",
  "your",
  "help",
  "me",
  "i",
]);

export function stem(t) {
  // Light suffix stripping so "conflicts"/"conflict", "branching"/"branch",
  // "architectural"/"architecture" cluster together. Not a real stemmer.
  for (const suf of ["ally", "ing", "ed", "es", "al"]) {
    if (t.length > suf.length + 3 && t.endsWith(suf)) {
      t = t.slice(0, -suf.length);
      break;
    }
  }
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  if (t.length > 4 && t.endsWith("e")) t = t.slice(0, -1);
  // Collapse doubled trailing consonant left by -ing/-ed ("committ" -> "commit").
  if (t.length > 4 && t[t.length - 1] === t[t.length - 2] && !"aeiou".includes(t[t.length - 1])) {
    t = t.slice(0, -1);
  }
  // Normalize trailing y so "simplify" and "simplifies"/"simplified" cluster.
  if (t.length > 3 && t.endsWith("y")) t = t.slice(0, -1) + "i";
  return t;
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map(stem);
}

export function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

export function buildCorpus(skills) {
  // Document per skill: name tokens (weighted 2x) + description tokens.
  const docs = new Map();
  for (const s of skills) {
    const nameTokens = tokenize(s.name.replace(/-/g, " "));
    const tokens = [...nameTokens, ...nameTokens, ...tokenize(s.description)];
    docs.set(s.name, termFreq(tokens));
  }
  const df = new Map();
  for (const tf of docs.values()) {
    for (const term of tf.keys()) df.set(term, (df.get(term) || 0) + 1);
  }
  const n = docs.size;
  const idf = (term) => Math.log(1 + n / (1 + (df.get(term) || 0)));
  return { docs, idf };
}

export function vec(tf, idf) {
  const v = new Map();
  for (const [term, f] of tf) v.set(term, f * idf(term));
  return v;
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [t, w] of a) {
    na += w * w;
    const bw = b.get(t);
    if (bw) dot += w * bw;
  }
  for (const w of b.values()) nb += w * w;
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function rankSkills(prompt, corpus) {
  const pv = vec(termFreq(tokenize(prompt)), corpus.idf);
  const scores = [];
  for (const [name, tf] of corpus.docs) {
    scores.push({ name, score: cosine(pv, vec(tf, corpus.idf)) });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

// ---------- loading the live skill catalog ----------

/** Read every skill's `SKILL.md` frontmatter (name, description) under skillsDir. */
export function loadSkills(skillsDir, { skipped } = {}) {
  // `skipped` (optional array) collects a reason per unreadable skill. Silently dropping
  // a malformed skill matters more now that `evals` runs in the WARM loop while
  // `skill-check` used to run only in ship:full: the skill would vanish from the corpus
  // and surface only as a lowered rank-1 rate, never named. Degrading measurably beats
  // degrading silently, but naming the cause beats both.
  const note = (name, why) => {
    if (Array.isArray(skipped)) skipped.push(`${name}: ${why}`);
  };
  const skills = [];
  if (!existsSync(skillsDir)) return skills;
  for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = join(skillsDir, dir.name, "SKILL.md");
    if (!existsSync(file)) continue;
    const src = readFileSync(file, "utf8");
    const m = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!m) {
      note(dir.name, "no parseable YAML frontmatter block");
      continue;
    }
    const name = (m[1].match(/^name:\s*(.+)$/m) || [])[1];
    const description = (m[1].match(/^description:\s*(.+)$/m) || [])[1];
    if (name && description) {
      skills.push({ name: name.trim(), description: description.trim() });
    } else {
      note(dir.name, `frontmatter missing ${!name ? "name" : "description"}`);
    }
  }
  return skills;
}
