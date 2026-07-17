#!/usr/bin/env node
// scripts/copy-check.mjs — the copy lint half of the copy chokepoint (V2-305).
//
// The JSX-literal ESLint rule (no-literal-jsx-text) forces every user-facing string
// THROUGH next-intl — so `messages/*.json` becomes the single place copy lives. This
// checker is the quality gate ON that chokepoint: it holds the source-locale copy to a
// small, deterministic house style so a considered voice can't drift string-by-string as
// the app grows. It is the copy sibling of the design-token rules (no-raw-hex-color for
// color, no-arbitrary-className for spacing/type): color/spacing/type come from a scale,
// and short UI copy comes from a house style.
//
// Deterministic, low-false-positive checks on SHORT label/button strings (a value of
// ≤ labelMaxWords words — longer values are sentences and are left alone except for
// terminology):
//   1. trailing-period — a label must not end in a lone `.` (buttons/labels take no full
//      stop). An ellipsis (`...` / `…`, a progress/placeholder affordance) and `?`/`!`
//      are allowed.
//   2. sentence-case — a label uses sentence case, not Title Case: only the first word
//      (and allowlisted proper nouns / ALL-CAPS acronyms) may be Capitalized. Catches
//      "Back Home", "Change Password", "Create User".
//   3. terminology — a configurable banned→preferred map (default: a couple of safe
//      normalizations), matched case-insensitively at word boundaries on ALL values.
//
// Scope: the checker runs on the LATIN-script locales (case-sensitive checks only make
// sense there); Arabic/RTL locales have no letter case, so title-case never applies. By
// default it checks the fork's `defaultLocale` (the copy source of truth); translations
// are QA'd separately. Config + waivers live in project.config.json `copy` (a fork tunes
// proper nouns / terminology / per-key waivers without editing this file).
//
// Imperative button verbs + a full terminology glossary are a MANUAL reviewer item in the
// copy chokepoint (docs/design-recipes.md) — they need judgement a regex would fake with
// false positives, so they are deliberately NOT auto-gated here.
//
// Usage:  node scripts/copy-check.mjs            # gate the configured locales
//         node scripts/copy-check.mjs --json     # machine-readable findings
// ship.mjs imports { runCopyCheck } and runs it as the phase-A `copy` gate.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// --- defaults (a fork overrides/extends via project.config.json `copy`) --------------
const DEFAULT_PROPER_NOUNS = [
  // Brand / product tokens and unavoidable proper nouns in the baseline copy.
  "App",
  "Microsoft",
  // Acronyms are matched by the ALL-CAPS test too, but naming them documents intent.
  "ID",
  "SSO",
  "OK",
  "API",
  "URL",
];
// Banned → preferred. Kept intentionally tiny and non-controversial; a fork extends it.
const DEFAULT_TERMINOLOGY = [
  { term: "e-mail", preferred: "email" },
  { term: "Okay", preferred: "OK" },
];
const DEFAULT_LABEL_MAX_WORDS = 4;

// --- config load ---------------------------------------------------------------------
export function loadConfig(configPath = "project.config.json") {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    /* fall back to defaults */
  }
  const copy = raw.copy ?? {};
  const properNouns = new Set([...DEFAULT_PROPER_NOUNS, ...(copy.properNouns ?? [])]);
  const terminology = [...DEFAULT_TERMINOLOGY, ...(copy.terminology ?? [])];
  const waivers = new Set(copy.waivers ?? []); // key-paths exempt from ALL checks
  const labelMaxWords = copy.labelMaxWords ?? DEFAULT_LABEL_MAX_WORDS;
  // Which locale files to check: explicit `copy.locales`, else the defaultLocale, else en.
  const locales = copy.locales ?? (raw.defaultLocale ? [raw.defaultLocale] : ["en"]);
  return { properNouns, terminology, waivers, labelMaxWords, locales };
}

// --- flatten a nested messages object to dot-path → string leaves --------------------
export function flattenMessages(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flattenMessages(v, key));
    else if (typeof v === "string") out.push({ key, value: v });
  }
  return out;
}

// --- per-value checks ----------------------------------------------------------------
const ENDS_ELLIPSIS = /(\.\.\.|…)$/;
const ENDS_LONE_PERIOD = /[^.]\.$/; // a single trailing "." (not part of "...")

// A word is "Title-cased" if it starts Uppercase+lowercase (e.g. "Home"); an ALL-CAPS
// token ("ID", "SSO") is an acronym, not Title Case, so it is allowed. Leading `{`,
// quotes and punctuation are stripped before the test so "{count}" / "'Delete'" don't
// misfire.
function stripToken(w) {
  return w.replace(/^[^A-Za-z]+/, "").replace(/[^A-Za-z]+$/, "");
}
function isTitleCased(word) {
  const t = stripToken(word);
  return /^[A-Z][a-z]/.test(t);
}

export function checkValue(key, value, config) {
  const findings = [];
  if (config.waivers.has(key)) return findings;
  const words = value.trim().split(/\s+/).filter(Boolean);
  const isLabel = words.length > 0 && words.length <= config.labelMaxWords;

  // 1. trailing-period (labels only) — allow ellipsis and ?/! .
  if (isLabel && ENDS_LONE_PERIOD.test(value) && !ENDS_ELLIPSIS.test(value)) {
    findings.push({
      key,
      value,
      rule: "trailing-period",
      message: `"${value}" — a button/label takes no trailing period. Drop the ".".`,
    });
  }

  // 2. sentence-case (labels only) — only word[0] (or a proper noun / acronym) capitalized.
  if (isLabel) {
    const offenders = words
      .slice(1)
      .map(stripToken)
      .filter((w) => w && isTitleCased(w) && !config.properNouns.has(w));
    if (offenders.length) {
      findings.push({
        key,
        value,
        rule: "sentence-case",
        message: `"${value}" is Title Case — use sentence case (only the first word + proper nouns capitalized). Lower-case: ${offenders.join(", ")}.`,
      });
    }
  }

  // 3. terminology (all values) — banned term → preferred.
  for (const { term, preferred } of config.terminology) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(value)) {
      findings.push({
        key,
        value,
        rule: "terminology",
        message: `"${value}" uses "${term}" — house term is "${preferred}".`,
      });
    }
  }
  return findings;
}

export function checkMessages(messagesObj, config) {
  return flattenMessages(messagesObj).flatMap(({ key, value }) => checkValue(key, value, config));
}

// --- run over the configured locale files --------------------------------------------
export function runCopyCheck({ dir = "messages", config = loadConfig() } = {}) {
  const findings = [];
  const checked = [];
  for (const locale of config.locales) {
    const file = path.join(dir, `${locale}.json`);
    if (!existsSync(file)) continue;
    let obj;
    try {
      obj = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      findings.push({ key: file, value: "", rule: "parse", message: `unparseable: ${e.message}` });
      continue;
    }
    checked.push(file);
    for (const f of checkMessages(obj, config)) findings.push({ ...f, file });
  }
  return { ok: findings.length === 0, findings, checked };
}

// --- CLI -----------------------------------------------------------------------------
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const json = process.argv.includes("--json");
  const result = runCopyCheck();
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`copy-check: clean (${result.checked.join(", ") || "no locale files"})`);
  } else {
    console.error(`copy-check: ${result.findings.length} issue(s):`);
    for (const f of result.findings)
      console.error(`  [${f.rule}] ${f.file}:${f.key} — ${f.message}`);
    console.error(
      "\n  Fix the copy, or waive a genuine exception via project.config.json `copy.waivers` (a key-path) / `copy.properNouns`.",
    );
  }
  process.exit(result.ok ? 0 : 1);
}
