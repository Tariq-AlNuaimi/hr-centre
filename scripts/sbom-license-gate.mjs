#!/usr/bin/env node
// scripts/sbom-license-gate.mjs (O5 — deferral; ADR-051 §2)
//
// The WARM license gate (scripts/license-gate.mjs) scans package-lock.json — fast, but the
// lockfile is not the STANDARD compliance artifact a /handoff ships, and CycloneDX resolves
// licenses from more sources than the lockfile's `license` field. This gate validates the
// generated CycloneDX SBOM (`npm run sbom` → sbom.json) is license-clean, REUSING the exact
// ADR-051 deny set + committed election allowlist so there is no second license taxonomy to
// drift: it maps each SBOM component's license(s) to a string and feeds a synthetic
// {name:{license}} map to license-gate.mjs's `evaluateLicenses`.
//
// Runs in `ship:full` (SBOM generation is ~seconds — too slow for the warm loop) and on
// demand via `npm run license:sbom`. Exit 0 = clean; exit 1 = a denied, non-elected license
// in the SBOM. `--sbom <path>` uses an existing SBOM (tests); default regenerates a fresh one.

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { DENY, evaluateLicenses, loadAllowlist } from "./license-gate.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const sbomArg = (() => {
  const i = argv.indexOf("--sbom");
  return i >= 0 ? argv[i + 1] : null;
})();
const SBOM_PATH = sbomArg ?? "sbom.json";

/** Derive the npm package name from a CycloneDX component (purl > group+name > name). */
export function componentName(c) {
  if (c.purl) {
    const m = String(c.purl).match(/^pkg:npm\/(.+?)@[^@/]*(?:\?.*)?$/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
  }
  if (c.group && c.name) return `${c.group}/${c.name}`;
  return c.name ?? "";
}

/** One license STRING per CycloneDX license entry: expression, or license.id / license.name. */
export function licenseEntryString(entry) {
  if (!entry) return "";
  if (entry.expression) return String(entry.expression);
  if (entry.license) return String(entry.license.id ?? entry.license.name ?? "");
  return "";
}

/**
 * Build the synthetic `{name: {license, dev}}` map license-gate.mjs's evaluateLicenses expects.
 * Multiple license entries on one component are joined with " AND " (all apply) — a denied
 * substring still trips DENY, and it won't be mis-read as an OR dual-license alternative.
 *
 * The map is keyed by bare package NAME (version-stripped), so two components with the same
 * name at different versions collide. `cyclonedx-npm` currently emits one component per name,
 * but we don't control that — so AGGREGATE (join all license strings seen for a name) rather
 * than last-write-wins, or a denied license on a superseded version could slip past unseen if
 * the SBOM generator ever emits per-version components.
 * @returns {Record<string, {license: string, dev: boolean}>}
 */
export function sbomToLockLikeMap(components) {
  /** @type {Record<string, {license: string, dev: boolean}>} */
  const map = {};
  for (const c of components ?? []) {
    const name = componentName(c);
    if (!name) continue;
    const parts = (c.licenses ?? []).map(licenseEntryString).filter(Boolean);
    const license = [map[name]?.license, ...parts].filter(Boolean).join(" AND ");
    map[name] = { license, dev: false };
  }
  return map;
}

function main() {
  // Regenerate a fresh SBOM unless an explicit --sbom was passed (tests / a provided artifact).
  if (!sbomArg) {
    const gen = spawnSync("npm", ["run", "sbom"], { cwd: ROOT, stdio: "inherit" });
    if (gen.status !== 0) {
      console.error("sbom-license: `npm run sbom` failed — cannot evaluate.");
      process.exit(1);
    }
  }
  if (!existsSync(SBOM_PATH)) {
    console.error(`sbom-license: ${SBOM_PATH} not found (run \`npm run sbom\` first).`);
    process.exit(1);
  }

  let sbom;
  try {
    sbom = JSON.parse(readFileSync(SBOM_PATH, "utf8"));
  } catch (e) {
    console.error(`sbom-license: ${SBOM_PATH} is not valid JSON (${e?.message ?? e}).`);
    process.exit(1);
  }
  if (sbom.bomFormat !== "CycloneDX") {
    console.error(
      `sbom-license: ${SBOM_PATH} is not a CycloneDX SBOM (bomFormat=${sbom.bomFormat}).`,
    );
    process.exit(1);
  }

  // Reuse the ADR-051 allowlist (safe-fail to empty = stricter, never a false pass).
  let allowlist = {};
  try {
    if (existsSync("scripts/license-allowlist.json"))
      allowlist = loadAllowlist(readFileSync("scripts/license-allowlist.json", "utf8"));
  } catch (e) {
    console.error(
      `sbom-license: allowlist invalid (${e?.message ?? e}); proceeding with none (stricter).`,
    );
  }

  const { scanned, offenders, elections, unknown } = evaluateLicenses(
    sbomToLockLikeMap(sbom.components),
    allowlist,
  );

  console.log(
    `sbom-license: scanned ${scanned} SBOM components (deny set: ${DENY.map((d) => d.id).join(", ")}).`,
  );
  if (elections.length) console.log(`  elected (allowlisted): ${elections.length}`);
  if (unknown.length)
    console.log(
      `  note: ${unknown.length} component(s) carry NO license in the SBOM (documented-exception or upstream gap) — not a RED.`,
    );

  if (offenders.size === 0) {
    console.log("sbom-license: clean — no denied, non-elected licenses in the SBOM.");
    process.exit(0);
  }
  console.error(`\nsbom-license: RED — ${offenders.size} denied license(s) in the SBOM (ADR-051):`);
  for (const [name, o] of offenders)
    console.error(
      `  ${name} — ${o.license} (${o.deny}${o.dual ? ", dual — needs an election" : ""})`,
    );
  console.error(
    `\nElect a permissive dual-license branch or add a documented exception in scripts/license-allowlist.json (every entry needs a reason; ADR-051), or remove the dependency.`,
  );
  process.exit(1);
}

// Only run the gate when executed directly (`node scripts/sbom-license-gate.mjs`), so a test
// can import the pure helpers without triggering `npm run sbom` / process.exit.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
