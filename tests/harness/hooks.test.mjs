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
// C3: a personal/quickstart-tier gate ALLOWS but attaches advisory guidance.
const isWarn = (r) => r.decision === null && !!r.json?.hookSpecificOutput?.additionalContext;
const advice = (r) => r.json?.hookSpecificOutput?.additionalContext ?? "";
const isBlock = (r) => r.decision === "block";
const preBash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const preWrite = (file_path) => ({ tool_name: "Write", tool_input: { file_path } });

/** Build a throwaway repo-shaped fixture with docs/blueprints/<name>.md stubs. */
function blueprintFixture(stubs, tier = "shared") {
  const dir = mkdtempSync(join(tmpdir(), "hooks-bp-"));
  mkdirSync(join(dir, "docs", "blueprints"), { recursive: true });
  // C3 (2026-08-17): the gates are tier-aware -- `shared` DENIES, `personal`
  // advises. Fixtures default to `shared` so the pre-C3 deny assertions below
  // stay a real regression net; pass "personal" to exercise the advisory path.
  writeFileSync(join(dir, "project.config.json"), JSON.stringify({ tier }));
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(dir, "docs", "blueprints", name), body);
  }
  return dir;
}

/** Build a throwaway repo-shaped fixture with a docs/build-vs-buy-ledger.md body (V2-309). */
function ledgerFixture(body, tier = "shared") {
  const dir = mkdtempSync(join(tmpdir(), "hooks-ledger-"));
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "project.config.json"), JSON.stringify({ tier }));
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
  // C3: this repo is tier "personal", so the gate ADVISES rather than denies.
  // The shared-tier deny is covered by the fixture-based tests above.
  assert.ok(isWarn(r), `expected advisory, got ${r.decision} :: ${r.stdout}`);
  assert.match(advice(r), /blueprint-gate/);
  assert.match(advice(r), /DENIED/, "advisory must still name the shared-tier consequence");
});

test("V2-001 bash-write-gate ALLOWS a heredoc write once a blueprint covers the path", () => {
  // app/api/openapi/route.ts IS covered by docs/blueprints/openapi-contract-seam.md.
  const r = runHook(
    "bash-write-gate.mjs",
    preBash("cat > app/api/openapi/route.ts <<'EOF'\nexport const x = 1;\nEOF"),
  );
  assert.equal(r.decision, null, `expected allow, got deny :: ${r.stdout}`);
});

// --- 2026-08-21: the two register items from 2026-07-16, both now closed. -------

test("V2-001 a heredoc that merely MENTIONS a gated path is not a write", () => {
  // The false-positive: the redirection scan ran over the whole command string, so a
  // heredoc BODY quoting a gated path read as a write to it. Hit twice in one session
  // writing commit messages, and a fail-closed feel on a fail-open gate is how operators
  // learn to wave gates through. The body is data; only the OPENER redirects.
  const r = runHook(
    "bash-write-gate.mjs",
    preBash(
      "cat > /tmp/msg.txt <<'EOF'\nWe considered writing > app/api/zzznew/route.ts here.\nEOF",
    ),
  );
  assert.equal(r.decision, null, `heredoc body must not be scanned :: ${r.stdout}`);
  assert.ok(!isWarn(r), `expected no advisory either :: ${advice(r)}`);
});

test("V2-001 a gated path inside a quoted string is not a write", () => {
  const r = runHook(
    "bash-write-gate.mjs",
    preBash(`git commit -m "route lives > app/api/zzznew/route.ts now"`),
  );
  assert.equal(r.decision, null, `quoted '>' is text, not redirection :: ${r.stdout}`);
});

test("V2-001 the heredoc OPENER is still gated (the fix must not blind the gate)", () => {
  const r = runHook(
    "bash-write-gate.mjs",
    preBash("cat > app/api/zzznew/route.ts <<'EOF'\nexport const x = 1;\nEOF"),
  );
  assert.ok(isWarn(r), `opener must still be caught :: ${r.decision} ${r.stdout}`);
});

