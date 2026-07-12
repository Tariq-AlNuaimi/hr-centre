#!/usr/bin/env node
// Browser-egress bridge — get headless Chromium online in a Claude Code web session.
//
// WHY: in a web session the outbound path is a TLS-MITM egress proxy. curl / Node
// traverse it fine, but Chromium's HTTPS always fails with ERR_CONNECTION_RESET — the
// proxy's TLS interceptor rejects Chromium's BoringSSL ClientHello while accepting the
// OpenSSL one. This is NOT a CA-trust problem (see
// docs/runbooks/browser-egress-in-web-sessions.md for the confirmed root cause).
//
// FIX: chain Chromium through a local mitmdump. Chromium talks plain loopback (no
// fingerprint rejection); mitmproxy re-makes the upstream TLS with its OpenSSL client,
// which the egress proxy accepts.
//
//   chromium --proxy-server=127.0.0.1:8080 --> mitmdump --upstream--> $HTTPS_PROXY --> origin
//
// Idempotent + fail-open: off-platform (no $HTTPS_PROXY) every command is a clean no-op,
// so ordinary dev/CI is unchanged. `playwright.config.ts` already reads PW_PROXY_SERVER
// + PW_EXECUTABLE_PATH (issue #52); this just points them at the bridge. The .mcp.json
// browser servers gate on the `up` sentinel and route through 127.0.0.1:8080 when present.
//
// Subcommands:
//   up      (default) install (if needed) + start + trust + health-check; write sentinel
//   auto    like `up` but NEVER installs — silent no-op unless mitmproxy is already
//           present. The fail-open SessionStart entry point.
//   env     print `export PW_PROXY_SERVER=… / PW_EXECUTABLE_PATH=…` (only when up) for
//           `eval "$(node scripts/browser-bridge.mjs env)"`
//   status  report running + healthy (exit 0/1)
//   down    stop mitmdump + clear the sentinel
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();
const STATE_DIR = path.join(HOME, ".browser-bridge");
const SENTINEL = path.join(STATE_DIR, "up");
const PIDFILE = path.join(STATE_DIR, "mitmdump.pid");
const LOGFILE = path.join(STATE_DIR, "mitmdump.log");
const VENV = path.join(HOME, "mmvenv");
const MITMDUMP = path.join(VENV, "bin", "mitmdump");
const MITM_CA = path.join(HOME, ".mitmproxy", "mitmproxy-ca-cert.pem");
const EGRESS_CA = "/root/.ccr/ca-bundle.crt";
const NSSDB = path.join(HOME, ".pki", "nssdb");
const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = 8080;
const PROXY_URL = `http://${LISTEN_HOST}:${LISTEN_PORT}`;
// Per-attempt curl budget for a health probe, and the TOTAL wall-clock ceiling for
// waitHealthy(). Bounded on purpose: `auto` runs waitHealthy synchronously (and silently)
// from session-start.sh, so an unbounded retry loop would stall SessionStart for minutes.
const HEALTH_CURL_TIMEOUT = "8";
const HEALTH_DEADLINE_MS = 60_000;
const BROWSERS_ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";

let QUIET = false;
const log = (m) => {
  if (!QUIET) process.stderr.write(`[browser-bridge] ${m}\n`);
};

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

// Numeric revision from a `chromium-<n>` dir name (for version-correct sorting).
function chromiumRev(dir) {
  return Number(dir.slice("chromium-".length)) || 0;
}

// Highest-revision Chromium under PLAYWRIGHT_BROWSERS_PATH (matches playwright.config.ts
// and the `.mcp.json` `ls chromium-*/… | sort -V | tail -1` pattern). Version-sort by the
// numeric revision, NOT lexicographically — otherwise "chromium-99" sorts above
// "chromium-1194" and the wrong (older) build wins once two revisions coexist. The
// `chromium-<n>` filter also excludes the `chromium` symlink + `chromium_headless_shell-*`.
function resolveChromium() {
  try {
    const dirs = readdirSync(BROWSERS_ROOT)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => chromiumRev(a) - chromiumRev(b))
      .reverse();
    for (const d of dirs) {
      const c = path.join(BROWSERS_ROOT, d, "chrome-linux", "chrome");
      if (existsSync(c)) return c;
    }
  } catch {
    /* root missing off-platform */
  }
  return undefined;
}

