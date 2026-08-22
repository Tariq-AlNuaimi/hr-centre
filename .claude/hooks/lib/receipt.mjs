// Shared receipt (git-trailer) parse + verify for the SDLC-chain gates
// (docs/blueprints/sdlc-chain.md, task 5; ADR-064). Consumed by
// .claude/hooks/review-gate.mjs (pre-push, AC-1.1/1.2/1.6) and
// .claude/hooks/qa-gate.mjs (PreToolUse Bash, AC-1.3/1.4).
//
// THE MECHANISM: a step emits a durable token; the next step's gate requires it.
// The token is a git trailer on the commit -- it travels with the work, survives the
// ephemeral containers this repo runs in, and needs no separate state store
// (blueprint decision 13). The trailers:
//
//   Reviewed: <scope> <tree-sha>     -- emitted by /review  (.claude/skills/review)
//   QA:       <scope> <tree-sha>     -- emitted by /qa
//   Gate-Skip: <gate-name> <reason>  -- the recorded-ack bypass (AC-4.1/4.2)
//
// WHY CONTENT-BOUND (AC-1.6, blueprint decision 17 / Amendment 2026-08-22): a bare
// `Reviewed:` trailer certifies a *message*, not *code*. Rebase with conflict
// resolution, or amend, and the message survives while the diff underneath changes --
// the receipt would then certify content nobody reviewed. Binding the trailer to a hash
// over the CURRENT content of the scoped paths makes it self-verifying: any later edit
// to any scoped path changes that path's blob sha, which changes the tree-sha, which no
// longer matches the trailer. The receipt self-invalidates and review is re-demanded.
//
// THE HASH: exactly the algorithm .claude/skills/review/SKILL.md step 4 specifies, so
// the emitter and the gates agree by construction -- build a temporary index holding
// ONLY the in-scope paths at their current blobs (`git read-tree --empty` +
// `git update-index --add --cacheinfo <mode>,<blob>,<path>`), then `git write-tree`.
// It is recomputable from a commit (`ref` given: blobs read via `git ls-tree`) and from
// the working tree (`ref` omitted: blobs via `git hash-object -w`), and it changes when
// any scoped path's content changes -- including when a scoped path is deleted, since
// its entry then leaves the tree.
//
// FAIL-OPEN CONTRACT (AC-1.5, ADR-047): every function here THROWS on git failure /
// malformed input rather than guessing. The callers are governance gates, not security
// guards, so they catch and ALLOW with a warning. Never swallow an error here into a
// "valid" verdict -- that would turn a broken hash into a silent pass, which is the one
// failure mode worse than a wedged session.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { globToRegExp, relPath } from "./path-match.mjs";

/** The empty git tree -- what an in-scope set with no surviving files hashes to. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * The review gate's scope (AC-1.1, CLAUDE.md's existing wording: "auth, schemas, API
 * routes, or lib/"). `lib/**` already covers lib/auth.ts and lib/prisma/**; the auth
 * files listed separately are the ones that live outside lib/.
 */
