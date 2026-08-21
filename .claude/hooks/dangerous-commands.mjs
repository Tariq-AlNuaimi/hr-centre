#!/usr/bin/env node
// PreToolUse hook (Bash matcher) -- dangerous-command deny (Wave A2).
// The settings.json permission deny-list is prefix-lexical ("Bash(rm -rf *)"
// misses `cd x && rm -rf ~`); this hook is the SEMANTIC layer under it: it
// splits the command into pipeline/sequence segments and denies a short,
// conservative list of obviously destructive shapes with a reason (evidence:
// docs/deep-comparison/04-hooks.md disler + karanb192 rows). Both layers stay
// -- defense in depth. Conservative by design: substrings inside quoted args
// (`grep "rm -rf" docs/x`) do NOT trip it. No override (blueprint decision #1).
//
// KNOWN LIMITATION (2026-07-25). Segment splitting is textual — it does not parse
// quotes or heredocs. So a command that *writes about* a destructive form, where
// the quoted text itself contains a separator, can self-trip: a heredoc line
// containing `cd sub &&` followed by a discarding git command splits into a
// segment that looks like the real thing. Hit while adding the test cases below
// this very rule. Fail-closed is the right default for a destructive-command
// guard, so this is accepted, not fixed — but if you are editing a file that
// documents these commands and the hook denies you, that is why: use the Edit
// tool (which does not route through the Bash matcher) rather than a heredoc.
import { readFileSync } from "node:fs";

// Targets where `rm -rf` means catastrophe (root/home/repo-root/system dirs).
const RM_FATAL_TARGETS = new Set([
  "/",
  "/*",
  "~",
  "~/",
  "~/*",
  "$HOME",
  "${HOME}",
  "$HOME/",
  "$HOME/*",
  ".",
  "./",
  "./*",
  "..",
  "../",
  "../*",
  "*",
  ".git",
]);
const SYSTEM_DIR = /^\/(bin|boot|dev|etc|home|lib|lib64|opt|root|sbin|srv|sys|usr|var)\/?\*?$/;

