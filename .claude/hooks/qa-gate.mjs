#!/usr/bin/env node
// PreToolUse hook (Bash matcher) -- QA-before-deploy (AC-1.3 / AC-1.4,
// docs/blueprints/sdlc-chain.md). The third link of the receipt chain: /qa emits a
// `QA: <scope> <tree-sha>` trailer, and this gate refuses to let `/deploy` run without it.
//
// Structure, I/O contract and exit conventions mirror blueprint-gate.mjs and
// bash-write-gate.mjs: read the PreToolUse JSON from stdin, print a
// `hookSpecificOutput` object on stdout, always exit 0.
//
// WHAT IT MATCHES: an actual deploy invocation, read off the command. The real ones,
// from .claude/skills/deploy/SKILL.md step 3 and package.json:
//     npm run deploy -- --slug ... (script: `node scripts/deploy.mjs`)
//     node scripts/deploy.mjs ...
//     vercel deploy / vercel --prod / npx vercel --prod
// Deliberately NOT matched:
//   * `git push` — Vercel auto-builds on push, and that is EXACTLY /quickstart's deploy
//     path (skill step 3c). Gating it would break the ~10-minute idea-to-URL promise,
//     which AC-1.4 explicitly protects. The carve-out is therefore structural, not a
//     special case bolted on: /quickstart pushes, it never runs the provisioner.
//   * `prisma migrate deploy` — the word "deploy" in an unrelated verb.
//   * read-only vercel subcommands (env, logs, ls, link, whoami, inspect, ...).
//
// EXPLICIT QUICKSTART ESCAPE (AC-1.4): if /quickstart ever does reach the provisioner,
// `QUICKSTART=1 npm run deploy ...` (or a `--quickstart` flag) is honoured as an
// exemption with an advisory note, so the fast path can never be the thing this gate
// breaks.
//
// AC-4.1/4.2 (recorded ack): `Gate-Skip: qa-gate <reason>` on the HEAD commit ALLOWS the
// deploy and emits a loud, unmissable notice naming the gate and the reason. That is the
// only bypass this gate provides.
//
// AC-1.5 / ADR-047 -- FAIL OPEN. Governance gate, not a security guard: malformed stdin,
// a git failure, a detached/empty repo, any throw at all -> ALLOW, with a warning naming
// this gate. A MISSING RECEIPT still hard-DENIES; "cannot evaluate" and "evaluated, answer
// is no" are different axes. The hard-deny is untiered on purpose (blueprint open question
// "Gate strength on a missing receipt -> hard-deny"; the chain lands on by default for
// every fork like the security floor, decision 16) — unlike blueprint-gate.mjs, which
// tiers because its artifact is cheap to write mid-flight; a QA pass is not.
//
// Per-link backout: one file, one settings.json entry. Remove that entry and this link is
// off with the review gate and every other hook untouched.
import { readFileSync } from "node:fs";
import {
  commitMessage,
  gitTry,
  norm,
  parseGateSkips,
  parseReceipts,
  skipMatchesGate,
  verifyReceipt,
} from "./lib/receipt.mjs";

const GATE = "qa-gate";
const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** PreToolUse "say something, allow anyway" -- the same additionalContext-only contract
 * rules-injection.mjs and the advisory path of blueprint-gate.mjs use. */
function advise(text) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text },
    }),
  );
  process.exit(0);
}

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

// --- deploy-intent detection ------------------------------------------------------

const PKG_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const NODE_RUNNERS = new Set(["node", "nodejs", "npx", "tsx", "ts-node", "bun", "deno"]);
// `vercel` subcommands that do NOT ship code.
const VERCEL_READONLY = new Set([
  "env",
  "logs",
  "log",
  "ls",
  "list",
  "link",
  "unlink",
  "whoami",
  "login",
  "logout",
  "pull",
  "inspect",
  "domains",
  "dns",
  "certs",
  "alias",
  "secrets",
  "teams",
  "switch",
  "projects",
  "project",
  "git",
  "dev",
  "help",
  "init",
  "bisect",
  "telemetry",
  "integration",
]);