export const REVIEW_SCOPE_GLOBS = [
  "lib/**",
  "app/api/**",
  "prisma/schema.prisma",
  "middleware.ts",
  "auth.ts",
  "auth.config.ts",
  // Harness code, added after this gate's own wave shipped three hooks, a receipt
  // library and two gates WITHOUT a review receipt -- because harness paths were out
  // of scope. A hook change can switch a fail-closed guard (protect-secrets,
  // dangerous-commands, bash-write-gate) off, and scripts/ship.mjs IS the gate, so
  // these carry at least the blast radius of lib/. (AC-1.1, amended 2026-08-22.)
  ".claude/hooks/**",
  "scripts/**",
  // The WIRING, added after a breadth review found the widening above stopped one
  // level short: `.claude/hooks/**` protects the guards' CODE, but `settings.json`
  // is what REGISTERS them and `.husky/pre-push` is what INVOKES review-gate. Deleting
  // one line from either silently and permanently disables the mechanism -- including
  // the fail-closed guards (protect-secrets, dangerous-commands, bash-write-gate) --
  // with no receipt demanded and no banner. The two files most capable of switching
  // everything off were the two outside its protection.
  ".claude/settings.json",
  ".husky/**",
  // Second breadth review: the widening above fixed the two NAMED files but not the
  // CLASS. `.husky/pre-push` runs `npm run ship`, which resolves through package.json --
  // editing that one script to `true` no-ops typecheck, lint, tests, gitleaks, the
  // gate-skip backstop, everything, while requiring no receipt. And CLAUDE.md calls the
  // thirteen ESLint rules "the security floor"; eslint.config.mjs is their registration
  // file, exactly what settings.json is for hooks. Both are at least as capable of
  // switching everything off as the two that prompted the first widening.
  "package.json",
  "eslint.config.mjs",
  "eslint-rules/**",
  // Round 3: the class STILL was not closed. Each of these can switch off a
  // security-relevant /ship gate with no receipt, verified against the real matcher:
  //   findings-register.md -- the trust anchor every OTHER escape hatch reads. One edit
  //     marks any gate-skip, pillar wave-off or *Ack as adjudicated, defeating all of
  //     them at once. The most powerful file in the set.
  //   audit-allowlist.json -- loadAuditAllowlist only checks the JSON parses; adding a
  //     real GHSA id silently clears a High/Critical npm audit finding.
  //   next.config.ts -- carries the app's static security headers (HSTS, X-Frame-Options,
  //     Referrer-Policy...). No ship phase or test asserts them; weakening one is silent.
  //   tsconfig.json -- typecheck runs `tsc --noEmit` with no include override, so this
  //     file's `exclude` decides what is typechecked at all (reproduced: adding
  //     "app/api/**" to exclude made a real type error pass).
  //   .npmrc -- `omit=dev` makes `npm audit` report 0 for a real dev CVE (reproduced).
  "docs/findings-register.md",
  "audit-allowlist.json",
  "next.config.ts",
  "tsconfig.json",
  ".npmrc",
];

/**
 * Is a `Gate-Skip: <gate>` adjudicated in the findings-register text?
 *
 * Lives here, not inline in ship.mjs, because it was UNTESTABLE there -- and that is
 * exactly how it shipped two opposite bugs in a row: first an unanchored `includes()`
 * that let `Gate-Skip: all` match the word "install" in unrelated closed entries, then an
 * anchored regex whose required literal the deny message never named. Both directions are
 * now covered by tests in tests/harness/hooks.test.mjs.
 *
 * A block adjudicates a gate when it (a) contains the literal `Gate-Skip: <gate>` with a
 * word boundary after it, (b) carries status: adjudicated(...) or fixed(...), and (c) does
 * NOT also carry status: open.
 *
 * @param {string} registerText full docs/findings-register.md contents
 * @param {string} gate gate name from the trailer (may be `*`, hence the escaping)
 */
export function isSkipAdjudicated(registerText, gate) {
  if (!registerText || !gate) return false;
  const esc = gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = new RegExp(`Gate-Skip:\\s*${esc}(?![\\w-])`);
  return registerText
    .split(/\n(?=-\s*\d{4}-\d{2}-\d{2}\b)/)
    .some(
      (b) =>
        names.test(b) &&
        /\bstatus:\s*(adjudicated|fixed)\b/i.test(b) &&
        !/\bstatus:\s*open\b/i.test(b),
    );
}

/** Scope tokens that mean "the whole tree" rather than a path list. */
const WHOLE_TREE_TOKENS = new Set([".", "*", "**", "<all>", "all"]);

/** Run git, throwing on failure. Callers fail open on the throw. */
export function git(args, { root = process.cwd(), env = {}, input } = {}) {
  const r = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input,
    env: { ...process.env, ...env },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(
      `git ${args.slice(0, 3).join(" ")} failed (${r.status}): ${(r.stderr ?? "").trim()}`,
    );
  }
  return r.stdout ?? "";
}

