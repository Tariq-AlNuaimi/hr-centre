#!/usr/bin/env node
// PreToolUse hook (Read|Grep|Bash matcher) -- agent-read secret guard (Wave A2).
// Blocks tool calls that would pull secret MATERIAL into the transcript: reading
// .env* / key files (Read, Grep path, Bash read-commands) and printing Restricted
// env vars (`printenv AUTH_SECRET`, `echo $DATABASE_URL`, bare `env`). gitleaks
// only scans commits at push time; this closes the mid-session read boundary
// (evidence: docs/deep-comparison/04-hooks.md karanb192 row + 10-security.md
// mintmcp row -- one hook covers both items). Deny-with-reason; on any internal
// error the hook stays silent (push-time gitleaks remains the backstop).
// No override by design (blueprint decision #1): edit this file or use the
// permission system if a deny is genuinely wrong.
import { readFileSync } from "node:fs";

// Restricted env-var names (SECURITY.md §1/§6 + .env.example provisioning block).
const RESTRICTED_ENV = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_GOOGLE_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
  "SMTP_PASSWORD",
  "SEED_ADMIN_PASSWORD",
  "CRON_SECRET",
  "AUDIT_PURGE_TOKEN",
  "SENTRY_AUTH_TOKEN",
  "NEON_API_KEY",
  "VERCEL_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "GH_AUTOMATION_TOKEN",
  "ANTHROPIC_API_KEY",
];
const KEY_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"];
const SECRET_BASENAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".netrc",
  ".pgpass",
]);
const SSH_PUBLIC_OK = new Set(["config", "known_hosts", "authorized_keys"]);
// Commands whose file args are READ into output/context.
const READ_CMDS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "rg",
  "awk",
  "sed",
  "cut",
  "sort",
  "uniq",
  "strings",
  "base64",
  "xxd",
  "od",
  "nl",
  "tac",
  "view",
  "vi",
  "vim",
  "nano",
  "emacs",
  "code",
  "open",
  "bat",
  "diff",
  "cmp",
  "tee",
]);

/** Is this path/token secret-bearing? Returns a reason string or null. */
function secretPath(raw) {
  if (!raw) return null;
  const p = String(raw)
    .replace(/^["']|["']$/g, "")
    .replace(/[;,)]+$/, "");
  const base = p.split("/").pop() ?? "";
  if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example"))
    return `'${p}' is a live env file (Restricted; SECURITY.md §1)`;
  if (base.endsWith(".pub")) return null; // public keys are fine
  if (KEY_EXTENSIONS.some((e) => base.endsWith(e)))
    return `'${p}' looks like key material (${base})`;
  if (SECRET_BASENAMES.has(base)) return `'${p}' is a credential file`;
  if (/(^|\/)\.ssh\//.test(p) && !SSH_PUBLIC_OK.has(base))
    return `'${p}' is under ~/.ssh (private key material)`;
  if (/(^|\/)\.aws\/credentials$/.test(p)) return `'${p}' holds AWS credentials`;
  return null;
}

/** Scan a Bash command for secret reads. Returns a reason string or null. */
function scanBash(cmd) {
  // Split into pipeline/sequence segments so "rm -rf" quoted as an ARG elsewhere
  // is not confused with a command; each segment is inspected on its own.
  const segments = cmd.split(/(?:\|\||&&|;|\||\n)/);
  for (const seg of segments) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    // skip leading VAR=val assignments and sudo
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
    if (tokens[i] === "sudo") i++;
    const cmd0 = tokens[i] ?? "";
    const args = tokens.slice(i + 1);
    // 1. read-command targeting a secret file
    if (READ_CMDS.has(cmd0)) {
      for (const a of args) {
        if (a.startsWith("-")) continue;
        const why = secretPath(a);
        if (why) return why;
      }
    }
    // 2. printenv <RESTRICTED> / bare env / bare printenv (dumps every token)
    if (cmd0 === "printenv" || cmd0 === "env") {
      const nonFlag = args.filter((a) => !a.startsWith("-") && !a.includes("="));
      if (cmd0 === "printenv" && nonFlag.length === 0 && args.length === 0)
        return "bare `printenv` dumps ALL env vars, including Restricted tokens";
      if (cmd0 === "env" && tokens.length === i + 1)
        return "bare `env` dumps ALL env vars, including Restricted tokens";
      const hit = nonFlag.find((a) => RESTRICTED_ENV.includes(a));
      if (hit) return `printing $${hit} (Restricted) into the transcript`;
    }
    // 3. echo/printf expanding a Restricted var ($NAME or ${NAME})
    if (cmd0 === "echo" || cmd0 === "printf") {
      const hit = RESTRICTED_ENV.find((n) => new RegExp(`\\$\\{?${n}\\b`).test(seg));
      if (hit) return `expanding $${hit} (Restricted) into the transcript`;
    }
  }
  return null;
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const tool = input.tool_name ?? "";
  const ti = input.tool_input ?? {};
  let why = null;
  if (tool === "Read") why = secretPath(ti.file_path);
  else if (tool === "Grep") why = secretPath(ti.path) ?? secretPath(ti.glob);
  else if (tool === "Bash") why = scanBash(ti.command ?? "");
  if (why) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            `[protect-secrets] Denied: ${why}. Secret VALUES must never enter the ` +
            `transcript (CLAUDE.md hard rule; SECURITY.md §17). Use .env.example for ` +
            `shape/names, or reference the variable NAME without printing its value.`,
        },
      }),
    );
  }
} catch {
  /* a guard hook must never brick the session */
}
process.exit(0);
