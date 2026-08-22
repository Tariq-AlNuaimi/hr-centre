#!/usr/bin/env node
// Pre-push gate -- review-before-push (AC-1.1 / AC-1.2 / AC-1.6, docs/blueprints/sdlc-chain.md).
// Invoked from .husky/pre-push AFTER `npm run ship`, so a red build still fails first and
// this gate only ever speaks about a green tree.
//
// Problem it solves: CLAUDE.md declares the review rail BINDING -- "before any push touching
// auth, schemas, API routes, or lib/, run /code-review (blocking)" -- and until now nothing
// enforced it. A step whose only output is transcript text cannot gate anything, and will be
// skipped (blueprint, Problem & outcome). /review now leaves a durable receipt (a git
// trailer); this gate is the consumer that makes the receipt mean something.
//
// What it does: computes the paths this push changes, keeps only those in the gated scope
// (lib/**, app/api/**, prisma/schema.prisma, auth files -- REVIEW_SCOPE_GLOBS), and requires
// that some commit in the push range carries a `Reviewed: <scope> <tree-sha>` trailer whose
// tree-sha still matches the CURRENT content of that scope at the pushed tip. Missing or
// stale -> the push is REJECTED, naming the specific unreviewed paths (never a generic "gate
// failed"; US1-worst).
//
// AC-1.6 (why the hash, not just the trailer): a rebase that resolves conflicts keeps the
// commit message and changes the code. A bare trailer would then certify content nobody
// reviewed. Because the receipt is bound to a hash over the reviewed paths' content, the
// rebase changes the hash, the gate sees the mismatch, and re-demands review.
//
// AC-1.2: a push touching nothing in scope needs no receipt and is never delayed by one.
//
// AC-4.1/4.2 (recorded ack): `Gate-Skip: review-gate <reason>` on any commit in the push
// ALLOWS the push and prints a loud, unmissable banner naming the gate and the reason. That
// is the only bypass this gate provides -- deliberate, and permanently visible in git history.
// (`git push --no-verify` remains git's own escape, out of scope to remove.)
//
// AC-1.5 / ADR-047 -- FAIL OPEN. This is a GOVERNANCE gate, not a security guard: any throw,
// parse failure, missing git data, or inability to evaluate ALLOWS the push and prints a
// warning naming this gate. Only the two security guards (protect-secrets,
// dangerous-commands) fail closed. A MISSING RECEIPT still hard-DENIES -- "cannot evaluate"
// and "evaluated, and the answer is no" are different axes and must not be conflated.
//
// Per-link backout (blueprint mitigation): this gate is one file with one invocation line in
// .husky/pre-push. Delete that line and this link is off; the QA gate and every other hook
// are untouched.
import { readFileSync } from "node:fs";
import {
  EMPTY_TREE,
  commitMessage,
  commitsIn,
  git,
  gitTry,
  isInReviewScope,
  norm,
  parseGateSkips,
  parseReceipts,
  skipMatchesGate,
  verifyReceipt,
} from "./lib/receipt.mjs";

const GATE = "review-gate";
const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const ZERO = /^0{40,64}$/;

/** Fail-open exit: allow the push, but say which gate could not evaluate (AC-1.5). */
function failOpen(err) {
  console.error(
    `\n[${GATE}] WARNING — the review gate could not evaluate this push and is ALLOWING it ` +
      `(fail-open, ADR-047 governance-gate posture).\n` +
      `[${GATE}] Reason: ${err?.message ?? err}\n` +
      `[${GATE}] Review was NOT verified. Run /review before relying on this push.\n`,
  );
  process.exit(0);
}

function banner(lines) {
  const bar = "=".repeat(74);
  console.error(`\n${bar}\n${lines.map((l) => "  " + l).join("\n")}\n${bar}\n`);
}

/**
 * Ref updates git feeds a pre-push hook on stdin:
 *   <local ref> <local sha> <remote ref> <remote sha>
 * Returns [] when stdin is a TTY (hand-invocation) or already drained -- `npm run ship`
 * runs first in .husky/pre-push and may have consumed it. resolveRanges() falls back to
 * the repo's own `@{u}..HEAD` convention in that case.
 */
