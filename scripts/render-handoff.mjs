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

const ROOT =
  process.env.CLAUDE_PROJECT_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), "..");
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
  // Neutralize anything in free-text data that could break the render:
  //  - `|` would split a markdown table cell,
  //  - `<`/`>` could smuggle an HTML comment (`<!-- ... -->`) into the output; if a
  //    data field contained the literal END/BEGIN sentinel, the NEXT run's marker
  //    search would latch onto the injected copy and corrupt the file. Escaping to
  //    entities renders identically but can never form a comment marker.
  return String(v ?? "")
    .replace(/\|/g, "\\|")
    // Neutralize ONLY the HTML-comment sentinels so a data field can never open or
    // close an auto-status marker; normal '<', '>', and '->' arrows are preserved
    // (they read cleaner in the raw table agents/humans skim).
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .replace(/\n+/g, " ")
    .trim();
}

function countSubstr(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
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

// Self-check: the generated block must contain exactly one well-formed marker pair.
// (render() adds them once and cell() can't emit them, so this only ever trips on a
// code regression — fail loudly rather than write a self-corrupting file.)
if (countSubstr(block, BEGIN) !== 1 || countSubstr(block, END) !== 1) {
  fail("internal error: rendered block does not contain exactly one BEGIN/END pair", 1);
}

if (mode === "stdout") {
  process.stdout.write(block + "\n");
  process.exit(0);
}

let doc = existsSync(HANDOFF) ? readFileSync(HANDOFF, "utf8") : "";
const nBegin = countSubstr(doc, BEGIN);
const nEnd = countSubstr(doc, END);
const bi = doc.indexOf(BEGIN);
const ei = doc.indexOf(END);
let next;
if (nBegin === 1 && nEnd === 1 && ei > bi) {
  // Exactly one well-formed pair: replace the region in place.
  next = doc.slice(0, bi) + block + doc.slice(ei + END.length);
} else if (nBegin === 0 && nEnd === 0 && doc) {
  // No markers yet (first render into an existing handoff): insert after the H1.
  const nl = doc.indexOf("\n");
  const head = nl === -1 ? doc : doc.slice(0, nl + 1);
  const rest = nl === -1 ? "" : doc.slice(nl + 1);
  next = head + "\n" + block + "\n" + rest;
} else if (!doc) {
  // No file at all: create a minimal one.
  next = `# Session handoff — ${cell(state.updated)}\n\n${block}\n`;
} else {
  // Malformed markers (duplicated, reversed, or half-present) — REFUSE to write
  // rather than silently insert a second block and permanently corrupt the file.
  // This is the corruption the merge must never cause; a human fixes the markers.
  fail(
    `refusing to render: SESSION-HANDOFF.md has malformed auto-status markers ` +
      `(${nBegin} BEGIN, ${nEnd} END${ei !== -1 && bi !== -1 && ei < bi ? ", END before BEGIN" : ""}). ` +
      `Fix so there is exactly one BEGIN before one END, then re-run.`,
    1,
  );
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