/** Run git, returning null instead of throwing (for probes whose failure is expected). */
export function gitTry(args, opts) {
  try {
    return git(args, opts);
  } catch {
    return null;
  }
}

/** Is this repo-relative path inside the review gate's scope? */
export function isInReviewScope(rel) {
  if (!rel) return false;
  return REVIEW_SCOPE_GLOBS.some((g) => globToRegExp(g).test(rel));
}

/** Normalise a raw path to repo-relative, forward-slashed (reuses path-match.mjs). */
export function norm(p, root) {
  return relPath(p, root);
}

// ---------------------------------------------------------------------------
// Trailer parsing
// ---------------------------------------------------------------------------

/**
 * All `Key: value` trailer lines in a commit message.
 *
 * Deliberately lenient: any line in the message, not just git's strict last-paragraph
 * definition. A receipt the operator put one blank line too high is still a receipt the
 * operator wrote; being strict here would silently re-demand a review that happened.
 */
export function parseTrailers(message) {
  const out = [];
  for (const line of String(message ?? "").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.+?)\s*$/.exec(line);
    if (m) out.push({ key: m[1], value: m[2] });
  }
  return out;
}

const HEX_SHA = /^[0-9a-f]{7,64}$/i;

/**
 * Receipts of one kind ("Reviewed" | "QA") in a commit message.
 * Shape: `{ key, scope: string[], hash, wholeTree, raw }`.
 * A trailer whose last token is not a hex sha is NOT a receipt (it is prose) and is
 * dropped -- an unparseable receipt must never count as a valid one.
 */
export function parseReceipts(message, key) {
  const wanted = String(key).toLowerCase();
  const out = [];
  for (const t of parseTrailers(message)) {
    if (t.key.toLowerCase() !== wanted) continue;
    const toks = t.value.split(/\s+/).filter(Boolean);
    if (toks.length === 0) continue;
    const hash = toks.at(-1);
    if (!HEX_SHA.test(hash)) continue; // prose, not a receipt
    const scopeStr = toks.slice(0, -1).join(" ");
    const scope = scopeStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const wholeTree = scope.length === 0 || scope.every((s) => WHOLE_TREE_TOKENS.has(s));
    out.push({ key: t.key, scope, hash: hash.toLowerCase(), wholeTree, raw: t.value });
  }
  return out;
}

/**
 * Recorded-ack bypasses in a commit message (AC-4.1/4.2):
 * `Gate-Skip: <gate-name> <reason>`. There is no OTHER bypass of these gates by design
 * -- git's own `--no-verify` remains git's escape and is out of scope to remove.
 */
export function parseGateSkips(message) {
  const out = [];
  for (const t of parseTrailers(message)) {
    if (t.key.toLowerCase() !== "gate-skip") continue;
    const toks = t.value.split(/\s+/).filter(Boolean);
    if (toks.length === 0) continue;
    out.push({
      gate: toks[0].replace(/[,:]$/, "").toLowerCase(),
      reason: toks.slice(1).join(" ").trim() || "(no reason recorded)",
      raw: t.value,
    });
  }
  return out;
}

/** Does a recorded skip name this gate? Accepts the short alias and `all`. */
export function skipMatchesGate(skip, gateName) {
  const g = String(gateName).toLowerCase();
  const alias = g.replace(/-gate$/, "");
  return skip.gate === g || skip.gate === alias || skip.gate === "all" || skip.gate === "*";
}

// ---------------------------------------------------------------------------
// The content-bound hash
// ---------------------------------------------------------------------------

/** File mode git would record: 100755 when executable, else 100644. */
function fsMode(abs) {
  try {
    return statSync(abs).mode & 0o111 ? "100755" : "100644";
  } catch {
    return "100644";
  }
}

/**
 * `{ mode, sha, path }` for every scoped path that EXISTS at `ref` (or in the working
 * tree when `ref` is omitted). Missing paths are skipped: a deleted scoped path simply
 * has no tree entry, which is itself a hash change, so deletion self-invalidates too.
 */