test("V2-001 a heredoc fed to an INTERPRETER is scanned, not stripped as data", () => {
  // Senior review 2026-08-21. stripHeredocBodies fixed a real false positive by treating
  // a heredoc body as inert data -- true for `cat > f <<EOF`, FALSE when the target is an
  // interpreter, where the body is a script the shell executes. A real write nested inside
  // `bash <<'OUTER'` was discarded as "body" and never reached writeTargets(), reopening
  // the exact drop-to-the-shell hole this gate exists to close.
  const r = runHook(
    "bash-write-gate.mjs",
    preBash("bash <<'OUTER'\ncat > app/api/zzznew/route.ts <<'X'\nexport const x = 1;\nX\nOUTER"),
  );
  assert.ok(isWarn(r), `nested heredoc write must be seen :: ${r.decision} ${r.stdout}`);
});

test("V2-001 a heredoc PIPED to an interpreter is scanned too", () => {
  // Re-review 2026-08-21: round 11 detected the interpreter from the opening line's
  // FIRST word, which only ever matched `bash <<'OUTER'`. `cat <<'OUTER' | bash` has
  // first word `cat`, and bash still executes the body -- the same hole, one level over.
  const r = runHook(
    "bash-write-gate.mjs",
    preBash(
      "cat <<'OUTER' | bash\ncat > app/api/zzznew/route.ts <<'X'\nexport const x = 1;\nX\nOUTER",
    ),
  );
  assert.ok(isWarn(r), `piped interpreter heredoc must be seen :: ${r.decision} ${r.stdout}`);
});

test("V2-001 a DATA heredoc NESTED inside an executed body stays unscanned", () => {
  // Re-review 2026-08-21: keeping an executed body copied it verbatim, sweeping the
  // nested data heredoc's CONTENT back into the scanned text and resurrecting the exact
  // false positive stripHeredocBodies exists to prevent. Only `safe.ts` is written here.
  const r = runHook(
    "bash-write-gate.mjs",
    preBash(
      "bash <<'OUTER'\ncat > safe.ts <<'X'\nwe discussed writing > app/api/zzzevil/route.ts here\nX\nOUTER",
    ),
  );
  assert.equal(r.decision, null, `nested data body must not be scanned :: ${r.stdout}`);
  assert.ok(!isWarn(r), `expected no advisory :: ${advice(r)}`);
});

test("V2-001 a DATA heredoc still is not scanned (the false-positive fix must survive)", () => {
  const r = runHook(
    "bash-write-gate.mjs",
    preBash(
      "cat > /tmp/msg.txt <<'EOF'\nWe considered writing > app/api/zzznew/route.ts here.\nEOF",
    ),
  );
  assert.equal(r.decision, null, `data body must stay unscanned :: ${r.stdout}`);
  assert.ok(!isWarn(r), `expected no advisory :: ${advice(r)}`);
});

test("V2-001 a path held in a shell VARIABLE does not evade the gate", () => {
  // The evasion: no literal gated path appeared next to any redirect token.
  const r = runHook(
    "bash-write-gate.mjs",
    preBash('F=app/api/zzznew/route.ts; echo "export const x = 1;" > "$F"'),
  );
  assert.ok(isWarn(r), `expected the expanded target to be gated :: ${r.decision} ${r.stdout}`);
});

test("V2-001 an interpreter one-liner writing a gated file does not evade the gate", () => {
  const r = runHook(
    "bash-write-gate.mjs",
    preBash(`node -e "require('fs').writeFileSync('app/api/zzznew/route.ts','x')"`),
  );
  assert.ok(isWarn(r), `writeFileSync target must be gated :: ${r.decision} ${r.stdout}`);
});

