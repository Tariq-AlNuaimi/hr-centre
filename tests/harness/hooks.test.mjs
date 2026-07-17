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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
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

/** Build a throwaway repo-shaped fixture with a docs/build-vs-buy-ledger.md body (V2-309). */
function ledgerFixture(body) {
  const dir = mkdtempSync(join(tmpdir(), "hooks-ledger-"));
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "build-vs-buy-ledger.md"), body);
  return dir;
}
/** Run the build-vs-buy gate for a Write, rooted at a fixture dir. */
const runBvbAt = (dir, file) =>
  runHook("build-vs-buy-gate.mjs", preWrite(file), { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });

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

test("V2-001 bash-write-gate ALLOWS edits to EXISTING gated files (overwrite = continuation)", () => {
  // Mirrors the Write-tool gates' existsSync exemption: sed -i / tee on already-shipped
  // gated files must NOT be denied (they aren't NEW feature/capability files).
  const route = runHook("bash-write-gate.mjs", preBash("sed -i s/a/b/ app/api/health/route.ts"));
  assert.equal(route.decision, null, `edit to existing route must allow :: ${route.stdout}`);
  const lib = runHook("bash-write-gate.mjs", preBash("sed -i s/a/b/ lib/api-helpers.ts"));
  assert.equal(lib.decision, null, `edit to existing lib file must allow :: ${lib.stdout}`);
  // A NEW (nonexistent) uncovered file still denies.
  const neu = runHook("bash-write-gate.mjs", preBash("sed -i s/a/b/ app/api/brandnewzzz/route.ts"));
  assert.ok(isDeny(neu), `new uncovered route must still deny :: ${neu.stdout}`);
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

// V2-309: the gated surface extends to components/shared/** + scripts/**, and a covering
// ledger entry must carry a "Considered:" line (a bare Scope is a rubber stamp, not a scan).
test("V2-309 build-vs-buy-gate gates components/shared + scripts and requires a Considered: line", () => {
  const empty = ledgerFixture("# Build-vs-Buy Ledger\n");
  // (a) a NEW reusable primitive / harness tool on the widened surface → DENY.
  assert.ok(
    isDeny(runBvbAt(empty, "components/shared/NewPrimitive.tsx")),
    "new components/shared primitive must deny",
  );
  assert.ok(isDeny(runBvbAt(empty, "scripts/new-tool.mjs")), "new scripts tool must deny");
  // (b) a SPECIFIC covering entry WITH a Considered: line → ALLOW.
  const good = ledgerFixture(
    "# Ledger\n\nScope: components/shared/NewPrimitive.tsx\nConsidered: shadcn blocks vs a headless kit vs build.\nDecision: build.\n",
  );
  assert.equal(
    runBvbAt(good, "components/shared/NewPrimitive.tsx").decision,
    null,
    "a specific Considered-bearing entry must allow",
  );
  // (c) a SPECIFIC Scope with NO Considered: line → DENY, and the reason names Considered:.
  const bare = ledgerFixture("# Ledger\n\nScope: scripts/new-tool.mjs\nDecision: build.\n");
  const denyBare = runBvbAt(bare, "scripts/new-tool.mjs");
  assert.ok(isDeny(denyBare), "a Scope without a Considered: line must deny");
  assert.match(denyBare.json.hookSpecificOutput.permissionDecisionReason, /Considered/);
  // (d) an OVER-BROAD Scope (even WITH a Considered: line) → DENY (V2-309 hygiene): a
  // fork-wide "scripts/**" entry is a rubber stamp, not a decision for a specific file.
  const broad = ledgerFixture(
    "# Ledger\n\nScope: scripts/**\nConsidered: a vs b.\nDecision: build.\n",
  );
  const denyBroad = runBvbAt(broad, "scripts/new-tool.mjs");
  assert.ok(isDeny(denyBroad), "a too-broad Scope must not count as coverage");
  assert.match(denyBroad.json.hookSpecificOutput.permissionDecisionReason, /BROAD|SPECIFIC/);
  // (e) a test file on the new surface is excluded → ALLOW.
  assert.equal(
    runBvbAt(empty, "scripts/foo.test.mjs").decision,
    null,
    "a .test file on the new surface must be excluded",
  );
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

// V2-408 — WRITE side: real secret material must not land in a tracked/committable file.
// The secret-shaped strings are ASSEMBLED at runtime so this test source carries no literal
// token (the hook now scans Write/Edit payloads — a literal here would deny its own write).
const preWriteBody = (file_path, content) => ({
  tool_name: "Write",
  tool_input: { file_path, content },
});
const preEditBody = (file_path, new_string) => ({
  tool_name: "Edit",
  tool_input: { file_path, new_string },
});
const ANT_KEY = "sk-ant-" + "api03-" + "A".repeat(40); // a real-shaped Anthropic key
const REAL_DB = "postgresql://app:" + "Zx9Qp2mVrkLs" + "@ep-cool-hill.neon.tech/app_db";

test("protect-secrets (V2-408) DENIES real secret material written to a tracked file", () => {
  assert.ok(
    isDeny(
      runHook(
        "protect-secrets.mjs",
        preWriteBody("lib/config.ts", `export const K = "${ANT_KEY}";`),
      ),
    ),
    "an Anthropic key in a lib file must deny",
  );
  assert.ok(
    isDeny(runHook("protect-secrets.mjs", preEditBody("docs/notes.md", `DATABASE_URL=${REAL_DB}`))),
    "a real DATABASE_URL edited into a doc must deny",
  );
  // .env.example is tracked → a REAL secret there is still denied (it must stay placeholder-only).
  assert.ok(
    isDeny(
      runHook("protect-secrets.mjs", preWriteBody(".env.example", `ANTHROPIC_API_KEY=${ANT_KEY}`)),
    ),
    "a real key in .env.example must deny",
  );
});

test("protect-secrets (V2-408) ALLOWS placeholders, the gitignored .env store, and clean source", () => {
  // .env.example placeholder shapes (the vocabulary the file actually uses) pass.
  const placeholders =
    'DATABASE_URL="postgresql://user:password@localhost:5432/app_db"\n' +
    'AUTH_SECRET="generate-with-openssl-rand-base64-32"';
  assert.equal(
    runHook("protect-secrets.mjs", preWriteBody(".env.example", placeholders)).decision,
    null,
  );
  // The live gitignored secret store is EXEMPT — real secrets belong there.
  assert.equal(
    runHook("protect-secrets.mjs", preWriteBody(".env", `DATABASE_URL=${REAL_DB}`)).decision,
    null,
  );
  assert.equal(
    runHook("protect-secrets.mjs", preWriteBody(".env.local", `DATABASE_URL=${REAL_DB}`)).decision,
    null,
  );
  // Ordinary source with no secret passes.
  assert.equal(
    runHook(
      "protect-secrets.mjs",
      preWriteBody("lib/util.ts", "export const add = (a, b) => a + b;"),
    ).decision,
    null,
  );
});

// V2-408 senior-review fixes — three verified bypasses of the write-side guard, now closed.
// `>` is assembled from a variable so this test source carries no literal `> path` (the
// SEPARATE bash-write-gate would otherwise flag the string).
const R = ">";
const preMultiEdit = (file_path, new_string) => ({
  tool_name: "MultiEdit",
  tool_input: { file_path, edits: [{ old_string: "x", new_string }] },
});

test("protect-secrets (V2-408 fix) DENIES a Bash WRITE of secret material to a tracked file", () => {
  // Heredoc, echo-append, tee, and sed -i are all shell write vectors that used to bypass the
  // guard (only Write/Edit were scanned). Dropping to Bash must not bypass it.
  assert.ok(
    isDeny(
      runHook("protect-secrets.mjs", preBash(`cat ${R} lib/leaked.ts <<EOF\nK="${ANT_KEY}"\nEOF`)),
    ),
    "heredoc write of a secret must deny",
  );
  assert.ok(
    isDeny(
      runHook(
        "protect-secrets.mjs",
        preBash(`echo "ANTHROPIC_API_KEY=${ANT_KEY}" ${R}${R} .env.production`),
      ),
    ),
    "echo-append of a secret to a tracked .env.production must deny",
  );
  assert.ok(
    isDeny(runHook("protect-secrets.mjs", preBash(`echo "${ANT_KEY}" | tee lib/x.ts`))),
    "echo | tee of a secret must deny",
  );
  // A shell write of a real secret to the gitignored live store is still exempt.
  assert.equal(
    runHook("protect-secrets.mjs", preBash(`echo "ANTHROPIC_API_KEY=${ANT_KEY}" ${R} .env`))
      .decision,
    null,
    "writing a secret to the live .env store stays allowed",
  );
  // A clean shell write passes.
  assert.equal(runHook("protect-secrets.mjs", preBash(`echo hi ${R} lib/util.ts`)).decision, null);
});

test("protect-secrets (V2-408 fix) DENIES a MultiEdit that inserts secret material", () => {
  assert.ok(
    isDeny(
      runHook("protect-secrets.mjs", preMultiEdit("lib/config.ts", `const K = "${ANT_KEY}";`)),
    ),
    "a secret in a MultiEdit new_string must deny",
  );
  assert.equal(
    runHook("protect-secrets.mjs", preMultiEdit("lib/config.ts", "const N = 1;")).decision,
    null,
    "a clean MultiEdit passes",
  );
});

test("protect-secrets (V2-408 fix) exemption matches .gitignore, not any .env.*", () => {
  // .env.production / .env.staging / an adversarial x/.env.example.ts are TRACKED (not in
  // .gitignore's `.env`, `.env.local`, `.env.*.local`) — a real secret there must be denied.
  for (const p of [".env.production", ".env.staging", "x/.env.example.ts", "notes/.env.docs.md"]) {
    assert.ok(
      isDeny(runHook("protect-secrets.mjs", preWriteBody(p, `ANTHROPIC_API_KEY=${ANT_KEY}`))),
      `${p} is tracked — a real secret there must deny`,
    );
  }
  // Only the genuinely-gitignored names are exempt.
  for (const p of [".env", ".env.local", ".env.production.local"]) {
    assert.equal(
      runHook("protect-secrets.mjs", preWriteBody(p, `ANTHROPIC_API_KEY=${ANT_KEY}`)).decision,
      null,
      `${p} is gitignored — exempt`,
    );
  }
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
// V2-107 — git branch force-delete guard (senior-review High): the safe `-d` is allowed,
// every force-delete flag combination is denied by dangerous-commands.mjs.
// ---------------------------------------------------------------------------
test("V2-107 dangerous-commands allows safe `git branch -d` but DENIES every force-delete combo", () => {
  const allow = ["git branch -d feature", "git branch --delete feature", "git branch feature"];
  const deny = [
    "git branch -D feature",
    "git branch -d -f feature",
    "git branch -d --force feature",
    "git branch --delete --force feature",
    "git branch -Df feature",
    "git branch -fd feature",
    "git branch -f -d feature",
  ];
  for (const c of allow)
    assert.equal(
      runHook("dangerous-commands.mjs", preBash(c)).decision,
      null,
      `should ALLOW: ${c}`,
    );
  for (const c of deny) {
    const r = runHook("dangerous-commands.mjs", preBash(c));
    assert.ok(isDeny(r), `should DENY force-delete: ${c} :: ${r.stdout}`);
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /force-delete/);
  }
});

// ---------------------------------------------------------------------------
// V2-102 — agent-memory retrieval-on-demand: digest present + budgets + lookup.
// ---------------------------------------------------------------------------
test("V2-102 agent-memory has a digest block and passes the budget check (--strict)", () => {
  const mem = readFileSync(join(REPO, "docs", "agent-memory.md"), "utf8");
  assert.match(mem, /<!-- BEGIN:digest[\s\S]*<!-- END:digest/, "digest block must exist");
  const res = spawnSync("node", [join(REPO, "scripts", "memory-digest.mjs"), "--strict"], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `memory-digest --strict must pass on the real file:\n${res.stdout}`);
});

test("V2-102 a full section is retrievable on demand (grep by heading)", () => {
  const mem = readFileSync(join(REPO, "docs", "agent-memory.md"), "utf8");
  // A digest line names 'gitleaks'; the full fact lives in a `## Gotchas —` section, not the digest.
  const afterDigest = mem.split("<!-- END:digest -->")[1] ?? "";
  assert.match(afterDigest, /## Gotchas — deploy, env & CI/, "themed section heading must exist");
  assert.match(
    afterDigest,
    /gitleaks is NOT preinstalled/,
    "full gotcha text retrievable below the digest",
  );
});

test("V2-102 memory-digest --strict FAILS on a fixture with an over-budget section", () => {
  const dir = mkdtempSync(join(tmpdir(), "hooks-mem-"));
  try {
    const bigSection = ["## Gotchas — huge", ""].concat(
      Array.from({ length: 70 }, (_, i) => `- 2026-01-01 — filler entry ${i}`),
    );
    const fixture = [
      "# mem",
      "<!-- BEGIN:digest -->",
      "## Digest",
      "- **Gotchas — huge** (70): filler",
      "<!-- END:digest -->",
      "",
      ...bigSection,
    ].join("\n");
    const file = join(dir, "agent-memory.md");
    writeFileSync(file, fixture);
    const res = spawnSync("node", [join(REPO, "scripts", "memory-digest.mjs"), "--strict"], {
      cwd: REPO,
      env: { ...process.env, MEMORY_FILE: file },
      encoding: "utf8",
    });
    assert.equal(res.status, 1, `a 71-line section must breach the 60-line budget:\n${res.stdout}`);
    assert.match(res.stdout, /60/, "warning should cite the section budget");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// V2-103 — velocity pillar checks fire on synthetic regressions.
//   (a) context-size: the V2-101 "context-tax --strict FAILS on over-budget" test above IS this
//       check. (b) /ship wall-time: demonstrated by a captured low-baseline run (evidence file).
//       (c) hook-latency: below.
// ---------------------------------------------------------------------------
test("V2-103 hook-latency --strict FAILS when the chain exceeds the baseline (synthetic 1ms)", () => {
  const res = spawnSync("node", [join(REPO, "scripts", "hook-latency.mjs"), "--strict"], {
    cwd: REPO,
    env: { ...process.env, HOOK_CHAIN_BASELINE_MS: "1" }, // real chain (~600ms) >> 150% of 1ms
    encoding: "utf8",
  });
  assert.equal(res.status, 1, `a 1ms baseline must trip the latency warn:\n${res.stdout}`);
  assert.match(res.stdout, /WARN: worst turn/, "should print the latency warning");
});

test("V2-103 hook-latency passes with a generous baseline", () => {
  const res = spawnSync("node", [join(REPO, "scripts", "hook-latency.mjs"), "--strict"], {
    cwd: REPO,
    env: { ...process.env, HOOK_CHAIN_BASELINE_MS: "100000" },
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `a huge baseline must pass:\n${res.stdout}`);
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

// ---------------------------------------------------------------------------
// V2-101 — rules-injection: path-lazy rule files load on a matching edit, and the
// constitution/total context-tax budgets hold.
// ---------------------------------------------------------------------------
const preEdit = (file_path) => ({ tool_name: "Edit", tool_input: { file_path } });
const injectedContext = (r) => r.json?.hookSpecificOutput?.additionalContext ?? "";

test("V2-101 rules-injection surfaces prisma.md when editing a prisma path", () => {
  const r = runHook("rules-injection.mjs", preEdit("prisma/schema.prisma"));
  const ctx = injectedContext(r);
  assert.match(ctx, /\.claude\/rules\/prisma\.md/, `expected prisma.md, got: ${ctx.slice(0, 120)}`);
  assert.match(ctx, /SCRUB_FIELDS/, "prisma rule body must be present");
});

test("V2-101 rules-injection surfaces api-routes.md when editing an API route", () => {
  const ctx = injectedContext(runHook("rules-injection.mjs", preEdit("app/api/widgets/route.ts")));
  assert.match(ctx, /\.claude\/rules\/api-routes\.md/);
  assert.match(ctx, /withRateLimit/, "auth-wrapper detail must be present");
});

test("V2-101 rules-injection surfaces design.md when editing a component", () => {
  const ctx = injectedContext(runHook("rules-injection.mjs", preEdit("components/shared/Foo.tsx")));
  assert.match(ctx, /\.claude\/rules\/design\.md/);
});

test("V2-101 rules-injection injects NOTHING for a non-matching path", () => {
  const r = runHook("rules-injection.mjs", preEdit("README.md"));
  assert.equal(injectedContext(r), "", "README.md matches no rule glob → no injection");
  assert.equal(r.code, 0);
});

test("V2-101 rules-injection ignores non-edit tools (e.g. Bash)", () => {
  const r = runHook("rules-injection.mjs", preBash("echo hi"));
  assert.equal(injectedContext(r), "");
  assert.equal(r.code, 0);
});

test("V2-101 context-tax: constitution ≤8KB AND total always-on ≤20KB (--strict passes)", () => {
  const res = spawnSync("node", [join(REPO, "scripts", "context-tax.mjs"), "--strict"], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `context-tax --strict must pass:\n${res.stdout}`);
});

test("V2-101 rules-injection covers the high-blast-radius lib/ + middleware files (senior-review fix)", () => {
  // These files are named in the rule files' own Ask-before/traps; their globs must match them.
  const cases = [
    ["lib/api-helpers.ts", /api-routes\.md/],
    ["lib/rate-limit.ts", /api-routes\.md/],
    ["lib/auth.ts", /api-routes\.md/],
    ["middleware.ts", /api-routes\.md/],
    ["lib/email.ts", /deploy\.md/],
    ["lib/export.ts", /deploy\.md/],
  ];
  for (const [file, re] of cases) {
    const ctx = injectedContext(runHook("rules-injection.mjs", preEdit(file)));
    assert.match(ctx, re, `${file} must inject a rule matching ${re}`);
  }
});

test("V2-101 every .claude/rules/*.md has a parseable frontmatter glob that matches ≥1 real path", () => {
  // Guards deploy/ai/harness (previously untested) against a broken frontmatter silently
  // disabling their lazy-load. Representative path per rule file.
  const reps = {
    "prisma.md": "prisma/schema.prisma",
    "api-routes.md": "app/api/x/route.ts",
    "design.md": "components/shared/Foo.tsx",
    "deploy.md": "vercel.json",
    "ai.md": "lib/ai/index.ts",
    "harness.md": "scripts/ship.mjs",
  };
  for (const [name, path] of Object.entries(reps)) {
    const ctx = injectedContext(runHook("rules-injection.mjs", preEdit(path)));
    assert.match(ctx, new RegExp(name.replace(".", "\\.")), `${name} must inject on ${path}`);
  }
});

test("V2-101 rule migration preserved every ADR referenced by the old constitution", () => {
  // Mechanical ADR-\d+ set-diff old CLAUDE.md → new CLAUDE.md + rules (senior-review fix:
  // a hand-picked keyword list missed ADR-020/048).
  const oldClaude = execSync("git show b265104^:CLAUDE.md", { cwd: REPO, encoding: "utf8" });
  const newAll =
    readFileSync(join(REPO, "CLAUDE.md"), "utf8") +
    readdirSync(join(REPO, ".claude", "rules"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(join(REPO, ".claude", "rules", f), "utf8"))
      .join("\n");
  const adrs = (s) => new Set(s.match(/ADR-\d+/g) || []);
  const oldAdrs = adrs(oldClaude);
  const newAdrs = adrs(newAll);
  const missing = [...oldAdrs].filter((a) => !newAdrs.has(a));
  assert.deepEqual(missing, [], `ADRs dropped in the split: ${missing.join(", ")}`);
});

test("V2-101 context-tax --strict FAILS when a fixture constitution blows the 8KB budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "hooks-tax-"));
  try {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "CLAUDE.md"), "x".repeat(9000)); // 9000B > 8192 budget
    const res = spawnSync("node", [join(REPO, "scripts", "context-tax.mjs"), "--strict"], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
    assert.equal(res.status, 1, `over-budget constitution must fail --strict:\n${res.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── V2-105 /fan-out enforcement helper (ADR-057, custom verdict) ─────────────────
const fanout = await import(resolve(REPO, "scripts", "fan-out.mjs"));

test("V2-105 fan-out globsOverlap: nested/identical sets overlap, sibling sets do not", () => {
  assert.equal(fanout.globsOverlap("lib/foo/**", "lib/**"), true, "child under parent overlaps");
  assert.equal(fanout.globsOverlap("lib/a.ts", "lib/a.ts"), true, "identical globs overlap");
  assert.equal(fanout.globsOverlap("lib/a/**", "lib/b/**"), false, "disjoint siblings do not");
  assert.equal(fanout.globsOverlap("app/api/x/**", "lib/**"), false, "different roots do not");
});

// Senior-review High regression: the old representative-path heuristic was FALSE-disjoint for
// mid-segment wildcards (prefix/suffix globs in the same dir) — the dangerous direction, since
// check-overlap would pass a manifest that actually collides. Each pair below shares a real path.
test("V2-105 fan-out globsOverlap detects mid-segment-wildcard collisions (was false-disjoint)", () => {
  const collide = [
    ["lib/a*.ts", "lib/*b.ts"], // → lib/ab.ts
    ["lib/foo.*", "lib/*.ts"], // → lib/foo.ts
    ["app/api/widgets/*.ts", "app/api/*/create.ts"], // → app/api/widgets/create.ts
    ["lib/validations/order*.ts", "lib/validations/*.test.ts"], // → lib/validations/order.test.ts
  ];
  for (const [a, b] of collide)
    assert.equal(fanout.globsOverlap(a, b), true, `${a} ∩ ${b} must be detected as overlapping`);
  // truly-disjoint mid-segment patterns and depth-mismatched `**` stay FALSE
  assert.equal(fanout.globsOverlap("lib/a*.ts", "lib/b*.ts"), false, "distinct fixed prefixes");
  assert.equal(fanout.globsOverlap("lib/a?.ts", "lib/abc.ts"), false, "? is exactly one char");
  assert.equal(fanout.globsOverlap("lib/**/x.ts", "lib/a/b/y.ts"), false, "different leaf files");
});

test("V2-105 fan-out findDeclaredOverlaps flags a colliding pair and passes a disjoint set", () => {
  const bad = fanout.findDeclaredOverlaps([
    { id: "a", files: ["lib/foo/**"] },
    { id: "b", files: ["lib/**"] },
  ]);
  assert.equal(bad.length, 1);
  assert.deepEqual([bad[0].a, bad[0].b], ["a", "b"]);
  const ok = fanout.findDeclaredOverlaps([
    { id: "a", files: ["lib/auth.ts"] },
    { id: "b", files: ["app/api/widgets/**"] },
  ]);
  assert.deepEqual(ok, []);
});

test("V2-105 fan-out unitsMatching attributes a path to exactly the owning unit", () => {
  const units = [
    { id: "auth", files: ["lib/auth.ts", "lib/validations/**"] },
    { id: "routes", files: ["app/api/widgets/**"] },
  ];
  assert.deepEqual(fanout.unitsMatching("lib/validations/x.ts", units), ["auth"]);
  assert.deepEqual(fanout.unitsMatching("app/api/widgets/route.ts", units), ["routes"]);
  assert.deepEqual(fanout.unitsMatching("lib/rogue.ts", units), [], "out-of-scope matches nothing");
});

test("V2-105 fan-out loadManifest rejects empty units, duplicate ids, and empty file sets", () => {
  const dir = mkdtempSync(join(tmpdir(), "fanout-mf-"));
  try {
    const write = (obj) => {
      const p = join(dir, "m.json");
      writeFileSync(p, JSON.stringify(obj));
      return p;
    };
    assert.throws(() => fanout.loadManifest(write({ units: [] })), /non-empty "units"/);
    assert.throws(
      () =>
        fanout.loadManifest(
          write({
            units: [
              { id: "a", files: ["x"] },
              { id: "a", files: ["y"] },
            ],
          }),
        ),
      /duplicate unit id/,
    );
    assert.throws(
      () => fanout.loadManifest(write({ units: [{ id: "a", files: [] }] })),
      /non-empty files/,
    );
    // a valid manifest round-trips
    const ok = fanout.loadManifest(write({ units: [{ id: "a", files: ["lib/a.ts"] }] }));
    assert.equal(ok.units.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("V2-105 fan-out check-overlap CLI exits 1 on overlap, 0 on a disjoint manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "fanout-cli-"));
  try {
    const run = (obj) => {
      const p = join(dir, "m.json");
      writeFileSync(p, JSON.stringify(obj));
      return spawnSync("node", [join(REPO, "scripts", "fan-out.mjs"), "check-overlap", p], {
        cwd: REPO,
        encoding: "utf8",
      });
    };
    const overlap = run({
      units: [
        { id: "a", files: ["lib/foo/**"] },
        { id: "b", files: ["lib/**"] },
      ],
    });
    assert.equal(overlap.status, 1, `overlap must refuse:\n${overlap.stderr}`);
    const disjoint = run({
      units: [
        { id: "a", files: ["lib/auth.ts"] },
        { id: "b", files: ["app/api/x/**"] },
      ],
    });
    assert.equal(disjoint.status, 0, `disjoint must pass:\n${disjoint.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Senior-review Mediums: verify-scope must (a) list every file in a brand-new dir (`-uall`,
// else a new tree collapses to one entry and mis-flags a correct wave), and (b) ignore
// pre-existing dirty files via the baseline check-overlap snapshots (clean-tree enforced in code).
test("V2-105 fan-out verify-scope: -uall granularity + baseline subtraction (temp git repo)", () => {
  const dir = mkdtempSync(join(tmpdir(), "fanout-verify-"));
  const mdir = mkdtempSync(join(tmpdir(), "fanout-mf-")); // manifest lives OUTSIDE the repo
  const git = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  const run = (cmd, mp) =>
    spawnSync("node", [join(REPO, "scripts", "fan-out.mjs"), cmd, mp], {
      cwd: dir,
      encoding: "utf8",
    });
  try {
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    // a tracked baseline commit so later writes create a BRAND-NEW dir (app/ did not exist)
    writeFileSync(join(dir, "seed.txt"), "seed\n");
    git("add", "-A");
    git("commit", "-qm", "seed");
    const mp = join(mdir, "m.json");
    writeFileSync(
      mp,
      JSON.stringify({
        units: [
          { id: "routes", files: ["app/api/**"] },
          { id: "lib", files: ["lib/**"] },
        ],
      }),
    );
    // pre-existing dirty file OUTSIDE every declared set — must NOT be blamed on the wave
    writeFileSync(join(dir, "preexisting.txt"), "wip\n");
    assert.equal(run("check-overlap", mp).status, 0, "disjoint manifest passes + writes baseline");
    // the wave writes several files into a brand-new nested dir (would collapse without -uall)
    mkdirSync(join(dir, "app", "api", "widgets"), { recursive: true });
    writeFileSync(join(dir, "app", "api", "widgets", "route.ts"), "x\n");
    writeFileSync(join(dir, "app", "api", "widgets", "schema.ts"), "x\n");
    const clean = run("verify-scope", mp);
    assert.equal(
      clean.status,
      0,
      `in-scope new-dir wave must pass (-uall + baseline):\n${clean.stderr}`,
    );
    // now an out-of-scope write is caught (not masked by the baseline)
    writeFileSync(join(dir, "rogue.ts"), "x\n");
    const rogue = run("verify-scope", mp);
    assert.equal(rogue.status, 1, "out-of-scope write must fail");
    assert.match(rogue.stderr, /rogue\.ts/, "names the offending file");
    assert.doesNotMatch(rogue.stderr, /preexisting\.txt/, "pre-existing dirty file is NOT blamed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(mdir, { recursive: true, force: true });
  }
});

// ── V2-202/209 blueprint-content gate (feature-parity + amendment-confirm) ───────
const bpc = await import(resolve(REPO, "scripts", "lib", "blueprint-content.mjs"));
const yes = () => true;
const no = () => false;

test("V2-202 analyzeBlueprint flags a benchmark-referencing blueprint with no parity section", () => {
  const missing = "# BP\nSee docs/benchmarks/it-asset-management.md for scope.\n## Domain model\n";
  assert.equal(bpc.analyzeBlueprint(missing, yes).parityGap, true, "ref + no parity → gap");
  // a "## Feature parity" heading satisfies it
  const withHeading = missing + "\n## Feature parity\n| T1 | IN | US1 |\n";
  assert.equal(bpc.analyzeBlueprint(withHeading, yes).parityGap, false);
  // an explicit opt-out line satisfies it
  const withOptOut =
    "# BP\ndocs/benchmarks/it-asset-management.md\nFeature parity: n/a — program bp\n";
  assert.equal(bpc.analyzeBlueprint(withOptOut, yes).parityGap, false);
  // no benchmark referenced → never a parity gap
  assert.equal(bpc.analyzeBlueprint("# BP\nno benchmark here\n", yes).parityGap, false);
  // references a benchmark that does NOT exist on disk → no gap
  assert.equal(bpc.analyzeBlueprint(missing, no).parityGap, false);
});

test("V2-209 analyzeBlueprint flags a real amendment row with an empty Confirmed line", () => {
  const amended = "# BP\nConfirmed: \n## Amendments\n| 2026-07-17 | Domain | a | b | fix |\n";
  assert.equal(
    bpc.analyzeBlueprint(amended, no).amendGap,
    true,
    "real amend + empty confirm → gap",
  );
  // placeholder Confirmed (<...>) also counts as empty
  const ph = "# BP\nConfirmed: <operator/date>\n| 2026-07-17 | X | a | b | c |\n";
  assert.equal(bpc.analyzeBlueprint(ph, no).amendGap, true);
  // re-confirmed → no gap
  const confirmed = "# BP\nConfirmed: Tariq 2026-07-17\n| 2026-07-17 | X | a | b | c |\n";
  assert.equal(bpc.analyzeBlueprint(confirmed, no).amendGap, false);
  // only the TEMPLATE placeholder row (<YYYY-MM-DD>, not a real date) → not a real amendment
  const templateOnly = "# BP\nConfirmed: \n| <YYYY-MM-DD> | <section> | <was> | <now> | <why> |\n";
  assert.equal(bpc.analyzeBlueprint(templateOnly, no).amendGap, false);
  // no amendment row at all → no gap
  assert.equal(bpc.analyzeBlueprint("# BP\nConfirmed: \nnothing\n", no).amendGap, false);
});

// ── V2-207 bdd-coverage traceability gate (ADR-058) ──────────────────────────────
const bdd = await import(resolve(REPO, "scripts", "bdd-coverage.mjs"));

test("V2-207 bdd parseFeature extracts @US tags + steps per scenario", () => {
  const feat = `Feature: Assets
@US7 @smoke
Scenario: admin creates an asset
  Given an ADMIN session
  When they POST a valid asset
  Then it is persisted
`;
  const p = bdd.parseFeature(feat, "a.feature");
  assert.equal(p.scenarios.length, 1);
  assert.deepEqual(p.scenarios[0].tags.includes("US7"), true);
  assert.equal(p.scenarios[0].steps.length, 3);
});

test("V2-207 bdd step matching: cucumber-expression + regex defs match; a gap does not", () => {
  const defs = bdd.parseStepDefs(
    `Given('an ADMIN session', () => {});\nWhen('they POST a {word} asset', () => {});\nThen(/^it is (persisted|listed)$/, () => {});`,
  );
  assert.equal(bdd.stepMatches("an ADMIN session", defs), true);
  assert.equal(bdd.stepMatches("they POST a valid asset", defs), true, "{word} placeholder");
  assert.equal(bdd.stepMatches("it is persisted", defs), true, "regex def");
  assert.equal(bdd.stepMatches("they DELETE everything", defs), false, "no def → unmatched");
});

test("V2-207 bdd checkBddCoverage reds on unimplemented step, missing tag, and uncovered story", () => {
  const feat = bdd.parseFeature(
    `@US7\nScenario: create\n  Given an ADMIN session\n  Then it is persisted\n`,
    "assets.feature",
  );
  const allStories = new Set(["US7", "US8"]);
  // full defs → the only gap is the required-but-uncovered US8
  const defs = bdd.parseStepDefs(
    `Given('an ADMIN session',()=>{});Then('it is persisted',()=>{});`,
  );
  const req = new Set(["US7", "US8"]);
  const errs = bdd.checkBddCoverage([feat], defs, allStories, req);
  assert.ok(
    errs.some((e) => /US8 has no @US8 scenario/.test(e)),
    "uncovered story reds",
  );
  assert.ok(!errs.some((e) => /US7/.test(e) && /no @US/.test(e)), "US7 IS covered");

  // delete a step definition (the acceptance case) → unimplemented-step red
  const defsMissing = bdd.parseStepDefs(`Given('an ADMIN session',()=>{});`);
  const errs2 = bdd.checkBddCoverage([feat], defsMissing, allStories, new Set(["US7"]));
  assert.ok(
    errs2.some((e) => /no matching step definition/.test(e) && /it is persisted/.test(e)),
    "deleting a step def turns the run red",
  );

  // scenario with no @US tag → untraceable red
  const untagged = bdd.parseFeature(`Scenario: orphan\n  Given an ADMIN session\n`, "x.feature");
  const errs3 = bdd.checkBddCoverage([untagged], defs, allStories, new Set());
  assert.ok(
    errs3.some((e) => /no @US<n> tag/.test(e)),
    "untagged scenario reds",
  );

  // a clean, fully-covered set → no errors
  const errs4 = bdd.checkBddCoverage([feat], defs, allStories, new Set(["US7"]));
  assert.deepEqual(errs4, []);
});