function blobEntries(paths, { root, ref }) {
  const entries = [];
  if (ref) {
    // Blobs as they exist in the commit -- this is what makes a rebase detectable.
    for (let i = 0; i < paths.length; i += 200) {
      const chunk = paths.slice(i, i + 200);
      const out = git(["ls-tree", "-r", "-z", "--full-name", ref, "--", ...chunk], { root });
      for (const rec of out.split("\0")) {
        if (!rec) continue;
        const m = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\t(.*)$/.exec(rec);
        if (!m || m[2] !== "blob") continue;
        entries.push({ mode: m[1], sha: m[3], path: m[4] });
      }
    }
  } else {
    // Working-tree content. `-w` writes the blob into the object DB because
    // `git write-tree` refuses to reference an object it cannot find; the objects are
    // ordinary loose blobs and are gc-able.
    // A bare directory means "every tracked file under it", NOT "nothing". Skipping
    // directories here silently produced the empty-tree sha, i.e. a receipt that
    // certifies no content while looking perfectly valid.
    const expanded = [];
    for (const p of paths) {
      let isDir = false;
      try {
        isDir = existsSync(resolve(root, p)) && statSync(resolve(root, p)).isDirectory();
      } catch {
        isDir = false;
      }
      if (isDir) {
        expanded.push(...git(["ls-files", "-z", "--", p], { root }).split("\0").filter(Boolean));
      } else {
        expanded.push(p);
      }
    }
    for (const p of [...new Set(expanded)].sort()) {
      const abs = resolve(root, p);
      if (!existsSync(abs)) continue;
      try {
        if (statSync(abs).isDirectory()) continue;
      } catch {
        continue;
      }
      const sha = git(["hash-object", "-w", "--", p], { root }).trim();
      if (!HEX_SHA.test(sha)) continue;
      entries.push({ mode: fsMode(abs), sha, path: p });
    }
  }
  return entries;
}

/** Every tracked path (used only for the whole-tree working-copy hash). */
function trackedPaths(root) {
  return git(["ls-files", "-z"], { root }).split("\0").filter(Boolean);
}

/**
 * The content-bound tree-sha over `paths`.
 *
 * @param {string[]} paths repo-relative paths (a whole-tree token -- "." / "*" / "**" --
 *   or an empty list means "the whole tree").
 * @param {{root?: string, ref?: string}} opts `ref` = hash the content AT that commit;
 *   omit `ref` to hash the working tree. Both must be supported: the gates verify
 *   against a commit, `/review` emits from the working tree.
 * @returns {string} 40-hex tree sha. THROWS on any git failure (callers fail open).
 */
