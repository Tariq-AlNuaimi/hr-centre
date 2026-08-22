---
name: batch
description: Runs a repetitive per-file job -- codemod, migration, annotation -- as capped headless claude -p runs across many files instead of one giant interactive session. Use for applying the same change, codemod, or rename across 10+ similar files.
---

# Headless batch runner (token thrift, ADR-019)

The Airbnb pattern sized for a solo dev: each file gets a FRESH minimal
context, a capped number of turns, and validation gates — cheap bounded
retries instead of one session dragging the whole history through N files.

## Steps

1. Confirm the per-file transformation prompt with the operator (one sentence
   - an example diff on ONE file done interactively first — never batch an
     unvalidated prompt).
2. Build the file list (`git ls-files` + glob). Show count + estimated cost
   (~3-8k tokens/file on sonnet) and get a go.
3. Loop (bash), per file:
   ```bash
   claude -p "$(printf "$PROMPT_TEMPLATE" "$FILE")" \
     --allowedTools "Read,Edit,Bash(npx tsc *)" \
     --max-turns 6 --model sonnet --output-format json > "/tmp/batch-$ID.json"
   jq -r '.total_cost_usd' "/tmp/batch-$ID.json" >> /tmp/batch-costs.log
   ```
4. Validation gate after each file: `npx tsc --noEmit` (fail -> ONE retry with
   the error appended to the prompt; fail again -> park the file in a
   "needs-human" list, move on. Never loop unbounded.)
   - **Parked files stay in the tree with their changes applied** — the edit is
     not reverted, it just failed typecheck. The operator either fixes it by hand
     or reverts that one file with `git checkout -- <file>`.
5. After the run: `npm run ship`, report files done / parked / total cost
   (sum of /tmp/batch-costs.log).
   - **If `/ship` is red,** the failure is almost always a parked file. Identify
     the parked file(s) from the needs-human list, then fix or
     `git checkout -- <file>` each one until `/ship` is green. **Batch is not a
     license to land red** — the green-`/ship` bar still applies before any push.

## Rules

- Max 2 attempts per file; parked files are reported, not retried forever.
- Sonnet by default; haiku only for purely mechanical rewrites with a
  validation gate that would catch nonsense. Examples:
  - **haiku** — mechanical one-liners: rename an import, add a missing
    `"use client"` directive, swap a deprecated API call for its replacement.
  - **sonnet** — multi-step reasoning: convert a fetch list page to an RSC,
    rewrite a handler to use an auth wrapper + zod, untangle a type error.
- Run from a clean tree so a bad batch is one `git checkout -- .` away
  (ask the operator before that revert, as always).

## Verification

Before calling this done:

- [ ] Every file in the list is accounted for as done or parked — none silently
      dropped from the report
- [ ] Parked files (2 failed attempts) are named explicitly, not folded into "done"
- [ ] `npm run ship` is green after the run (a red `/ship` means a parked file
      remains — fix or `git checkout -- <file>` it)
- [ ] The report states files done / parked / total cost

**Emits:** the per-file diffs applied to the tree — no separate log artifact
persists (`/tmp/batch-costs.log` is ephemeral scratch, not a committed receipt).
