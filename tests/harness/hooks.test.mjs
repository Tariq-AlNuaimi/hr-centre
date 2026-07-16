// Hook test harness (harness-v2 V2-003). Pipes synthetic hook-input JSON (the real
// PreToolUse / Stop shapes) via stdin to each hook process and asserts its deny / allow /
// block / warn decision — plus the fail-open vs fail-closed behavior on a FORCED internal
// error (malformed stdin). This is the negative-test evidence for V2-001 (bash-write-gate)
// and V2-002 (blueprint Scope-glob hygiene), and the regression net for every gate.
//
// Run: `npm run test:hooks` (also a /ship phase-A check). Mutating any gated hook to
// always-allow turns this suite red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOKS = join(REPO, ".claude", "hooks");

/** Run a hook process with `stdin` (object → JSON, string → raw) and env/cwd overrides. */
function runHook(hookFile, stdin, { cwd = REPO, env = {} } = {}) {
  const input = typeof stdin === "string" ? stdin : JSON.stringify(stdin);
  const res = spawnSync("node", [join(HOOKS, hookFile)], {
    input,
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  let json = null;
  try {
    json = JSON.parse(res.stdout);
  } catch {
    /* many hooks legitimately print nothing */
  }
  const decision = json?.hookSpecificOutput?.permissionDecision ?? json?.decision ?? null;
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", json, decision };
}

const isDeny = (r) => r.decision === "deny";
const isBlock = (r) => r.decision === "block";
const preBash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const preWrite = (file_path) => ({ tool_name: "Write", tool_input: { file_path } });

/** Build a throwaway repo-shaped fixture with docs/blueprints/<name>.md stubs. */
function blueprintFixture(stubs) {
  const dir = mkdtempSync(join(tmpdir(), "hooks-bp-"));
  mkdirSync(join(dir, "docs", "blueprints"), { recursive: true });
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(dir, "docs", "blueprints", name), body);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// V2-001 — bash-write-gate: shell writes hit the same gates as the Write tool.
// ---------------------------------------------------------------------------
test("V2-001 bash-write-gate DENIES a heredoc write to a new uncovered API route", () => {
  const r = runHook(
    "bash-write-gate.mjs",
    preBash("cat > app/api/zzznew/route.ts <<'EOF'\nexport const x = 1;\nEOF"),
  );
  assert.ok(isDeny(r), `expected deny, got ${r.decision} :: ${r.stdout}`);
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /blueprint-gate/);
});

test("V2-001 bash-write-gate ALLOWS a heredoc write once a blueprint covers the path", () => {
  // app/api/openapi/route.ts IS covered by docs/blueprints/openapi-contract-seam.md.
  const r = runHook(
    "bash-write-gate.mjs",
    preBash("cat > app/api/openapi/route.ts <<'EOF'\nexport const x = 1;\nEOF"),
  );
  assert.equal(r.decision, null, `expected allow, got deny :: ${r.stdout}`);
});

test("V2-001 bash-write-gate ALLOWS writes outside gated surfaces", () => {
  assert.equal(
    runHook("bash-write-gate.mjs", preBash("echo hi > /tmp/scratch.txt")).decision,
    null,
  );
  assert.equal(runHook("bash-write-gate.mjs", preBash("ls -la && git status")).decision, null);
});

test("V2-001 bash-write-gate catches tee / cp into gated surfaces", () => {
  const tee = runHook("bash-write-gate.mjs", preBash("echo x | tee app/api/teenew/route.ts"));
  assert.ok(isDeny(tee), `tee should deny :: ${tee.stdout}`);
  const cp = runHook("bash-write-gate.mjs", preBash("cp /tmp/x.ts lib/brandnewcap.ts"));
  assert.ok(isDeny(cp), `cp into lib/ should deny :: ${cp.stdout}`);
  assert.match(cp.json.hookSpecificOutput.permissionDecisionReason, /build-vs-buy/);
});

test("V2-001 bash-write-gate is FAIL-OPEN on a forced internal error (malformed stdin)", () => {
  const r = runHook("bash-write-gate.mjs", "this is not json");
  assert.equal(r.decision, null, "governance gate must allow on error, not deny");
  assert.equal(r.code, 0);
});

test("V2-001 bash-write-gate ignores non-Bash tools", () => {
  assert.equal(runHook("bash-write-gate.mjs", preWrite("app/api/x/route.ts")).decision, null);
});

// ---------------------------------------------------------------------------
// V2-002 — blueprint-gate Scope-glob hygiene (over-broad + expired don't count).
// ---------------------------------------------------------------------------
test("V2-002 an over-broad Scope glob (app/**) does NOT cover a new route", () => {
  const dir = blueprintFixture({ "stub.md": "# stub\nScope: app/**\n" });
  try {
    const r = runHook("blueprint-gate.mjs", preWrite("app/api/widgets/route.ts"), {
      env: { CLAUDE_PROJECT_DIR: dir },
    });
    assert.ok(isDeny(r), `app/** must not cover; expected deny :: ${r.stdout}`);
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /TOO BROAD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("V2-002 a specific Scope glob (app/api/widgets/**) DOES cover the route", () => {
  const dir = blueprintFixture({ "stub.md": "# stub\nScope: app/api/widgets/**\n" });
  try {
    const r = runHook("blueprint-gate.mjs", preWrite("app/api/widgets/route.ts"), {
      env: { CLAUDE_PROJECT_DIR: dir },
    });
    assert.equal(r.decision, null, `specific glob must cover; expected allow :: ${r.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("V2-002 an EXPIRED stub does not cover; a future-dated stub does", () => {
  const expired = blueprintFixture({
    "stub.md": "# stub\nScope: app/api/widgets/**\nExpires: 2020-01-01\n",
  });
  const live = blueprintFixture({
    "stub.md": "# stub\nScope: app/api/widgets/**\nExpires: 2999-01-01\n",
  });
  try {
    const rE = runHook("blueprint-gate.mjs", preWrite("app/api/widgets/route.ts"), {
      env: { CLAUDE_PROJECT_DIR: expired },
    });
    assert.ok(isDeny(rE), `expired stub must not cover :: ${rE.stdout}`);
    assert.match(rE.json.hookSpecificOutput.permissionDecisionReason, /EXPIRED/);
    const rL = runHook("blueprint-gate.mjs", preWrite("app/api/widgets/route.ts"), {
      env: { CLAUDE_PROJECT_DIR: live },
    });
    assert.equal(rL.decision, null, `future-dated stub must cover :: ${rL.stdout}`);
  } finally {
    rmSync(expired, { recursive: true, force: true });
    rmSync(live, { recursive: true, force: true });
  }
});

test("V2-002 existing repo blueprints still cover their real routes (grandfathered)", () => {
  // openapi-contract-seam.md → app/api/openapi/route.ts must still pass.
  const r = runHook("blueprint-gate.mjs", preWrite("app/api/openapi/route.ts"));
  assert.equal(r.decision, null, `grandfathered blueprint must still cover :: ${r.stdout}`);
});

test("V2-002 blueprint-gate is FAIL-OPEN on malformed stdin", () => {
  const r = runHook("blueprint-gate.mjs", "garbage");
  assert.equal(r.decision, null);
  assert.equal(r.code, 0);
});

// ---------------------------------------------------------------------------
// build-vs-buy-gate — deny + allow paths (unchanged behavior, regression net).
// ---------------------------------------------------------------------------
test("build-vs-buy-gate DENIES a new uncovered lib/ capability, ALLOWS excluded dirs", () => {
  const deny = runHook("build-vs-buy-gate.mjs", preWrite("lib/brandnewcap.ts"));
  assert.ok(isDeny(deny), `new lib/ file should deny :: ${deny.stdout}`);
  // lib/validations/** is an expected-hand-written exclusion → allow.
  const allow = runHook("build-vs-buy-gate.mjs", preWrite("lib/validations/brandnew.ts"));
  assert.equal(allow.decision, null, `lib/validations exclusion should allow :: ${allow.stdout}`);
});

// ---------------------------------------------------------------------------
// dangerous-commands — FAIL-CLOSED security guard (must deny, incl. on error).
// ---------------------------------------------------------------------------
test("dangerous-commands DENIES rm -rf and ALLOWS a benign command", () => {
  assert.ok(isDeny(runHook("dangerous-commands.mjs", preBash("rm -rf /"))), "rm -rf must deny");
  assert.equal(runHook("dangerous-commands.mjs", preBash("ls -la")).decision, null);
});

test("dangerous-commands is FAIL-CLOSED on a forced internal error (malformed stdin)", () => {
  const r = runHook("dangerous-commands.mjs", "not json at all");
  assert.ok(isDeny(r), `security guard must deny on error :: ${r.stdout}`);
});

// ---------------------------------------------------------------------------
// protect-secrets — FAIL-CLOSED security guard.
// ---------------------------------------------------------------------------
test("protect-secrets DENIES reading .env and printing a Restricted env var", () => {
  assert.ok(isDeny(runHook("protect-secrets.mjs", preBash("cat .env"))), "cat .env must deny");
  assert.ok(
    isDeny(runHook("protect-secrets.mjs", preBash("printenv AUTH_SECRET"))),
    "printenv AUTH_SECRET must deny",
  );
});

test("protect-secrets ALLOWS a normal read and is FAIL-CLOSED on malformed stdin", () => {
  assert.equal(runHook("protect-secrets.mjs", preBash("cat README.md")).decision, null);
  assert.ok(isDeny(runHook("protect-secrets.mjs", "broken")), "must deny on error");
});

// ---------------------------------------------------------------------------
// session-stop — block-once semantics (unpushed commits block exactly once).
// ---------------------------------------------------------------------------
test("session-stop BLOCKS on unpushed commits but only when not already stop-active", () => {
  const dir = mkdtempSync(join(tmpdir(), "hooks-git-"));
  try {
    const g = (a) => execSync(`git ${a}`, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] });
    g("init -q");
    g("-c user.email=t@t.t -c user.name=t commit -q --allow-empty -m init");
    // No upstream → 1 local commit is unpushed → a blocker.
    const first = runHook(
      "session-stop.mjs",
      { stop_hook_active: false, session_id: "x" },
      { cwd: dir },
    );
    assert.ok(isBlock(first), `first stop must block on unpushed work :: ${first.stdout}`);
    // Same state, but stop_hook_active → must NOT block again (block-once).
    const again = runHook(
      "session-stop.mjs",
      { stop_hook_active: true, session_id: "x" },
      { cwd: dir },
    );
    assert.ok(!isBlock(again), `second stop must not re-block (block-once) :: ${again.stdout}`);
    assert.equal(again.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Smoke: EVERY hook survives a benign input and malformed stdin without crashing
// (exit 0), so a broken hook can't silently brick a session.
// ---------------------------------------------------------------------------
test("every .mjs hook exits 0 on benign input and on malformed stdin", () => {
  const failClosed = new Set(["dangerous-commands.mjs", "protect-secrets.mjs"]);
  for (const f of readdirSync(HOOKS).filter((n) => n.endsWith(".mjs"))) {
    const benign = runHook(f, preBash("echo hello"));
    assert.equal(benign.code, 0, `${f} should exit 0 on benign input`);
    const garbage = runHook(f, "definitely not json");
    assert.equal(garbage.code, 0, `${f} should exit 0 on malformed stdin`);
    if (!failClosed.has(f)) {
      assert.ok(!isDeny(garbage), `${f} is governance/observability → must not deny on error`);
    }
  }
});