export function computeScopeHash(paths, { root = process.cwd(), ref, strict = false } = {}) {
  const list = [...new Set((paths ?? []).map((p) => norm(p, root)).filter(Boolean))].sort();
  const whole = list.length === 0 || list.every((p) => WHOLE_TREE_TOKENS.has(p));

  if (whole) {
    // Whole-tree receipt: at a commit this is just that commit's tree.
    if (ref) return git(["rev-parse", `${ref}^{tree}`], { root }).trim();
    return computeScopeHash(trackedPaths(root), { root });
  }

  const entries = blobEntries(list, { root, ref });
  if (entries.length === 0) {
    // Verification stays permissive (a scope whose files were all deleted really is
    // an empty tree, and the gates fail open per ADR-047). EMISSION must not: writing
    // a receipt over zero files is how a trailer becomes decorative.
    if (strict)
      throw new Error(
        `refusing to emit a receipt: scope [${list.join(", ")}] resolved to 0 tracked files`,
      );
    return EMPTY_TREE;
  }

  const dir = mkdtempSync(join(tmpdir(), "receipt-idx-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    git(["read-tree", "--empty"], { root, env });
    for (let i = 0; i < entries.length; i += 100) {
      const args = ["update-index", "--add"];
      for (const e of entries.slice(i, i + 100)) {
        args.push("--cacheinfo", `${e.mode},${e.sha},${e.path}`);
      }
      git(args, { root, env });
    }
    return git(["write-tree"], { root, env }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Is this receipt still valid -- i.e. does its recorded tree-sha still match the CURRENT
 * content of its own scope? Returns `{ valid, expected, actual }`. THROWS on git failure.
 */
export function verifyReceipt(receipt, { root = process.cwd(), ref } = {}) {
  const actual = computeScopeHash(receipt.wholeTree ? [] : receipt.scope, { root, ref });
  // Allow an abbreviated sha in the trailer (git's own abbreviation rules).
  const expected = receipt.hash;
  const valid =
    actual === expected || (expected.length < actual.length && actual.startsWith(expected));
  return { valid, expected, actual };
}

// ---------------------------------------------------------------------------
// Commit helpers
// ---------------------------------------------------------------------------

/** Full commit message (subject + body + trailers) for a ref. THROWS if unresolvable. */
export function commitMessage(ref, { root = process.cwd() } = {}) {
  return git(["log", "-1", "--format=%B", ref], { root });
}

/** Commit shas in a range spec, newest first. THROWS on git failure. */
export function commitsIn(rangeArgs, { root = process.cwd() } = {}) {
  return git(["rev-list", ...rangeArgs], { root })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// CLI -- so /review and /qa can emit exactly the hash the gates verify, and so the
// mechanism is hand-testable:
//   node .claude/hooks/lib/receipt.mjs hash lib/foo.ts app/api/x/route.ts
//   node .claude/hooks/lib/receipt.mjs hash --ref HEAD lib/foo.ts
//   node .claude/hooks/lib/receipt.mjs trailer --key Reviewed lib/foo.ts
//   node .claude/hooks/lib/receipt.mjs verify --ref HEAD --key Reviewed
// ---------------------------------------------------------------------------
function cli(argv) {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const cmd = argv[0] ?? "hash";
  const rest = argv.slice(1);
  let ref;
  let key = "Reviewed";
  const paths = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--ref") ref = rest[++i];
    else if (rest[i] === "--key") key = rest[++i];
    else paths.push(rest[i]);
  }

  if (cmd === "hash") {
    process.stdout.write(computeScopeHash(paths, { root, ref, strict: true }) + "\n");
    return 0;
  }
  if (cmd === "trailer") {
    const scope = [...new Set(paths.map((p) => norm(p, root)).filter(Boolean))].sort();
    const hash = computeScopeHash(scope, { root, ref, strict: true });
    process.stdout.write(`${key}: ${scope.join(",") || "."} ${hash}\n`);
    return 0;
  }
  if (cmd === "verify") {
    const receipts = parseReceipts(commitMessage(ref ?? "HEAD", { root }), key);
    if (receipts.length === 0) {
      process.stdout.write(`no ${key}: receipt on ${ref ?? "HEAD"}\n`);
      return 1;
    }
    let ok = false;
    for (const r of receipts) {
      const v = verifyReceipt(r, { root, ref: ref ?? "HEAD" });
      ok = ok || v.valid;
      process.stdout.write(
        `${v.valid ? "VALID  " : "STALE  "} ${key}: ${r.raw}\n         expected ${v.expected}, current ${v.actual}\n`,
      );
    }
    return ok ? 0 : 1;
  }
  process.stderr.write(
    `usage: receipt.mjs <hash|trailer|verify> [--ref <ref>] [--key <Key>] [paths...]\n`,
  );
  return 2;
}

// Entry-module guard. Was `argv[1].endsWith("receipt.mjs")`, which fired whenever ANY
// argument merely ended in that filename -- so importing this module from a script that
// happened to be passed the path `.claude/hooks/lib/receipt.mjs` hijacked it into CLI
// mode and printed usage instead of exporting. Compare the resolved entry URL instead.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exit(cli(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`receipt.mjs: ${e?.message ?? e}\n`);
    process.exit(2);
  }
}
