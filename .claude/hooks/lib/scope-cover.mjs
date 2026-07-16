// Shared Scope-coverage logic for the write gates (ADR-032 build-vs-buy, ADR-033
// blueprint) and the harness-v2 bash-write-gate (V2-001). Single source of truth so
// the Write-tool gates and the Bash-write gate apply the SAME coverage checks.
//
// Exports the glob->regex translation, the gated-surface predicates, the Scope: line
// parser, and blueprint/ledger coverage — including V2-002 "Scope-glob hygiene":
//   * over-broad globs (a bare `**`, or a whole structural root like `app/**`,
//     `app/api/**`, `lib/**`, `components/**`, `scripts/**`) do NOT count as coverage;
//   * a lightweight stub carrying an expired `Expires: YYYY-MM-DD` line does NOT count.
//
// Pure, dependency-free, fail-open by caller convention (callers wrap in try/catch and
// allow on error — a governance gate must never brick a session).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, relative, join } from "node:path";

/** Project-relative, forward-slashed path (abs or relative input). */
export function relPath(fp, root) {
  if (!fp) return "";
  return relative(root, resolve(root, fp)).split("\\").join("/");
}

/** Minimal glob -> RegExp: `**` = any depth, `*` = within a segment. */
export function globToRe(glob) {
  const esc = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex metachars (not * or /)
    .replace(/\*\*/g, " ") // ** placeholder
    .replace(/\*/g, "[^/]*") // * = within a segment
    .replace(/ /g, ".*"); // ** = any depth
  return new RegExp(`^${esc}$`);
}

// Structural roots that, used as the sole concrete prefix of a glob, cover more than
// one feature area — so they are too broad to count as blueprint coverage (V2-002).
// A specific capability dir (lib/openapi/**, app/api/widgets/**) has a DEEPER concrete
// prefix and is fine; only these bare roots are rejected.
const BROAD_PREFIXES = new Set([
  "",
  "app",
  "app/api",
  "lib",
  "components",
  "components/shared",
  "hooks",
  "scripts",
  "src",
  "tests",
]);

/**
 * A glob is "too broad" when the concrete (wildcard-free) prefix before its first
 * `*` segment is empty or a known structural root. e.g. `app/**` and `app/api/**`
 * are too broad; `app/api/widgets/**` and `lib/openapi/**` are specific.
 */
export function isGlobTooBroad(glob) {
  const g = (glob ?? "").trim();
  if (!g) return true;
  const segs = g.split("/");
  const concrete = [];
  for (const s of segs) {
    if (s.includes("*")) break;
    concrete.push(s);
  }
  return BROAD_PREFIXES.has(concrete.join("/"));
}

/** Is this new file a blueprint "feature is being built" surface (ADR-033)? */
export function isFeatureFile(rel) {
  if (!rel || rel.startsWith("..")) return false;
  if (/^app\/api\/.+\/route\.ts$/.test(rel)) return true; // new API route
  if (/^app\/.+\/page\.tsx$/.test(rel)) return true; // new page/screen
  return false;
}

/** Is this new file on the build-vs-buy gated "new lib capability" surface (ADR-032)? */
export function isGatedCapabilityFile(rel) {
  if (!rel || rel.startsWith("..")) return false;
  if (!/^lib\//.test(rel)) return false;
  if (!/\.(ts|tsx)$/.test(rel)) return false;
  if (/^lib\/validations\//.test(rel)) return false;
  if (/^lib\/prisma\//.test(rel)) return false;
  if (/\.(test|spec)\.(ts|tsx)$/.test(rel)) return false;
  if (/\.d\.ts$/.test(rel)) return false;
  return true;
}

/** Parse `Expires: YYYY-MM-DD` from blueprint text; null if none/malformed. */
function parseExpires(text) {
  for (const line of text.split("\n")) {
    const m = /^\s*Expires:\s*(\d{4}-\d{2}-\d{2})\s*$/i.exec(line);
    if (m) {
      const d = new Date(`${m[1]}T23:59:59Z`);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/** Every `Scope:` glob in one blueprint/ledger text (trimmed, comma-split). */
function scopeGlobs(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = /^\s*Scope:\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    for (const g of m[1].split(",")) {
      const glob = g.trim();
      if (glob) out.push(glob);
    }
  }
  return out;
}

/**
 * Blueprint coverage with V2-002 hygiene. Returns:
 *   { covered, sawBroadMatch, sawExpiredMatch }
 * - covered: a SPECIFIC, non-expired Scope glob matches `rel`.
 * - sawBroadMatch: an over-broad glob would have matched (had it counted) — drives the
 *   "make your Scope specific" hint in the deny reason.
 * - sawExpiredMatch: a matching glob lived in an expired stub — drives the expiry hint.
 */
export function blueprintCoverInfo(rel, root, now = new Date()) {
  const dir = resolve(root, "docs/blueprints");
  const info = { covered: false, sawBroadMatch: false, sawExpiredMatch: false };
  if (!existsSync(dir)) return info;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    let text = "";
    try {
      text = readFileSync(join(dir, name), "utf8");
    } catch {
      continue;
    }
    const expires = parseExpires(text);
    const expired = expires !== null && expires.getTime() < now.getTime();
    for (const glob of scopeGlobs(text)) {
      if (!globToRe(glob).test(rel)) continue;
      if (isGlobTooBroad(glob)) {
        info.sawBroadMatch = true;
        continue;
      }
      if (expired) {
        info.sawExpiredMatch = true;
        continue;
      }
      info.covered = true;
      return info; // a real cover — no need to keep scanning
    }
  }
  return info;
}

/** Convenience boolean: does any specific, non-expired blueprint Scope cover `rel`? */
export function blueprintCovers(rel, root, now = new Date()) {
  return blueprintCoverInfo(rel, root, now).covered;
}

/** Ledger (build-vs-buy) coverage — no hygiene (ledger-glob hygiene is V2-309). */
export function ledgerCovers(rel, root) {
  const ledger = resolve(root, "docs/build-vs-buy-ledger.md");
  if (!existsSync(ledger)) return false;
  let text = "";
  try {
    text = readFileSync(ledger, "utf8");
  } catch {
    return false;
  }
  for (const glob of scopeGlobs(text)) {
    if (globToRe(glob).test(rel)) return true;
  }
  return false;
}
