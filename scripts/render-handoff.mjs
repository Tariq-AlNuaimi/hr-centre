#!/usr/bin/env node
// render-handoff.mjs -- Part 1 of session-automation (blueprint:
// docs/blueprints/session-automation-auto-handoff.md).
//
// docs/session-state.json is the single source of truth for program status.
// This script renders it into the machine-owned sections of
// docs/SESSION-HANDOFF.md -- the compact "IN PROGRESS / REMAINING" cut and the
// full GRAND PROGRESS TABLE -- so those tables can never drift from the data or
// partially load. The markdown is a VIEW; the JSON is the source.
//
// Marked-region merge: only the block between the auto markers is regenerated.
// Everything outside (operator prose: goal, lessons, landmines, senior-review
// notes) is left byte-for-byte intact -- the blueprint's "never auto-overwrite
// the operator's prose notes" invariant.
//
// Usage:
//   node scripts/render-handoff.mjs            # rewrite the handoff in place
//   node scripts/render-handoff.mjs --stdout   # print the rendered block only
//   node scripts/render-handoff.mjs --check    # exit 1 if the file is stale vs state
//
// Fail-open by contract: any error exits 0 in the default (write) path when
// invoked from a hook via RENDER_HANDOFF_SOFT=1, so a hook can never trap the
// agent. Direct CLI / --check runs surface errors normally.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR
  ? process.env.CLAUDE_PROJECT_DIR
  : join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, "docs", "session-state.json");
const HANDOFF = join(ROOT, "docs", "SESSION-HANDOFF.md");
const BEGIN = "<!-- BEGIN:auto-status (rendered by scripts/render-handoff.mjs from docs/session-state.json -- do not hand-edit) -->";
const END = "<!-- END:auto-status -->";

const soft = process.env.RENDER_HANDOFF_SOFT === "1";
const mode = process.argv.includes("--stdout")
  ? "stdout"
  : process.argv.includes("--check")
  ? "check"
  : "write";

function fail(msg, code = 1) {
  if (soft && mode === "write") process.exit(0); // hooks must never trap the agent
  process.stderr.write(`[render-handoff] ${msg}\n`);
  process.exit(code);
}

const STATE_MARK = { done: "[x]", partial: "[~]", remaining: "[ ]", deferred: "[-]", dropped: "[-]" };
const STATE_ICON = { "in-progress": "IN PROGRESS", remaining: "REMAINING", done: "DONE" };

function cell(v) {
  // Escape pipes so free-text notes can't break the table grid.
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function render(state) {
  const L = [];
  L.push(BEGIN);
  L.push("");
  L.push("## At-a-glance — IN PROGRESS / REMAINING (the fast status read)");
  L.push("");
  L.push(`_Program: **${cell(state.program)}** · branch \`${cell(state.branch)}\` · updated ${cell(state.updated)} · last /ship: **${cell(state.lastShip?.status)}** (${cell(state.lastShip?.sha)}, ${cell(state.lastShip?.date)})._`);
  L.push("");
  L.push("| State | Item | Blocked by | Next action |");
  L.push("|-------|------|-----------|-------------|");
  for (const r of state.inProgress ?? []) {
    const icon = r.state === "in-progress" ? "🟡" : r.state === "done" ? "✅" : "⬜";
    const label = STATE_ICON[r.state] ?? r.state.toUpperCase();
    L.push(`| ${icon} ${label} | **${cell(r.item)}** ${cell(r.title)} | ${cell(r.blockedBy) || "—"} | ${cell(r.next)} |`);
  }
  L.push("");
  L.push("## GRAND PROGRESS TABLE (built from docs/session-state.json)");
  L.push("");
  L.push("Legend: `[x]` done · `[~]` partial · `[ ]` pending · `[-]` deferred/dropped.");
  L.push("");
  L.push("**5 operator directives**");
  L.push("");
  L.push("| Item | Status | Commit / note |");
  L.push("|------|--------|---------------|");
  for (const d of state.directives ?? [])
    L.push(`| ${cell(d.id)} — ${cell(d.title)} | ${STATE_MARK[d.status] ?? d.status} | ${cell(d.commit || d.note || d.date)} |`);
  L.push("");
  L.push("**Workstreams (Phase0 / C1–C4 / B / E / D / A1–A5)**");
  L.push("");
  L.push("| Item | Status | Commit / note |");
  L.push("|------|--------|---------------|");
  for (const w of state.workstreams ?? []) {
    const meta = [w.commit, w.date, w.note].filter(Boolean).join(" · ");
    L.push(`| ${cell(w.id)} — ${cell(w.title)} | ${STATE_MARK[w.status] ?? w.status} | ${cell(meta)} |`);
  }
  L.push("");
  L.push("**22 comparison categories (directive D1 coverage)**");
  L.push("");
  L.push("| Cat | Status | Where |");
  L.push("|-----|--------|-------|");
  for (const c of state.categories ?? [])
    L.push(`| ${cell(c.id)} ${cell(c.title)} | ${STATE_MARK[c.status] ?? c.status} | ${cell(c.where)} |`);
  if ((state.deferred ?? []).length) {
    L.push("");
    L.push("**Deferred (tracked, not scheduled — see the program blueprint's closeout TODO)**");
    L.push("");
    for (const df of state.deferred)
      L.push(`- \`${cell(df.id)}\` — ${cell(df.title)}${df.trigger ? ` — trigger: ${cell(df.trigger)}` : ""}`);
  }
  if ((state.nextActions ?? []).length) {
    L.push("");
    L.push("**Next actions**");
    L.push("");
    state.nextActions.forEach((a, i) => L.push(`${i + 1}. ${cell(a)}`));
  }
  L.push("");
  L.push(END);
  return L.join("\n");
}

let state;
try {
  state = JSON.parse(readFileSync(STATE, "utf8"));
} catch (e) {
  fail(`cannot read/parse ${STATE}: ${e.message}`);
}

const block = render(state);

if (mode === "stdout") {
  process.stdout.write(block + "\n");
  process.exit(0);
}

let doc = existsSync(HANDOFF) ? readFileSync(HANDOFF, "utf8") : "";
let next;
const bi = doc.indexOf(BEGIN);
const ei = doc.indexOf(END);
if (bi !== -1 && ei !== -1 && ei > bi) {
  next = doc.slice(0, bi) + block + doc.slice(ei + END.length);
} else if (doc) {
  // No markers yet: insert the block right after the first H1 title line.
  const nl = doc.indexOf("\n");
  const head = nl === -1 ? doc : doc.slice(0, nl + 1);
  const rest = nl === -1 ? "" : doc.slice(nl + 1);
  next = head + "\n" + block + "\n" + rest;
} else {
  next = `# Session handoff — ${cell(state.updated)}\n\n${block}\n`;
}

if (mode === "check") {
  if (next !== doc) fail("SESSION-HANDOFF.md is stale vs docs/session-state.json — run: node scripts/render-handoff.mjs", 1);
  process.stdout.write("[render-handoff] handoff is in sync with session-state.json\n");
  process.exit(0);
}

if (next !== doc) {
  writeFileSync(HANDOFF, next);
  process.stderr.write("[render-handoff] SESSION-HANDOFF.md re-rendered from docs/session-state.json\n");
}
process.exit(0);