function pidAlive() {
  if (!existsSync(PIDFILE)) return 0;
  const pid = Number(readFileSync(PIDFILE, "utf8").trim());
  if (!pid) return 0;
  try {
    process.kill(pid, 0); // signal 0 = liveness probe
    return pid;
  } catch {
    return 0;
  }
}

// Does a real request complete end-to-end through the chain?
function healthy() {
  const args = [
    "-sS",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    "--max-time",
    HEALTH_CURL_TIMEOUT,
    "-x",
    PROXY_URL,
  ];
  if (existsSync(MITM_CA)) args.push("--cacert", MITM_CA);
  else args.push("-k");
  args.push("https://example.com");
  const r = sh("curl", args);
  return r.stdout.trim() === "200";
}

function ensureMitmproxy(install) {
  if (existsSync(MITMDUMP)) return true;
  if (!install) return false;
  log("installing mitmproxy into ~/mmvenv (first run)…");
  if (!existsSync(path.join(VENV, "bin", "pip"))) {
    const v = sh("python3", ["-m", "venv", VENV], { stdio: "inherit" });
    if (v.status !== 0) return false;
  }
  sh(path.join(VENV, "bin", "pip"), ["install", "--upgrade", "pip", "setuptools", "wheel"], {
    stdio: "inherit",
  });
  // --prefer-binary dodges the pyperclip sdist build failure (runbook §Steps).
  const p = sh(path.join(VENV, "bin", "pip"), ["install", "--prefer-binary", "mitmproxy"], {
    stdio: "inherit",
  });
  return p.status === 0 && existsSync(MITMDUMP);
}

// Trust the mitm CA (+ egress CA) in Chromium's NSS store. Belt-and-suspenders — the
// Playwright specs also set ignoreHTTPSErrors and the MCP servers get --ignore-https-errors.
// `install` gates the apt round-trip: `auto` (SessionStart) never installs, so it stays
// fast and can't pay a slow `apt-get update` once per container when certutil is absent.
function ensureNssTrust(install) {
  if (install && !sh("sh", ["-c", "command -v certutil"]).stdout.trim()) {
    sh("apt-get", ["update"], { stdio: "ignore" }); // refresh a stale index (best-effort)
    sh("apt-get", ["install", "-y", "libnss3-tools"], { stdio: "ignore" });
  }
  if (!sh("sh", ["-c", "command -v certutil"]).stdout.trim()) {
    log("certutil unavailable — skipping NSS import (ignoreHTTPSErrors covers Playwright/MCP)");
    return;
  }
  mkdirSync(NSSDB, { recursive: true });
  const add = (name, file) => {
    if (existsSync(file))
      sh("certutil", ["-d", `sql:${NSSDB}`, "-A", "-n", name, "-t", "C,,", "-i", file], {
        stdio: "ignore",
      });
  };
  add("mitmproxy", MITM_CA);
  add("ccr-egress", EGRESS_CA);
}

// SIGTERM a running mitmdump and wait (bounded) for it to actually exit, so its listen
// port is free before we rebind. Escalates to SIGKILL if it doesn't go within ~3s.
async function killStale(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return; // already gone
  }
  for (let i = 0; i < 30; i++) {
    try {
      process.kill(pid, 0); // still alive?
    } catch {
      return; // exited
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* raced to exit */
  }
}

function startMitm() {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LOGFILE, ""); // truncate the previous run's log
  const args = [
    "--mode",
    `upstream:${process.env.HTTPS_PROXY}`,
    "--set",
    `ssl_verify_upstream_trusted_ca=${EGRESS_CA}`,
    "--listen-host",
    LISTEN_HOST,
    "--listen-port",
    String(LISTEN_PORT),
    "--set",
    "connection_strategy=lazy",
  ];
  // Detach so the bridge outlives this node process; append stdout+stderr to the log.
  const child = spawn(MITMDUMP, args, {
    detached: true,
    stdio: ["ignore", openSync(LOGFILE, "a"), openSync(LOGFILE, "a")],
  });
  child.unref();
  writeFileSync(PIDFILE, String(child.pid));
  return child.pid;
}

