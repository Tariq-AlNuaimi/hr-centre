// License-allowlist gate evaluator (ADR-051 §2 — supply-chain P1 hardening).
//
// The template is REDISTRIBUTED: forks inherit the entire dependency tree and are
// operated by non-developers, so a copyleft / source-available license resolving
// anywhere in the tree is a redistribution problem nobody would notice by hand.
// This module classifies every package recorded in package-lock.json (npm >= 7
// records each installed package's `license` field there) against the ADR-051
// deny set — AGPL / SSPL / BUSL / Elastic / GPL-only — with a committed election
// allowlist (scripts/license-allowlist.json) for dual-license permissive picks
// and documented UNKNOWN-license exceptions.
//
// Pure functions, no I/O: scripts/ship.mjs wires this as the `licenses` phase-A
// gate, and tests/contracts/license-gate.test.ts asserts the behavior. Reading
// ONLY the lockfile keeps the check deterministic, dependency-free, and <1s.

/** The ADR-051 deny set. LGPL and AGPL do not match the GPL-only pattern:
 *  `\bGPL` has no word boundary inside "LGPL"/"AGPL" (AGPL has its own rule). */
export const DENY = [
  { id: "AGPL", re: /\bAGPL/i },
  { id: "SSPL", re: /\bSSPL/i },
  { id: "BUSL", re: /\bBUSL|Business Source License/i },
  { id: "Elastic", re: /\bElastic-\d|\bELv2\b|\bElastic License/i },
  { id: "GPL-only", re: /\bGPL(?:\b|-)/i },
];

/** "node_modules/a/node_modules/@scope/b" -> "@scope/b" */
export function packageNameFromLockPath(lockPath) {
  return lockPath.replace(/^.*node_modules\//, "");
}

/**
 * Parse + validate scripts/license-allowlist.json source. Every election MUST
 * carry a non-empty human "reason" — a reasonless entry is a silent waiver,
 * which ADR-051 forbids. Throws on malformed input (the caller safe-fails to an
 * empty allowlist, which can only make the gate STRICTER).
 * @returns {Record<string, {license?: string, reason: string}>}
 */
export function loadAllowlist(src) {
  const j = JSON.parse(src);
  const entries = j?.elections ?? {};
  if (typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error('license-allowlist "elections" must be an object of package -> election');
  }
  const reasonless = Object.entries(entries)
    .filter(([, v]) => !v || typeof v.reason !== "string" || !v.reason.trim())
    .map(([k]) => k);
  if (reasonless.length) {
    throw new Error(
      `license-allowlist entries missing a non-empty "reason": ${reasonless.join(", ")}`,
    );
  }
  return entries;
}

/**
 * Evaluate the lockfile `packages` map against the deny set + allowlist.
 *
 * The WHOLE tree is scanned (dev deps included): the template redistributes the
 * repo itself, so a denied license in a devDependency still ships to every fork.
 *
 * @param {Record<string, {license?: string, dev?: boolean, link?: boolean}>} lockPackages
 *   the `packages` object from package-lock.json (lockfileVersion >= 2)
 * @param {Record<string, {license?: string, reason: string}>} allowlist
 *   elections from loadAllowlist()
 * @returns {{ scanned: number,
 *             offenders: Map<string, {license: string, deny: string, dual: boolean, dev: boolean}>,
 *             elections: string[], unknown: string[] }}
 */
export function evaluateLicenses(lockPackages, allowlist = {}) {
  const offenders = new Map();
  const elections = new Set();
  const unknown = new Set();
  let scanned = 0;
  for (const [lockPath, meta] of Object.entries(lockPackages ?? {})) {
    if (!lockPath || !meta || meta.link) continue; // root project / workspace links
    scanned++;
    const name = packageNameFromLockPath(lockPath);
    const elected = allowlist[name];
    const lic = meta.license ? String(meta.license) : "";
    if (!lic) {
      // No license field recorded: a documented exception in the allowlist keeps
      // it quiet; otherwise surface it as a WARN-class unknown (never a false RED).
      if (elected) elections.add(`${name} (UNKNOWN — documented exception)`);
      else unknown.add(name);
      continue;
    }
    const hit = DENY.find((d) => d.re.test(lic));
    if (!hit) continue;
    // SPDX OR-expression with at least one non-denied branch = dual-licensed;
    // a valid permissive option exists but ADR-051 requires an EXPLICIT election.
    const alts = lic
      .replace(/[()]/g, " ")
      .split(/\s+OR\s+/i)
      .map((a) => a.trim())
      .filter(Boolean);
    const dual = alts.length > 1 && alts.some((a) => !DENY.some((d) => d.re.test(a)));
    if (elected) {
      elections.add(`${name} (${lic} -> ${elected.license ?? "exception"})`);
      continue;
    }
    offenders.set(name, { license: lic, deny: hit.id, dual, dev: !!meta.dev });
  }
  return { scanned, offenders, elections: [...elections], unknown: [...unknown] };
}