/** Strip leading `VAR=val` assignments and `sudo`, returning the real argv. */
function argvOf(seg) {
  const toks = seg.trim().match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  let i = 0;
  while (i < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) || toks[i] === "sudo")) i++;
  return toks.slice(i).map((t) => t.replace(/^["'](.*)["']$/, "$1"));
}

function segmentIsDeploy(seg) {
  if (/\bprisma\b/.test(seg)) return false; // `prisma migrate deploy` is a migration, not a deploy
  const argv = argvOf(seg);
  if (argv.length === 0) return false;
  const verb = argv[0].replace(/^.*\//, "");
  const args = argv.slice(1);

  // node scripts/deploy.mjs ... | npx tsx scripts/deploy.mjs ...
  if (NODE_RUNNERS.has(verb) && args.some((a) => /(^|\/)scripts\/deploy\.mjs$/.test(a)))
    return true;
  // ./scripts/deploy.mjs ...
  if (/(^|\/)scripts\/deploy\.mjs$/.test(argv[0])) return true;

  // npm|pnpm|yarn|bun run deploy [-- ...]  (package.json: "deploy": "node scripts/deploy.mjs")
  if (PKG_RUNNERS.has(verb)) {
    const rest = args.filter((a) => a !== "--" && !a.startsWith("-"));
    if (rest[0] === "run" && rest[1] === "deploy") return true;
    if (verb === "yarn" && rest[0] === "deploy") return true;
  }

  // vercel / npx vercel / vercel@latest
  const vercelAt = argv.findIndex((a) => a.replace(/^.*\//, "") === "vercel" || /^vercel@/.test(a));
  if (vercelAt !== -1) {
    const vargs = argv.slice(vercelAt + 1);
    const sub = vargs.find((a) => !a.startsWith("-"));
    if (vargs.some((a) => a === "--prod" || a === "--production")) return true;
    if (sub === undefined) return true; // bare `vercel` deploys the cwd
    if (VERCEL_READONLY.has(sub)) return false;
    return sub === "deploy" || sub === "redeploy";
  }
  return false;
}

function isDeployCommand(command) {
  return String(command ?? "")
    .split(/\|\||&&|[;|\n]/)
    .some(segmentIsDeploy);
}

const isQuickstartExempt = (command) =>
  /(^|\s)(QUICKSTART|CLAUDE_QUICKSTART)=(1|true)\b/.test(command) ||
  /\s--quickstart\b/.test(command);

// --- main -------------------------------------------------------------------------

let stage = "read-input";
try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if ((input.tool_name ?? "") !== "Bash") process.exit(0);
  const command = input.tool_input?.command ?? "";

  stage = "detect-deploy-intent";
  if (!isDeployCommand(command)) process.exit(0);

  // AC-1.4 -- /quickstart's idea-to-URL path is exempt.
  if (isQuickstartExempt(command)) {
    advise(
      `[${GATE}] ADVISORY — allowed: /quickstart is explicitly exempt from the QA receipt gate ` +
        `(AC-1.4; the ~10-minute idea-to-URL path is preserved). This deploy is NOT QA-verified — ` +
        `run /qa before anyone treats the URL as more than a demo.`,
    );
  }

  stage = "read-HEAD";
  if (gitTry(["rev-parse", "--git-dir"], { root: ROOT }) === null) process.exit(0); // no repo -> allow
  const head = gitTry(["rev-parse", "--verify", "HEAD"], { root: ROOT })?.trim();
  if (!head) process.exit(0); // no commits yet -> nothing to evaluate -> allow
  const message = commitMessage(head, { root: ROOT });

  // AC-4.1 -- recorded-ack bypass, loud and permanent.
  stage = "gate-skip";
  const skip = parseGateSkips(message).find((s) => skipMatchesGate(s, GATE));
  if (skip) {
    advise(
      `\n${"=".repeat(74)}\n` +
        `  !!  GATE SKIPPED — qa-gate (recorded acknowledgement)  !!\n\n` +
        `  Reason:   ${skip.reason}\n` +
        `  Recorded: Gate-Skip: ${skip.raw}\n` +
        `  Commit:   ${head.slice(0, 12)}\n\n` +
        `  This deploy is going out WITHOUT a QA receipt. The skip is UNADJUDICATED:\n` +
        `  record it in docs/findings-register.md and run /qa at the first opportunity (AC-4.1).\n` +
        `${"=".repeat(74)}\n` +
        `Tell the operator this banner appeared, verbatim — a recorded skip that nobody reads is an ` +
        `unrecorded skip.`,
    );
  }

  // AC-1.3 -- require a still-valid QA receipt at HEAD.
  stage = "verify-receipt";
  const receipts = parseReceipts(message, "QA");
  let stale = null;

  // COVERAGE, not mere validity (breadth-review finding). Accepting ANY valid receipt
  // meant a `QA: package.json <sha>` trailer -- a normal artifact, since /qa's own
  // re-run scoping encourages narrow receipts -- unlocked a full production deploy.
  // review-gate already intersects a receipt's scope against what actually changed;
  // this half of the chain did not. A deploy ships the whole app, so the shipping
  // surface here is everything changed since the last commit that carried a QA
  // receipt (no prior QA point -> nothing partial can cover it, so whole-tree only).
  const SHIPS = (p) =>
    !/^(docs|tests|evals)\//.test(p) && !p.startsWith(".claude/") && !p.startsWith(".husky/");
  let shipping = [];
  let prevQaFound = false; // distinct from `shipping.length` -- see below
  try {
    const log = gitTry(["log", "--format=%H%x00%B%x1e", "-n", "200", head], { root: ROOT }) ?? "";
    // TRIM the sha. `--format=...%x1e` appends git's own trailing newline after EVERY
    // record, so splitting on \x1e glues a leading "\n" onto every sha after the first.
    // That malformed sha went straight into `${prevQa}..${head}`, git rejected the range,
    // gitTry swallowed it, and `shipping` came back [] every time a prior QA point existed
    // -- i.e. in normal steady-state use. Combined with the round-2 change from
    // `shipping.length > 0` to `prevQaFound`, that turned an always-DENY bug (safe, merely
    // annoying) into an always-ALLOW one: any syntactically valid narrow receipt shipped
    // anything, silently, with no denial and no audit trail. Validated to hex so a
    // malformed sha can never reach a git range again.
    const HEX = /^[0-9a-f]{7,64}$/;
    const prevQa = log
      .split("\x1e")
      .map((e) => e.split("\x00"))
      .map(([sha, body]) => [(sha ?? "").trim(), body])
      .slice(1)
      .find(([sha, body]) => HEX.test(sha) && body && parseReceipts(body, "QA").length > 0)?.[0];
    if (prevQa) {
      prevQaFound = true;
      shipping = (gitTry(["diff", "--name-only", `${prevQa}..${head}`], { root: ROOT }) ?? "")
        .split("\n")
        .filter(Boolean)
        .filter(SHIPS);
    }
  } catch {
    shipping = []; // cannot determine -> treat as "no prior QA point" (strictest)
  }

  for (const r of receipts) {
    const v = verifyReceipt(r, { root: ROOT, ref: head });
    if (!v.valid) {
      if (!stale) stale = { ...r, ...v };
      continue;
    }
    if (r.wholeTree) process.exit(0); // certifies everything -> covers any deploy
    const covered = new Set(r.scope.map((x) => norm(x, ROOT)));
    const uncovered = shipping.filter((x) => !covered.has(x));
    // `shipping.length === 0` has TWO causes and conflating them denied a legitimate
    // deploy with a false reason: (a) no prior QA point exists -> nothing partial can
    // cover a first deploy, require whole-tree; (b) a prior QA point exists and nothing
    // shipping changed since -> there is nothing left to cover, so allow. Keying on
    // prevQaFound separates them instead of inferring one from the other.
    if (prevQaFound && uncovered.length === 0) process.exit(0);
    const candidate = {
      ...r,
      ...v,
      narrow: true,
      uncovered: uncovered.slice(0, 8),
      noPrevQa: !prevQaFound,
    };
    // Keep the MOST ACTIONABLE diagnostic rather than simply the last one processed: a
    // receipt that misses fewer paths tells the operator more than one that misses all.
    if (
      !stale ||
      !stale.narrow ||
      candidate.uncovered.length < (stale.uncovered?.length ?? Infinity)
    )
      stale = candidate;
  }

  const narrowNote =
    stale && stale.narrow
      ? ` A VALID 'QA:' trailer is present but it certifies only [${stale.scope.join(", ")}], which does ` +
        (stale.noPrevQa
          ? `not cover this deploy: no earlier QA receipt exists in history, so only a whole-tree receipt ` +
            `(QA: . <tree-sha>) can certify a first deploy.`
          : `not cover everything shipping since the last QA'd commit — still uncovered: ` +
            `${stale.uncovered.join(", ")}.`) +
        ` A narrow receipt records a partial re-run; it does not certify the whole app.`
      : "";
  const staleNote = narrowNote
    ? narrowNote
    : stale
      ? ` A 'QA:' trailer IS present but its tree-sha no longer matches the content it certifies ` +
        `(receipt ${stale.expected}, current ${stale.actual}) — the code changed after QA ran, so the ` +
        `receipt self-invalidated instead of certifying untested content (AC-1.6).`
      : "";

  deny(
    `[${GATE}] Denied: this is a deploy invocation and HEAD (${head.slice(0, 12)}) carries no valid ` +
      `QA receipt (AC-1.3).${staleNote}` +
      ` NEXT STEP: run /qa — the three tiers in gated order (design QA -> functional QA -> UAT) against ` +
      `docs/uat-rubric.md. On a clean pass it writes a git trailer\n` +
      `    QA: <scope> <tree-sha>\n` +
      `on the commit, which is what this gate reads; compute the value with\n` +
      `    node .claude/hooks/lib/receipt.mjs trailer --key QA .\n` +
      `EXEMPT: /quickstart's push-to-deploy path is not gated at all (AC-1.4), and an explicit ` +
      `QUICKSTART=1 prefix on this command is honoured.\n` +
      `DELIBERATE SKIP: add a trailer "Gate-Skip: ${GATE} <reason>" to the HEAD commit — the deploy then ` +
      `proceeds with a loud recorded notice that stays in git history and must be adjudicated in ` +
      `docs/findings-register.md (AC-4.1). Do not work around this gate any other way.`,
  );
} catch (err) {
  // AC-1.5 / ADR-047: fail OPEN — a governance gate must never wedge a session. Say which
  // gate failed and where, so a broken gate is self-documenting rather than silently absent.
  try {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext:
            `[${GATE}] WARNING — the QA-before-deploy gate could not evaluate this command ` +
            `(stage: ${stage}; ${err?.message ?? err}) and is ALLOWING it (fail-open, ADR-047 ` +
            `governance-gate posture). QA was NOT verified for this deploy.`,
        },
      }),
    );
  } catch {
    /* even the warning failed — still allow; never brick the session */
  }
}
process.exit(0);
