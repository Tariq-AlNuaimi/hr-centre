---
name: fan-out
description: Orchestrate a write-disjoint task as a parallel subagent wave with ENFORCED file-ownership. Use when a task splits into ≥2 units that touch non-overlapping file sets and you want them run concurrently with a hard disjointness check. Trigger phrases - "/fan-out", "fan this out", "parallelize these", "run these in parallel", "split across agents".
---

# Parallel fan-out with enforced file-ownership (ADR-057)

The custom-verdict implementation of ADR-057. V2-104 made parallel-by-default the
_instruction_; native subagent dispatch does the _work_; this skill is the
**enforcement** native lacks — declared file-ownership sets that are checked for
disjointness **before** dispatch and verified **after** return. It does not replace
native dispatch; it wraps it with guardrails.

Use it for a task that decomposes into **≥2 write-disjoint units**. If units share
files or B needs A's output, they are NOT a wave — serialize them (see Skip-when).

## Steps

1. **Decompose + declare ownership.** Break the task into units. For each unit write
   an explicit, disjoint set of file globs it may write, plus its ADR-022 tier
   (scout/haiku read, sonnet implementation, opus architecture). Capture it as a
   manifest at `docs/blueprints/.fan-out.json` (gitignored scratch is fine):

   ```json
   {
     "units": [
       { "id": "auth", "tier": "sonnet", "files": ["lib/auth.ts", "lib/validations/auth.ts"] },
       { "id": "routes", "tier": "sonnet", "files": ["app/api/widgets/**"] }
     ]
   }
   ```

2. **Gate — refuse on overlap (pre-dispatch).** Run the disjointness check; it exits
   non-zero and names the colliding globs if any two sets could match a common path:

   ```bash
   npm run fan-out -- check-overlap docs/blueprints/.fan-out.json
   ```

   Overlap → narrow the sets or serialize the overlapping units. **Do not dispatch a
   wave that failed this gate** — that is the whole point of the custom verdict.

3. **Start from a clean tree.** Commit or stash unrelated WIP first (verify-scope reads
   working-tree status, exactly like `/batch`). A dirty tree makes the post-check lie.

4. **Dispatch the wave — native, one message.** Send all units as parallel subagents
   **in a single message** (this is native in-message dispatch — the mechanism ADR-057
   kept). Give each subagent: its task, its **exact file-ownership set**, and an
   explicit instruction to write ONLY those files. Route each to its declared tier.
   While the wave runs you are **orchestrator-only** — do not edit wave files yourself.

5. **Verify scope (post-dispatch).** After all units return, confirm every changed
   file landed in exactly one declared set:

   ```bash
   npm run fan-out -- verify-scope docs/blueprints/.fan-out.json
   ```

   - **0 matches** for a file → an out-of-scope write. Revert it (`git checkout -- <f>`
     or `git clean`) or re-run that unit with a tighter instruction.
   - **≥2 matches** → the sets overlapped on a real file (step-2 heuristic missed it) —
     the units were not disjoint; reconcile by hand and tighten the manifest.

6. **Integrate + ONE `/ship`.** Glob-confirm each unit wrote its files, read the
   combined diff, then run **one** `npm run ship` over the whole result (never per-unit).
   Green → commit + push as usual. Add an evidence line if this wave is itself the
   deliverable (which units, disjoint sets, verify-scope clean).

## Rules

- **Overlap gate is not advisory.** A failed `check-overlap` blocks the wave. Serialize
  instead — a dependency/overlap is a sequential chain, not a fan-out.
- **Clean tree in, verified tree out.** `verify-scope` only tells the truth from a clean
  start; run it before you trust the wave.
- **Orchestrator-only during a wave.** The main session coordinates and integrates; it
  does not also edit the units' files (that would create the overlap the gate forbids).
- **One `/ship`, not N.** Ship the combined result once; a per-unit ship wastes the
  wall-clock the wave just bought (Pillar 1, Speed & Velocity).
- **The manifest is scratch.** `docs/blueprints/.fan-out.json` is a working file, not a
  committed blueprint — it does not satisfy the ADR-033 blueprint gate.

## Skip-when

- **One unit, or the units share files** → just do the work (or serialize); a wave of one
  is overhead. Overlapping sets fail the gate by design.
- **B depends on A's output** → sequential chain, not a fan-out. Run A, then B.
- **50+ near-identical per-file edits** → that is `/batch` (capped headless loop), not a
  fan-out of distinct units.
- **Visibly-coordinated agents that message each other** → native Agent Teams territory;
  `/fan-out` is for independent write-disjoint units, not a shared task list.
