---
name: batch
description: Run a repetitive per-file job (codemod, migration, annotation) as capped headless claude -p runs instead of one giant interactive session. Use for "apply X to every file", "migrate all Y", 10+ similar files. Trigger phrases - "/batch", "batch this across", "do this for every file".
---

# Headless batch runner (token thrift, ADR-019)

The Airbnb pattern sized for a solo dev: each file gets a FRESH minimal
context, a capped number of turns, and validation gates — cheap bounded
retries instead of one session dragging the whole history through N files.

## Steps

1. Confirm the per-file transformation prompt with the operator (one sentence
   + an example diff on ONE file done interactively first — never batch an
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
5. After the run: `npm run ship`, report files done / parked / total cost
   (sum of /tmp/batch-costs.log).

## Rules
- Max 2 attempts per file; parked files are reported, not retried forever.
- Sonnet by default; haiku only for purely mechanical rewrites with a
  validation gate that would catch nonsense.
- Run from a clean tree so a bad batch is one `git checkout -- .` away
  (ask the operator before that revert, as always).
