#!/usr/bin/env node
// PreToolUse hook (Bash matcher) -- dangerous-command deny (Wave A2).
// The settings.json permission deny-list is prefix-lexical ("Bash(rm -rf *)"
// misses `cd x && rm -rf ~`); this hook is the SEMANTIC layer under it: it
// splits the command into pipeline/sequence segments and denies a short,
// conservative list of obviously destructive shapes with a reason (evidence:
// docs/deep-comparison/04-hooks.md disler + karanb192 rows). Both layers stay
// -- defense in depth. Conservative by design: substrings inside quoted args
// (`grep "rm -rf" docs/x`) do NOT trip it. No override (blueprint decision #1).
import { readFileSync } from "node:fs";

// Targets where `rm -rf` means catastrophe (root/home/repo-root/system dirs).
const RM_FATAL_TARGETS = new Set([
  "/", "/*", "~", "~/", "~/*", "$HOME", "${HOME}", "$HOME/", "$HOME/*",
  ".", "./", "./*", "..", "../", "../*", "*", ".git",
]);
const SYSTEM_DIR = /^\/(bin|boot|dev|etc|home|lib|lib64|opt|root|sbin|srv|sys|usr|var)\/?\*?$/;

function checkSegment(seg) {
  const tokens = seg.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (tokens[i] === "sudo") i++;
  const cmd = tokens[i] ?? "";
  const args = tokens.slice(i + 1);

  // 1. rm -rf (any flag order/spelling) on a fatal target
  if (cmd === "rm") {
    const flags = args.filter((a) => a.startsWith("-")).join(" ");
    const recursive = /(^|[^-\w])-[a-zA-Z]*[rR]/.test(" " + flags) || flags.includes("--recursive");
    const force = /(^|[^-\w])-[a-zA-Z]*f/.test(" " + flags) || flags.includes("--force");
    if (recursive && force) {
      const bad = args.find(
        (a) => !a.startsWith("-") &&
          (RM_FATAL_TARGETS.has(a.replace(/["']/g, "")) || SYSTEM_DIR.test(a.replace(/["']/g, "")))
      );
      if (bad) return `\`rm -rf ${bad}\` destroys the repo root / home / a system dir`;
    }
  }
  // 2. force push (flag or +refspec) -- matches the settings deny-list policy
  if (cmd === "git" && args[0] === "push") {
    if (args.some((a) => a === "-f" || a.startsWith("--force")))
      return "`git push --force` rewrites remote history (deny-listed policy; use a new branch instead)";
    if (args.some((a) => /^\+\S/.test(a)))
      return "`git push +<ref>` is a force push by refspec (rewrites remote history)";
  }
  // 3. chmod 777 (incl. -R) -- world-writable
  if (cmd === "chmod" && args.some((a) => /^([ugoa=+-]*)?0?777$/.test(a) || a === "a+rwx"))
    return "`chmod 777` makes files world-writable; use the minimal mode needed";
  // 4. filesystem/device destroyers
  if (/^mkfs(\.\w+)?$/.test(cmd)) return "`mkfs` formats a filesystem";
  if (cmd === "dd" && args.some((a) => /^of=\/dev\//.test(a)))
    return "`dd of=/dev/...` overwrites a raw device";
  return null;
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const command = input.tool_input?.command ?? "";
  let why = null;
  // curl|wget piped to a shell, or shell-of-download substitution: whole-command
  // patterns (they span segments by nature).
  if (/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/.test(command))
    why = "piping a download straight into a shell executes unreviewed remote code";
  else if (/\b(ba|z|da|k)?sh\s+<\(\s*(curl|wget)\b/.test(command) ||
           /\b(ba|z|da|k)?sh\s+-c\s+["']?\$\(\s*(curl|wget)\b/.test(command))
    why = "executing a downloaded script without review runs unreviewed remote code";
  else if (/:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/.test(command))
    why = "fork bomb";
  else {
    for (const seg of command.split(/(?:\|\||&&|;|\||\n)/)) {
      why = checkSegment(seg);
      if (why) break;
    }
  }
  if (why) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `[dangerous-command] Denied: ${why}. If this is genuinely needed, ask the ` +
          `operator or use a narrowly scoped alternative (SECURITY.md §17).`,
      },
    }));
  }
} catch { /* a guard hook must never brick the session */ }
process.exit(0);