// Every runner that can execute an inline one-liner. ONE list, deliberately: this was
// two independently-maintained copies -- a per-segment Set and a whole-command regex --
// and when the Set was widened with bun/npx/tsx/ts-node/sh/bash/zsh the regex was not.
// The result was a live bypass: an inline body whose destructive call sat after a `;`
// was torn in half by the segment splitter (no quote awareness), and the whole-command
// check that exists to catch exactly that did not recognise the newer runners (senior
// review, 2026-08-21). The classic runners were in BOTH lists, which is how the
// divergence hid -- the same body via `node` was correctly denied. Add a runner here
// and both checks see it.
const INLINE_RUNNERS = [
  "node",
  "nodejs",
  "python",
  "python3",
  "ruby",
  "perl",
  "deno",
  "bun",
  "npx",
  "tsx",
  "ts-node",
  "sh",
  "bash",
  "zsh",
];
const INLINE_RUNNER_ALT = INLINE_RUNNERS.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
  "|",
);

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
        (a) =>
          !a.startsWith("-") &&
          (RM_FATAL_TARGETS.has(a.replace(/["']/g, "")) || SYSTEM_DIR.test(a.replace(/["']/g, ""))),
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
    // `--all` / `--mirror` push EVERY local branch, main included, without ever naming
    // it -- so the destination check below (which inspects ref tokens) never sees it.
    // Confirmed allowed before this line existed (senior review, uncertain-item U1,
    // settled by execution 2026-08-21). `--mirror` additionally deletes remote refs that
    // are absent locally, which is a force-push-shaped operation in its own right.
    if (args.some((a) => a === "--all" || a === "--mirror"))
      return "`git push --all` / `--mirror` pushes EVERY branch including `main` without naming it -- pushing to `main` is an Ask-before action (CLAUDE.md); push the one branch you mean";
    // Direct push to the protected branch. CLAUDE.md's Ask-before list already
    // names this ("pushing to `main` directly when branch protection is on"), but
    // the ALLOW-list auto-approved `Bash(git push *)` -- so the machine permitted
    // exactly what the constitution forbade (red-team R2). Denying here makes the
    // rule enforced rather than aspirational. Feature-branch pushes fall through.
    //
    // Judge the DESTINATION ref, not the raw token. The first cut tested the whole
    // refspec against /(^|:)(main|master)$/, which only ever saw the short spelling:
    // `HEAD:refs/heads/main` and `refs/heads/main` both end in `main` but not at a
    // `:` boundary, so the two most natural full-refspec forms walked straight past
    // the deny (review round 8). Take the half after the last `:`, then its last
    // path segment -- that is the branch git will actually update.
    const pushesToProtected = args.some((a) => {
      if (a.startsWith("-")) return false;
      const dest = a.includes(":") ? a.slice(a.lastIndexOf(":") + 1) : a;
      return /(^|\/)(main|master)$/.test(dest);
    });
    if (pushesToProtected)
      return "pushing directly to `main`/`master` is an Ask-before action (CLAUDE.md); push a feature branch and open a PR, or get explicit operator sign-off";
  }
  // 2.5. git branch FORCE-delete (semantic, any flag spelling/order) -- V2-107 senior-review High.
  // The settings deny-list only allows the SAFE `git branch -d` (git refuses on an unmerged
  // branch); but `-D`, `-d -f`, `--delete --force`, `-Df`, `-fd`, `--delete -f`, ... all force-drop
  // a branch (unmerged/unpushed commits gone) and a lexical prefix rule can't cover the combos.
  // Deny force-delete here; the bare safe delete (`-d` / `--delete` alone) falls through.
  if (cmd === "git" && args[0] === "branch") {
    const shortLetters = args
      .filter((a) => /^-[A-Za-z]/.test(a) && !a.startsWith("--"))
      .flatMap((a) => a.slice(1).split(""));
    const longs = args.filter((a) => a.startsWith("--"));
    const del =
      shortLetters.includes("d") || shortLetters.includes("D") || longs.includes("--delete");
    const force = shortLetters.includes("f") || longs.includes("--force");
    if (del && (force || shortLetters.includes("D")))
      return "`git branch` force-delete (`-D` / `-d --force`) drops a branch even with unmerged, unpushed commits; use the safe `git branch -d` (git refuses on an unmerged branch) or ask the operator";
  }
  // 2.6. Destructive working-tree git ops (V2 challenge-audit M2). settings.json denies
  // these LEXICALLY (`git reset --hard*`, `git clean -f*`, `git checkout .`/`--*`,
  // `git restore .`/`--*`) -- a prefix match anchored at the string start, so a COMPOUND
  // form (`cd sub && git reset --hard HEAD~5`) slips the lexical rule. This segment-aware
  // semantic check mirrors that policy so the deny survives compounding. Bare
  // `git checkout <branch>` / `git checkout -b <branch>` (a normal switch) is untouched.
  if (cmd === "git" && args[0] === "reset" && args.includes("--hard"))
    return "`git reset --hard` discards ALL uncommitted work (working tree + index) irrecoverably; commit/stash first or ask the operator (deny-listed policy)";
  if (cmd === "git" && args[0] === "clean") {
    const cleanFlags = args.filter((a) => a.startsWith("-"));
    const force = cleanFlags.some((a) => a === "--force" || /^-[a-zA-Z]*f/.test(a));
    if (force)
      return "`git clean -f` permanently deletes untracked files (gone -- not in git); use `git clean -n` to preview or ask the operator (deny-listed policy)";
  }
  if (cmd === "git" && (args[0] === "checkout" || args[0] === "restore")) {
    const rest = args.slice(1);
    const discardsDot = rest.includes(".");
    // Match the flags that ACTUALLY discard work, not every `--*` (2026-07-25
    // senior review). The previous `a.startsWith("--")` test denied `--track`,
    // `--quiet`, `--orphan` and `git restore --staged` -- none of which throw
    // anything away (`--staged` only UNSTAGES; it is the least destructive
    // restore form). Over-broad denials train the operator to wave the gate
    // through, which costs more safety than the extra coverage bought.
    // `--` alone is the pathspec separator: `git checkout -- <path>` is the
    // classic discard-my-edits form, so it stays denied.
    const DESTRUCTIVE = new Set(["--", "--force", "--hard", "--ours", "--theirs", "--worktree"]);
    const destructiveLong = rest.some((a) => DESTRUCTIVE.has(a) || a.startsWith("--source="));
    // `-f` inside a COMBINED short cluster (`-fq`, `-qf`) is still --force. The
    // old exact-match `a === "-f"` missed those.
    const forceShort = rest.some((a) => /^-[A-Za-z]*f/.test(a) && !a.startsWith("--"));

    // Forms that discard with NO flag at all -- the false negatives the narrowing
    // pass missed because it only chased false POSITIVES (2026-07-25 probe):
    //   `git restore <path>`        -- restore defaults to --worktree, i.e. DISCARDS
    //   `git checkout HEAD <path>`  -- pathspec checkout, discards that path
    const nonFlag = rest.filter((a) => !a.startsWith("-"));
    const longs = rest.filter((a) => a.startsWith("--"));
    let bareDiscard = false;
    if (args[0] === "restore") {
      // Only `--staged` alone leaves the working tree untouched; anything else
      // that names a path writes over it.
      const stagedOnly = longs.includes("--staged") && !longs.includes("--worktree");
      bareDiscard = nonFlag.length > 0 && !stagedOnly;
    } else {
      // checkout: a branch-creating/switching form takes ONE ref and is safe
      // (`-b`/`-B`/`--orphan`/`--track` may legitimately take a start-point too).
      // Two or more bare operands with no branch flag is the `<tree-ish>
      // <pathspec>` form, which overwrites the named paths.
      const branchForm = rest.some(
        (a) => a === "-b" || a === "-B" || a === "--orphan" || a === "--track",
      );
      bareDiscard = !branchForm && nonFlag.length >= 2;
    }
    if (discardsDot || destructiveLong || forceShort || bareDiscard)
      return `\`git ${args[0]}\` discarding tracked-file changes (\`.\` / \`--\` / \`--force\`) throws away uncommitted work; commit/stash first or ask the operator (deny-listed policy)`;
  }
  // 3. chmod 777 (incl. -R) -- world-writable
  if (cmd === "chmod" && args.some((a) => /^([ugoa=+-]*)?0?777$/.test(a) || a === "a+rwx"))
    return "`chmod 777` makes files world-writable; use the minimal mode needed";
  // 4. filesystem/device destroyers
  if (/^mkfs(\.\w+)?$/.test(cmd)) return "`mkfs` formats a filesystem";
  if (cmd === "dd" && args.some((a) => /^of=\/dev\//.test(a)))
    return "`dd of=/dev/...` overwrites a raw device";

  // ---- red-team R2b (2026-08-17): the gaps the allow-list exposed ----------
  // This guard covered `rm` but not the many ways to delete without it. The
  // settings deny-list carries lexical twins for these; prefix patterns are
  // evadable by spelling, so the semantic check is the real control.

  // 5. `find ... -delete` / `-exec` -- mass deletion, and the route by which
  // `rm -rf` re-enters after check 1 (`find . -exec rm -rf {} \;`). `find` is
  // allow-listed in its read-only forms, so this is the backstop that matters.
  if (cmd === "find") {
    if (args.includes("-delete"))
      return "`find -delete` mass-deletes every matching file with no confirmation and no undo; list the matches first (drop `-delete`), then delete deliberately";
    const execIdx = args.findIndex((a) => a === "-exec" || a === "-execdir" || a === "-ok");
    if (execIdx !== -1)
      return `\`find ${args[execIdx]}\` runs an arbitrary command over every match (\`-exec rm -rf {}\` is mass deletion, and reaches rm without tripping the rm check); list the matches first, then act deliberately`;
  }

  // 6. `shred` -- overwrites in place; strictly less recoverable than rm.
  if (cmd === "shred")
    return "`shred` overwrites file contents in place -- unrecoverable even from a backup that reads the same path; use `rm` if deletion is what you mean, or ask the operator";

  // 7. Interpreter one-liners. The guard covered `rm` while `node -e` and
  // `python3 -c` make `rm` unnecessary. Only the DESTRUCTIVE filesystem calls
  // are denied -- an interpreter one-liner is an ordinary tool, so a blanket
  // deny here would be exactly the over-broad rule that trains people to wave
  // the gate through (see the checkout/restore narrowing above).
  const INTERPRETERS = new Set(INLINE_RUNNERS);
  if (INTERPRETERS.has(cmd)) {
    const inlineIdx = args.findIndex((a) => a === "-e" || a === "-c" || a === "--eval");
    if (inlineIdx !== -1) {
      const body = args.slice(inlineIdx + 1).join(" ");
      const DESTRUCTIVE_CALLS =
        /\b(rmSync|rmdirSync|unlinkSync|rm\(|rmdir\(|unlink\(|rmtree|removedirs|remove_tree|truncateSync|ftruncate)\b/;
      if (DESTRUCTIVE_CALLS.test(body))
        return `\`${cmd} ${args[inlineIdx]}\` calling a filesystem-removal API deletes without touching \`rm\`, so the rm guard never sees it; put the script in a file and run it deliberately, or ask the operator`;
    }
  }

  // 8. Destructive subcommands of otherwise-safe tools. A wildcard over a CLI
  // grants every verb it will ever have -- the R2 lesson. These are deny-listed
  // lexically too; this survives compounding and flag reordering.
  if ((cmd === "npx" || cmd === "prisma" || cmd === "pnpm") && args.length) {
    const verbs = args.filter((a) => !a.startsWith("-"));
    // Match a VERSION-PINNED or path-qualified spec too, not just the bare word.
    // `verbs.indexOf("prisma")` returned -1 for `npx prisma@6 migrate reset`, and
    // the -1 branch then treated the whole arg list as the subcommand -- so sub[0]
    // was "prisma@6" instead of "migrate" and the destructive verb sailed through.
    // Pinning a version is the most natural thing an agent does when a command
    // fails, which made this the likeliest spelling to hit in practice, not the
    // least (review round 8).
    const at = verbs.findIndex((v) => /^(?:.*\/)?prisma(?:@[^\s]+)?$/.test(v));
    const sub = at === -1 ? verbs : verbs.slice(at + 1);
    if (sub[0] === "migrate" && sub[1] === "reset")
      return "`prisma migrate reset` DROPS and recreates the database, destroying all data; ask the operator (deny-listed policy)";
    if (sub[0] === "db" && sub[1] === "execute")
      return "`prisma db execute` runs arbitrary SQL against the live database (including DROP); ask the operator (deny-listed policy)";
    if (sub[0] === "db" && sub[1] === "push")
      return "`prisma db push` rewrites the live schema with no migration record and can drop columns; use `prisma migrate dev` or ask the operator (deny-listed policy)";
  }

  // 9. `docker compose down -v` -- removes named volumes, i.e. the dev database.
  if (cmd === "docker" && args[0] === "compose" && args.includes("down")) {
    const volumes = args.some(
      (a) => a === "--volumes" || (/^-[a-zA-Z]*v/.test(a) && !a.startsWith("--")),
    );
    if (volumes)
      return "`docker compose down -v` deletes named volumes -- that is the dev database and its data, not just the containers; drop `-v` to stop the stack, or ask the operator";
  }

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
  else if (
    /\b(ba|z|da|k)?sh\s+<\(\s*(curl|wget)\b/.test(command) ||
    /\b(ba|z|da|k)?sh\s+-c\s+["']?\$\(\s*(curl|wget)\b/.test(command)
  )
    why = "executing a downloaded script without review runs unreviewed remote code";
  else if (/:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/.test(command)) why = "fork bomb";
  // Interpreter one-liner calling a filesystem-removal API. WHOLE-COMMAND, like
  // the curl|sh checks above: the segment splitter breaks on `;` `|` `&&` with no
  // quote awareness, so `python3 -c "import shutil;shutil.rmtree('x')"` is torn in
  // half and neither piece looks dangerous. Bodies routinely contain separators,
  // so this pattern spans segments by nature (red-team R2b).
  else if (
    new RegExp(`\\b(?:${INLINE_RUNNER_ALT})\\b[^|;&\\n]*\\s(?:-e|-c|--eval)\\b`).test(command) &&
    /\b(rmSync|rmdirSync|unlinkSync|rmtree|removedirs|remove_tree|truncateSync)\b|\b(?:fs|os|shutil|FileUtils)\.\s*(?:rm|rmdir|unlink|remove)\s*\(/.test(
      command,
    )
  )
    why =
      "an interpreter one-liner calling a filesystem-removal API deletes without touching `rm`, so the rm guard never sees it; put the script in a file and run it deliberately, or ask the operator";
  // Bare redirect truncation (`> path` with NO command before it) empties a file
  // in place. `echo x > path` and friends are ordinary and stay allowed -- only
  // the commandless form, which is unambiguous truncation, is denied.
  else if (/(^|[;&|]\s*)>\|?\s*[^\s;&|<>]+\s*$/.test(command))
    why =
      "a bare `> file` redirect truncates that file to zero bytes in place; if you mean to replace its contents, write it with the Write tool, or ask the operator";
  else {
    for (const seg of command.split(/(?:\|\||&&|;|\||\n)/)) {
      why = checkSegment(seg);
      if (why) break;
    }
  }
  if (why) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            `[dangerous-command] Denied: ${why}. If this is genuinely needed, ask the ` +
            `operator or use a narrowly scoped alternative (SECURITY.md §17).`,
        },
      }),
    );
  }
} catch {
  // fail-CLOSED (WS-8/ADR-047): a destructive-command guard that can't evaluate must BLOCK, not allow.
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "dangerous-commands hook errored; DENYING by fail-closed policy (WS-8/ADR-047) " +
          "— a destructive-command guard that can't evaluate must block, not allow. NOTE: " +
          "this hook matches Bash, so a PERSISTENT (input-independent) fault denies ALL Bash " +
          "for the rest of the session and cannot be repaired from inside it. RECOVERY: an " +
          "operator removes the dangerous-commands entry from .claude/settings.json PreToolUse " +
          "(or restarts with hooks disabled), then fixes the hook.",
      },
    }),
  );
}
process.exit(0);