function refUpdatesFromStdin() {
  if (process.stdin.isTTY) return [];
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    // Both sha fields must LOOK like shas. Without this, a junk line (or whatever a
    // preceding hook left in the pipe) parses as a ref-update, git rejects the bogus
    // revision, and the gate fails open on a push it could otherwise have verified.
    if (!/^[0-9a-f]{40,64}$/i.test(p[1]) || !/^[0-9a-f]{40,64}$/i.test(p[3])) continue;
    out.push({ localRef: p[0], localSha: p[1], remoteRef: p[2], remoteSha: p[3] });
  }
  return out;
}

/** Commits about to be pushed for a tip with no remote counterpart yet (new branch). */
function newCommits(head) {
  const out = gitTry(["rev-list", head, "--not", "--remotes"], { root: ROOT });
  if (out === null) return commitsIn([head, "--max-count=50"], { root: ROOT });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One unit of work: the commits being pushed to a ref, and the paths they change. */
function rangeFor(head, remoteSha) {
  let commits;
  let base;
  if (
    remoteSha &&
    !ZERO.test(remoteSha) &&
    gitTry(["cat-file", "-e", `${remoteSha}^{commit}`], { root: ROOT }) !== null
  ) {
    base = remoteSha;
    commits = commitsIn([`${remoteSha}..${head}`], { root: ROOT });
  } else {
    commits = newCommits(head);
    if (commits.length === 0) return null;
    const oldest = commits.at(-1);
    base = gitTry(["rev-parse", "--verify", `${oldest}^`], { root: ROOT })?.trim() || EMPTY_TREE;
  }
  if (commits.length === 0) return null;
  const changed = git(["diff", "--name-only", base, head], { root: ROOT })
    .split("\n")
    .map((s) => norm(s.trim(), ROOT))
    .filter(Boolean);
  return { head, base, commits, changed };
}

function resolveRanges() {
  const cliRange = process.argv.slice(2).find((a) => a.includes(".."));
  if (cliRange) {
    // Hand-testing / manual invocation: `review-gate.mjs <base>..<head>`.
    const [b, h] = cliRange.split("..");
    const head = git(["rev-parse", h || "HEAD"], { root: ROOT }).trim();
    return [rangeFor(head, git(["rev-parse", b], { root: ROOT }).trim())].filter(Boolean);
  }
  const updates = refUpdatesFromStdin().filter((u) => !ZERO.test(u.localSha));
  if (updates.length > 0) {
    return updates.map((u) => rangeFor(u.localSha, u.remoteSha)).filter(Boolean);
  }
  // Fallback: the repo's own convention (CLAUDE.md uses `@{u}..HEAD` for "unpushed").
  const head = git(["rev-parse", "HEAD"], { root: ROOT }).trim();
  const upstream = gitTry(["rev-parse", "--verify", "@{u}"], { root: ROOT })?.trim();
  return [rangeFor(head, upstream)].filter(Boolean);
}

try {
  // No git, no repo, nothing to say -> allow (fail-open).
  if (gitTry(["rev-parse", "--git-dir"], { root: ROOT }) === null) process.exit(0);

  const ranges = resolveRanges();
  if (ranges.length === 0) process.exit(0); // nothing being pushed

  // AC-1.4 extended to review-gate, as a RECORDED TRAILER -- not an env var.
  //
  // The first attempt read process.env.QUICKSTART. Breadth review round 4 killed it, and
  // it was right on both counts: (a) ambient environment is not scoped to the push being
  // evaluated, so one `export QUICKSTART=1` silently disabled a control CLAUDE.md calls
  // binding for every later push from that shell, with nothing in git history to show it;
  // (b) /quickstart never set the variable anyway, so the exemption did not even serve the
  // workflow it was added for. An unrecorded, indefinitely-persistent kill switch that does
  // not solve its own problem is worse than no exemption.
  //
  // A `Quickstart: <reason>` trailer is scoped to a commit in this push, permanent in
  // history, and auditable -- the same shape as Gate-Skip, minus the /ship RED, because
  // this is a designed exemption rather than a bypass of one.

  for (const range of ranges) {
    const inScope = [...new Set(range.changed.filter(isInReviewScope))].sort();

    // --- AC-1.2: nothing gated in this push -> no receipt required, no friction.
    if (inScope.length === 0) continue;

    // Disposable /quickstart work: exempt when a commit in THIS range says so.
    // Match ONLY in the trailer block (the final paragraph), via git's own parser.
    // Every other trailer in this chain is matched line-wise, which is fine for them: a
    // prose line starting "Reviewed:" still needs a valid hash, and a stray "Gate-Skip:"
    // fails SAFE (it REDs /ship). Quickstart is the one whose false positive fails OPEN --
    // it exempts -- so a commit message that merely discusses the mechanism at line start
    // must not grant an exemption. This repo's own messages discuss it at length.
    const quickstart = range.commits
      ?.map((sha) =>
        gitTry(["interpret-trailers", "--parse"], {
          root: ROOT,
          input: commitMessage(sha, { root: ROOT }) ?? "",
        }),
      )
      .find((t) => t && /^Quickstart:\s*\S/m.test(t));
    if (quickstart) {
      console.error(
        `[review-gate] /quickstart push — review receipt not required (AC-1.4).\n` +
          `  Recorded on the commit, not in the environment, so it is scoped to this push\n` +
          `  and visible in git history forever. For DISPOSABLE prototype work only.`,
      );
      continue;
    }

    // --- AC-4.1: recorded-ack bypass, loud and permanent.
    const skips = [];
    for (const sha of range.commits) {
      for (const s of parseGateSkips(commitMessage(sha, { root: ROOT }))) {
        if (skipMatchesGate(s, GATE)) skips.push({ ...s, sha });
      }
    }
    if (skips.length > 0) {
      const s = skips[0];
      banner([
        "!!  GATE SKIPPED — review-gate (recorded acknowledgement)  !!",
        "",
        `Reason:   ${s.reason}`,
        `Recorded: Gate-Skip: ${s.raw}`,
        `Commit:   ${s.sha.slice(0, 12)}`,
        "",
        `These ${inScope.length} gated path(s) are being pushed WITHOUT review:`,
        ...inScope.slice(0, 12).map((p) => `  - ${p}`),
        ...(inScope.length > 12 ? [`  ... and ${inScope.length - 12} more`] : []),
        "",
        "This skip is UNADJUDICATED. Record it in docs/findings-register.md",
        "and run /review at the first opportunity (AC-4.1).",
      ]);
      continue;
    }

    // --- AC-1.1 / AC-1.6: collect receipts and check them against the CURRENT content
    // of their own scope, as it exists at the tip being pushed.
    const covered = new Set();
    const stale = [];
    for (const sha of range.commits) {
      for (const r of parseReceipts(commitMessage(sha, { root: ROOT }), "Reviewed")) {
        const v = verifyReceipt(r, { root: ROOT, ref: range.head });
        if (v.valid) {
          if (r.wholeTree) for (const p of inScope) covered.add(p);
          else for (const p of r.scope) covered.add(norm(p, ROOT));
        } else {
          stale.push({ ...r, sha, ...v });
        }
      }
    }

    const missing = inScope.filter((p) => !covered.has(p));
    if (missing.length === 0) continue; // reviewed -> push proceeds

    const staleNote =
      stale.length > 0
        ? `\n  A 'Reviewed:' trailer IS present on ${stale[0].sha.slice(0, 12)} but its tree-sha no ` +
          `longer matches the content it certifies\n` +
          `    receipt: ${stale[0].expected}\n    current: ${stale[0].actual}\n` +
          `  The reviewed paths changed after review (rebase, amend, or a later edit), so the receipt\n` +
          `  self-invalidated rather than certify code nobody saw (AC-1.6). Re-run /review.\n`
        : "";

    console.error(
      `\n[${GATE}] PUSH REJECTED — these changed paths are in the gated review scope and carry no ` +
        `valid review receipt:\n` +
        missing.map((p) => `    ${p}`).join("\n") +
        `\n${staleNote}\n` +
        `  CLAUDE.md makes review BLOCKING for auth files, prisma/schema.prisma, app/api/** and lib/**.\n` +
        `  Fix: run /review (two-stage: spec-compliance, then quality). On a clean review it writes\n` +
        `       Reviewed: <scope> <tree-sha>\n` +
        `  as a git trailer on the commit; this gate reads that trailer. You can compute the value with\n` +
        `       node .claude/hooks/lib/receipt.mjs trailer --key Reviewed ${missing.slice(0, 3).join(" ")}\n` +
        `\n  Deliberate skip (hotfix): add a trailer\n` +
        `       Gate-Skip: ${GATE} <reason>\n` +
        `  to a commit in this push. The push then proceeds with a loud recorded notice, and the skip\n` +
        `  stays visible in git history and must be adjudicated in docs/findings-register.md (AC-4.1).\n`,
    );
    process.exit(1);
  }
} catch (err) {
  failOpen(err);
}
process.exit(0);