function writeSentinel() {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(SENTINEL, `${PROXY_URL}\n`);
}

function clearSentinel() {
  rmSync(SENTINEL, { force: true });
}

// Poll until the chain answers, bounded by a real WALL-CLOCK deadline. Each healthy()
// is a curl capped at HEALTH_CURL_TIMEOUT, so total ≈ deadlineMs (+ one in-flight probe)
// — never the old failure mode of 20 × 25s ≈ 520s of silent stall.
async function waitHealthy(deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (healthy()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function bringUp({ install }) {
  if (!process.env.HTTPS_PROXY) {
    log("no $HTTPS_PROXY — browser reaches the internet directly; bridge not needed.");
    clearSentinel();
    return 0;
  }
  const running = pidAlive();
  if (running && healthy()) {
    log(`already up + healthy on ${PROXY_URL}`);
    writeSentinel();
    return 0;
  }
  // Not currently live+healthy — drop any stale sentinel (e.g. left in $HOME by a prior
  // container) so the MCP wrappers never route through a dead proxy while we (re)start.
  clearSentinel();
  if (!ensureMitmproxy(install)) {
    if (!install) return 0; // auto mode: silent no-op when not installed
    log("mitmproxy install failed — see output above.");
    return 1;
  }
  // Self-heal: a mitmdump that's ALIVE but just failed the health check above is a broken
  // bridge (dead upstream, half-crashed process from a prior container). Kill it + clear
  // the PID file so the (re)start below replaces it, instead of waitHealthy() polling a
  // corpse for the whole deadline and then failing.
  if (running) {
    await killStale(running);
    rmSync(PIDFILE, { force: true });
    log(`replaced stale mitmdump (pid ${running} was alive but unhealthy)`);
  }
  if (!pidAlive()) {
    const pid = startMitm();
    log(`started mitmdump (pid ${pid}) on ${PROXY_URL} → upstream ${process.env.HTTPS_PROXY}`);
  }
  ensureNssTrust(install);
  if (!(await waitHealthy(HEALTH_DEADLINE_MS))) {
    log("health check FAILED — last mitmdump log lines:");
    if (!QUIET) sh("tail", ["-n", "15", LOGFILE], { stdio: "inherit" });
    clearSentinel();
    return 1;
  }
  writeSentinel();
  log(`healthy ✓  export it with:  eval "$(node scripts/browser-bridge.mjs env)"`);
  return 0;
}

function printEnv() {
  if (!existsSync(SENTINEL)) {
    process.stderr.write("[browser-bridge] not up — run `make browser-up` first.\n");
    return 0;
  }
  const chromium = resolveChromium();
  process.stdout.write(`export PW_PROXY_SERVER=${PROXY_URL}\n`);
  if (chromium) process.stdout.write(`export PW_EXECUTABLE_PATH=${chromium}\n`);
  return 0;
}

function status() {
  const running = pidAlive();
  if (!process.env.HTTPS_PROXY) {
    log("off-platform (no $HTTPS_PROXY) — bridge not needed.");
    return 0;
  }
  if (running && healthy()) {
    log(`up + healthy on ${PROXY_URL} (pid ${running})`);
    return 0;
  }
  log(running ? `mitmdump running (pid ${running}) but health check FAILED` : "down");
  return 1;
}

function down() {
  const pid = pidAlive();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    log(`stopped mitmdump (pid ${pid})`);
  } else {
    log("not running");
  }
  rmSync(PIDFILE, { force: true });
  clearSentinel();
  return 0;
}

const cmd = process.argv[2] || "up";
let code = 0;
if (cmd === "auto") {
  QUIET = true;
  code = await bringUp({ install: false });
} else if (cmd === "up") {
  code = await bringUp({ install: true });
} else if (cmd === "env") {
  code = printEnv();
} else if (cmd === "status") {
  code = status();
} else if (cmd === "down") {
  code = down();
} else {
  process.stderr.write("usage: browser-bridge.mjs [up|auto|env|status|down]\n");
  code = 1;
}
process.exit(code);