test("V2-001 an interpreter one-liner that only READS a gated path is untouched", () => {
  // The counter-case: the write-call requirement is what keeps this from over-blocking.
  const r = runHook(
    "bash-write-gate.mjs",
    preBash(`node -e "console.log(require('fs').readFileSync('app/api/zzznew/route.ts','utf8'))"`),
  );
  assert.equal(r.decision, null, `a read must not be gated :: ${r.stdout}`);
  assert.ok(!isWarn(r), `expected no advisory :: ${advice(r)}`);
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
  assert.ok(isWarn(tee), `tee should advise (personal tier) :: ${tee.stdout}`);
  const cp = runHook("bash-write-gate.mjs", preBash("cp /tmp/x.ts lib/brandnewcap.ts"));
  assert.ok(isWarn(cp), `cp into lib/ should advise (personal tier) :: ${cp.stdout}`);
  assert.match(advice(cp), /build-vs-buy/);
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
  // Still FLAGGED (advisory on personal tier, deny on shared) -- the point is that
  // a NEW uncovered file is treated differently from an existing one.
  assert.ok(isWarn(neu), `new uncovered route must still be flagged :: ${neu.stdout}`);
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
  const flagged = runHook("build-vs-buy-gate.mjs", preWrite("lib/brandnewcap.ts"));
  // C3: personal tier advises; the shared-tier DENY is covered by ledgerFixture tests.
  assert.ok(isWarn(flagged), `new lib/ file should be flagged :: ${flagged.stdout}`);
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

// V2 challenge-audit M2 — destructive working-tree git ops must deny SEMANTICALLY,
// even compounded (the settings.json deny-list is lexical-prefix only, so
// `cd x && git reset --hard` slips it).
test("dangerous-commands DENIES destructive git ops incl. compound forms (M2)", () => {
  assert.ok(
    isDeny(runHook("dangerous-commands.mjs", preBash("cd sub && git reset --hard HEAD~5"))),
    "compound git reset --hard must deny",
  );
  assert.ok(
    isDeny(runHook("dangerous-commands.mjs", preBash("git clean -fd"))),
    "git clean -fd must deny",
  );
  assert.ok(
    isDeny(runHook("dangerous-commands.mjs", preBash("git checkout ."))),
    "git checkout . must deny",
  );
  assert.ok(
    isDeny(runHook("dangerous-commands.mjs", preBash("git restore ."))),
    "git restore . must deny",
  );
});

test("dangerous-commands ALLOWS normal (non-destructive) git checkout (M2 no false-positive)", () => {
  assert.equal(runHook("dangerous-commands.mjs", preBash("git checkout main")).decision, null);
  assert.equal(
    runHook("dangerous-commands.mjs", preBash("git checkout -b feature/x")).decision,
    null,
  );
  // Benign LONG flags (2026-07-25 senior review). The original check denied any
  // `--*`, so these four ordinary operations were all blocked despite discarding
  // nothing -- `--staged` in particular only UNSTAGES, the least destructive
  // restore form. Over-broad denials train the operator to wave the gate through.
  for (const cmd of [
    "git checkout --track origin/feature-x",
    "git checkout --orphan gh-pages",
    "git checkout --quiet main",
    "git restore --staged lib/foo.ts",
    // `-B <branch> <start-point>` takes TWO operands but creates/resets a BRANCH,
    // not a path -- the two-operand pathspec heuristic must not catch it.
    "git checkout -B feature/x origin/main",
    "git checkout -b feature/x origin/main",
  ]) {
    assert.equal(
      runHook("dangerous-commands.mjs", preBash(cmd)).decision,
      null,
      `${cmd} discards nothing and must be allowed`,
    );
  }
  // ...while the genuinely destructive forms stay denied. The last three carry NO
  // destructive flag at all and were FALSE NEGATIVES until 2026-07-25: the
  // narrowing pass chased false positives and never probed the other direction.
  //   `git restore <path>`       -- restore DEFAULTS to --worktree, i.e. discards
  //   `git checkout HEAD <path>` -- pathspec checkout, overwrites that path
  //   `-fq`                      -- `-f` hiding inside a combined short cluster
  for (const cmd of [
    "git checkout -- lib/foo.ts",
    "git checkout --force main",
    "git restore --worktree lib/foo.ts",
    "git restore --source=HEAD~1 lib/foo.ts",
    "git restore lib/foo.ts",
    "git checkout HEAD lib/foo.ts",
    "git checkout -fq main",
  ]) {
    assert.ok(
      isDeny(runHook("dangerous-commands.mjs", preBash(cmd))),
      `${cmd} discards work and must deny`,
    );
  }
});

// V2 challenge-audit M3 — `touch`-then-Write two-step must not bypass the blueprint gate:
// the `touch` that CREATES a new gated file is itself a gated write.
test("bash-write-gate FLAGS a `touch` that creates a new uncovered gated file (M3)", () => {
  const r = runHook("bash-write-gate.mjs", preBash("touch app/api/sneaky/route.ts"));
  // C3: personal tier advises, shared tier denies (fixture-covered). The M3 point
  // stands either way -- `touch` is a create and must not slip past the gate.
  assert.ok(isWarn(r), `touch of a new uncovered route must be flagged :: ${r.stdout}`);
  assert.match(advice(r), /blueprint-gate/);
});

test("bash-write-gate ALLOWS `touch` on an EXISTING gated file (continuation, M3)", () => {
  assert.equal(
    runHook("bash-write-gate.mjs", preBash("touch app/api/health/route.ts")).decision,
    null,
  );
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
// ---------------------------------------------------------------------------
// Smoke: EVERY hook survives a benign input and malformed stdin without crashing
// (exit 0), so a broken hook can't silently brick a session.
// ---------------------------------------------------------------------------
test("every .mjs hook exits 0 on benign input and on malformed stdin", () => {
  const failClosed = new Set(["dangerous-commands.mjs", "protect-secrets.mjs"]);
  // NOT session hooks: invoked by git (.husky/pre-push) with ref-updates on stdin,
  // never by Claude Code with a PreToolUse payload. Feeding them `preBash(...)` and
  // demanding exit 0 is a category error -- they evaluate REPO STATE and exit non-zero
  // to reject a push, which is their job. Worse, it made this test's outcome depend on
  // whether the working tree happened to hold unreviewed in-scope changes: it passed
  // only while the review scope matched nothing dirty, and started failing the moment
  // the scope widened to scripts/** (AC-1.1). Their own fail-open behaviour is covered
  // by the dedicated review-gate test that follows; this sweep is about session hooks
  // bricking a session.
  const notSessionHooks = new Set(["review-gate.mjs"]);
  for (const f of readdirSync(HOOKS).filter((n) => n.endsWith(".mjs") && !notSessionHooks.has(n))) {
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
  const r = runHook("context-injection.mjs", preEdit("prisma/schema.prisma"));
  const ctx = injectedContext(r);
  assert.match(ctx, /docs\/rules\/prisma\.md/, `expected prisma.md, got: ${ctx.slice(0, 120)}`);
  assert.match(ctx, /SCRUB_FIELDS/, "prisma rule body must be present");
});

test("V2-101 rules-injection surfaces api-routes.md when editing an API route", () => {
  const ctx = injectedContext(
    runHook("context-injection.mjs", preEdit("app/api/widgets/route.ts")),
  );
  assert.match(ctx, /docs\/rules\/api-routes\.md/);
  assert.match(ctx, /withRateLimit/, "auth-wrapper detail must be present");
});

test("V2-101 rules-injection surfaces design.md when editing a component", () => {
  const ctx = injectedContext(
    runHook("context-injection.mjs", preEdit("components/shared/Foo.tsx")),
  );
  assert.match(ctx, /docs\/rules\/design\.md/);
});

test("V2-101 rules-injection injects NOTHING for a non-matching path", () => {
  const r = runHook("context-injection.mjs", preEdit("README.md"));
  assert.equal(injectedContext(r), "", "README.md matches no rule glob → no injection");
  assert.equal(r.code, 0);
});

test("V2-101 rules-injection ignores non-edit tools (e.g. Bash)", () => {
  const r = runHook("context-injection.mjs", preBash("echo hi"));
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
  ];
  for (const [file, re] of cases) {
    const ctx = injectedContext(runHook("context-injection.mjs", preEdit(file)));
    assert.match(ctx, re, `${file} must inject a rule matching ${re}`);
  }
});

test("V2-101 every docs/rules/*.md has a parseable frontmatter glob that matches ≥1 real path", () => {
  // Guards deploy/harness (previously untested) against a broken frontmatter silently
  // disabling their lazy-load. Representative path per rule file.
  const reps = {
    "prisma.md": "prisma/schema.prisma",
    "api-routes.md": "app/api/x/route.ts",
    "design.md": "components/shared/Foo.tsx",
    "deploy.md": "vercel.json",
    "harness.md": "scripts/ship.mjs",
  };
  for (const [name, path] of Object.entries(reps)) {
    const ctx = injectedContext(runHook("context-injection.mjs", preEdit(path)));
    assert.match(ctx, new RegExp(name.replace(".", "\\.")), `${name} must inject on ${path}`);
  }
});

test("V2-101 rule migration preserved every ADR referenced by the old constitution", () => {
  // Mechanical ADR-\d+ set-diff: the pre-split constitution's ADR set vs the current
  // CLAUDE.md + rules (senior-review fix: a hand-picked keyword list missed ADR-020/048).
  //
  // The old constitution's ADR set is FROZEN in a committed fixture rather than read from
  // `git show b265104^:CLAUDE.md` live — a shallow clone or a "Use this template" fork (no
  // git history at all) cannot reach that commit, and coupling this /ship phase-A gate to
  // history made it error there instead of run. When the commit IS reachable we additionally
  // cross-check the fixture against it, so the frozen list can't silently drift on the template.
  const adrs = (s) => new Set(s.match(/ADR-\d+/g) || []);
  const fixture = JSON.parse(
    readFileSync(join(REPO, "tests", "harness", "fixtures", "old-constitution-adrs.json"), "utf8"),
  );
  const oldAdrs = new Set(fixture.adrs);
  const newAll =
    readFileSync(join(REPO, "CLAUDE.md"), "utf8") +
    readdirSync(join(REPO, "docs", "rules"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(join(REPO, "docs", "rules", f), "utf8"))
      .join("\n");
  const newAdrs = adrs(newAll);
  const missing = [...oldAdrs].filter((a) => !newAdrs.has(a));
  assert.deepEqual(missing, [], `ADRs dropped in the split: ${missing.join(", ")}`);

  // Optional integrity cross-check: only when the historical commit is reachable (template
  // main with full history). Skipped silently in shallow clones / forks — the fixture stands.
  try {
    const oldClaude = execSync("git show b265104^:CLAUDE.md", {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    assert.deepEqual(
      [...adrs(oldClaude)].sort(),
      [...oldAdrs].sort(),
      "the frozen old-constitution-adrs.json fixture has drifted from b265104^:CLAUDE.md",
    );
  } catch (err) {
    // Re-throw a genuine drift assertion; swallow only the unreachable-commit case.
    if (err instanceof assert.AssertionError) throw err;
  }
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

// ── V2-207 bdd-coverage traceability gate (ADR-058) ─────────────────────────
// REMOVED 2026-08-17 (A4): playwright-bdd and scripts/bdd-coverage.mjs were retired
// from the default rail. BDD traceability is a practice a team adopts after finding
// the problem it solves, not a pre-installed default. The recipe stays in docs/ so a
// fork can re-adopt it; if you do, restore these tests with it.

// ---------------------------------------------------------------------------
// review-gate.mjs is a git pre-push gate, not a session hook, so it is exempt from
// the PreToolUse sweep above. That exemption previously cited "the review-gate tests
// below" -- which did not exist, leaving this file's fail-open contract (ADR-047's
// core promise for it) entirely untested. This is that test, invoking the gate the
// way git actually does: a `base..head` range argument.
//
// It asserts ONLY state-independent properties. Deliberately NOT asserted: that a
// range containing unreviewed gated files exits 1. That is true right now, but it
// depends on whether the working branch happens to carry a receipt -- and a test whose
// outcome moves with ambient repo state is exactly the defect that made the original
// sweep pass for the wrong reason.
// ---------------------------------------------------------------------------
test("review-gate.mjs fails OPEN on unusable input and allows an empty range", () => {
  const gate = join(HOOKS, "review-gate.mjs");
  const run = (args, input) =>
    spawnSync("node", [gate, ...args], { cwd: REPO, input: input ?? "", encoding: "utf8" });

  // An empty range has no changed paths -> nothing gated -> allow.
  assert.equal(run(["HEAD..HEAD"]).status, 0, "empty range should allow");

  // Unusable input must ALLOW, never wedge a push (ADR-047: governance gates fail open).
  //
  // EVERY case below contains ".." on purpose. review-gate only treats an argument as a
  // range when it includes ".."; without it the arg is ignored and the gate falls through
  // to its live `@{u}..HEAD` fallback -- meaning the assertion would silently measure the
  // RUNNING MACHINE's unpushed review state instead of the malformed-input path. Three of
  // the original five cases did exactly that, so they passed only while the checkout
  // happened to have nothing unreviewed in scope: the same ambient-state fragility the
  // comment above warns about, reintroduced in the test written to replace it.
  // A fifth case ("empty range with garbage stdin", ["HEAD..HEAD"]) was removed: because
  // the CLI range is resolved BEFORE stdin is read, it never reached the stdin path, took
  // the ordinary empty-range exit instead of failOpen(), and — proven by mutation — stayed
  // green even with fail-open handling entirely removed. It duplicated the empty-range
  // assertion above while advertising coverage it did not have.
  for (const [label, args, input] of [
    ["garbage range arg", ["definitely..not..a..range"], ""],
    ["nonexistent base ref", ["no-such-ref..HEAD"], ""],
    ["nonexistent head ref", ["HEAD..no-such-ref"], ""],
    ["both refs nonexistent", ["nope-a..nope-b"], ""],
  ]) {
    const r = run(args, input);
    assert.equal(r.status, 0, `review-gate should fail OPEN on ${label} (got ${r.status})`);
  }
});

// ---------------------------------------------------------------------------
// isSkipAdjudicated -- the Gate-Skip adjudication predicate (AC-4.1).
//
// This logic shipped two OPPOSITE bugs in consecutive rounds, both because it lived
// inline in ship.mjs where nothing could unit-test it:
//   round 1: unanchored `includes(gate)` -> `Gate-Skip: all` was "adjudicated" by the
//            word "install" in an unrelated closed entry, so a blanket skip bypassed
//            both gates AND this backstop, silently.
//   round 2: over-anchored -> a reasonable English adjudication was never recognised,
//            wedging /ship RED with no way to discover the required literal.
// Both directions are asserted here so neither can come back.
// ---------------------------------------------------------------------------
test("isSkipAdjudicated: recognises the documented form and nothing else", async () => {
  const { isSkipAdjudicated: adj } = await import(join(HOOKS, "lib", "receipt.mjs"));
  const entry = (body) => `- 2026-08-22 — [harness] ${body}\n`;

  // --- must NOT adjudicate -------------------------------------------------
  // The round-1 bug: prose merely CONTAINING the gate name.
  assert.equal(
    adj(entry("run `npm install` to set up — status: fixed(abc1234)"), "all"),
    false,
    "the word 'install' must not adjudicate Gate-Skip: all",
  );
  assert.equal(
    adj(entry("all clear after the sweep — status: adjudicated(2026-08-22)"), "all"),
    false,
    "the phrase 'all clear' must not adjudicate Gate-Skip: all",
  );
  assert.equal(
    adj(entry("Gate-Skip: qa-gate — status: open"), "qa-gate"),
    false,
    "status: open is not adjudicated",
  );
  assert.equal(
    adj(entry("Gate-Skip: qa-gate — no status line at all"), "qa-gate"),
    false,
    "missing status is not adjudicated",
  );
  assert.equal(adj("", "qa-gate"), false, "empty register adjudicates nothing");
  assert.equal(
    adj(entry("Gate-Skip: qa-gate — status: fixed(abc)"), ""),
    false,
    "empty gate name adjudicates nothing",
  );
  // Prefix collision: a longer gate name must not be adjudicated by a shorter one.
  assert.equal(
    adj(entry("Gate-Skip: qa — status: fixed(abc1234)"), "qa-gate"),
    false,
    "Gate-Skip: qa must not adjudicate the distinct gate qa-gate",
  );

  // --- must adjudicate -----------------------------------------------------
  // The round-2 bug: the documented literal has to actually work.
  assert.equal(
    adj(
      entry("Gate-Skip: qa-gate for an emergency hotfix — status: adjudicated(2026-08-22)"),
      "qa-gate",
    ),
    true,
    "the literal the deny message prints must be accepted",
  );
  assert.equal(
    adj(entry("Gate-Skip: review-gate — status: fixed(deadbee)"), "review-gate"),
    true,
    "status: fixed(<commit>) adjudicates too",
  );
  // `*` is a legal gate value AND a regex metacharacter -- escaping must hold.
  assert.equal(
    adj(entry("Gate-Skip: * blanket skip — status: adjudicated(2026-08-22)"), "*"),
    true,
    "the * alias must adjudicate itself",
  );
  assert.equal(
    adj(entry("Gate-Skip: qa-gate — status: adjudicated(2026-08-22)"), "*"),
    false,
    "a named skip must not adjudicate the * alias",
  );
});

// ---------------------------------------------------------------------------
// qa-gate: a NARROW receipt must not satisfy a deploy once a prior QA point exists.
//
// This is the round-3 CRITICAL. `git log --format=...%x1e` appends git's own newline
// after every record, so splitting on \x1e glued "\n" onto every sha but the first;
// the malformed sha produced a bad diff range, gitTry swallowed it, `shipping` came back
// empty, and the allow branch fired unconditionally. Any syntactically valid narrow
// receipt shipped anything, silently. No prior test caught it because every fixture had
// only ONE QA-carrying commit -- the bug needs a SECOND one to trigger.
// ---------------------------------------------------------------------------
test("qa-gate denies a deploy when a narrow QA receipt misses a shipped file", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-gate-fixture-"));
  const git = (...a) => execSync(`git ${a.join(" ")}`, { cwd: dir, stdio: "pipe" }).toString();
  const receipt = (args) =>
    spawnSync("node", [join(HOOKS, "lib", "receipt.mjs"), ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    }).stdout.trim();
  try {
    git("init -q");
    git("config user.email t@t.t");
    git("config user.name t");
    mkdirSync(join(dir, "lib"), { recursive: true });

    // Cycle 1: a genuine whole-tree QA point.
    writeFileSync(join(dir, "lib", "foo.ts"), "export const a = 1;\n");
    git("add -A");
    git('commit -q -m "seed"');
    const whole = receipt(["trailer", "--key", "QA", "."]);
    git(`commit -q --allow-empty -m "qa cycle 1${"\n\n"}${whole}"`);

    // Cycle 2: two files change, but the new receipt names only one of them.
    writeFileSync(join(dir, "lib", "foo.ts"), "export const a = 2;\n");
    writeFileSync(join(dir, "lib", "bar.ts"), "export const b = 1;\n");
    git("add -A");
    git('commit -q -m "change foo and bar"');
    const narrow = receipt(["trailer", "--key", "QA", "lib/foo.ts"]);
    assert.match(
      narrow,
      /^QA: lib\/foo\.ts [0-9a-f]{40,64}$/,
      "fixture must produce a valid narrow receipt",
    );
    git(`commit -q --allow-empty -m "narrow qa${"\n\n"}${narrow}"`);

    // A narrow, INTERNALLY VALID receipt must not certify a deploy that also ships bar.ts.
    const r = spawnSync("node", [join(HOOKS, "qa-gate.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "node scripts/deploy.mjs" },
      }),
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.ok(
      /deny|Denied/i.test(out),
      `narrow receipt must NOT satisfy the deploy gate (lib/bar.ts uncovered). Got: ${out.slice(0, 300)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
