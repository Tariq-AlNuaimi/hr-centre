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
  for (const r of receipts) {
    const v = verifyReceipt(r, { root: ROOT, ref: head });
    if (v.valid) process.exit(0); // QA'd -> deploy proceeds
    stale = { ...r, ...v };
  }

  const staleNote = stale
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
