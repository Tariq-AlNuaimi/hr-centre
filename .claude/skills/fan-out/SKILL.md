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

3. **Start from a clean tree.** Commit or stash unrelated WIP first. `check-overlap`
   snapshots the pre-wave dirty set to a baseline so `verify-scope` subtracts it — but a
   clean start keeps the signal unambiguous. (Run `check-overlap` from the state you'll
   dispatch from, so the baseline is accurate.)

4. **Dispatch the wave — native, one message.** Send all units as parallel subagents
   **in a single message** (this is native in-message dispatch — the mechanism ADR-057
   kept). Give each subagent: its task, its **exact file-ownership set**, and an
   explicit instruction to write ONLY those files. Route each to its declared tier.
   While the wave runs you are **orchestrator-only** — do not edit wave files yourself.

5. **Verify scope (post-dispatch).** After all units return, confirm the wave's combined
   change-set is **aggregate-disjoint** — every changed file matches exactly one declared set:

   ```bash
   npm run fan-out -- verify-scope docs/blueprints/.fan-out.json
   ```

   - **0 matches** for a file → an out-of-scope write. Revert it (`git checkout -- <f>`
     or `git clean`) or re-run that unit with a tighter instruction.
   - **≥2 matches** → the sets collided on a real file; the units were not disjoint —
     reconcile by hand and tighten the manifest.
   - _Attribution limit:_ native dispatch shares ONE working tree, so this checks the
     combined change-set, not "unit B stayed out of unit A's files." A stray write that
     lands inside _another_ unit's declared set still matches exactly one set and passes —
     so step 6's manual per-unit glance still matters. (Per-subagent isolation is an
     ADR-057 migration trigger, not built here.)

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

## Worktree isolation (P6 recipe — when one working tree isn't enough)

Native dispatch shares ONE working tree, so `verify-scope` checks the combined change-set,
not "unit B stayed out of unit A's files" (the attribution limit above). When that isn't
enough — units that genuinely must **write the same paths** (they can't be made disjoint), or
work where a stray cross-unit write would be costly to untangle — give each unit its **own git
worktree** so isolation is physical, not just declared. ADR-057 named this a migration trigger,
not the default: worktrees cost ~200–500 ms setup + disk each, so reach for them only when the
overlap is real.

**Native path (preferred).** The `Agent` tool takes `isolation: "worktree"` — the subagent runs
in a fresh worktree, auto-removed if it made no changes. Use it when spawning units that mutate
files in parallel and would otherwise collide; each unit's writes land in its own tree, and you
integrate the results afterward. This is the same mechanism `/fan-out`'s overlap gate exists to
avoid needing — use it when the units simply can't be partitioned.

**Manual path (a shell wave, or to inspect before merging).** From a clean tree:

```bash
# one worktree + throwaway branch per unit (siblings of the repo, never nested inside it)
git worktree add ../wt-unitA -b wave/unitA
git worktree add ../wt-unitB -b wave/unitB
# ...run each unit's work inside its own worktree (cd ../wt-unitA && …), in parallel…
# integrate: merge each unit's branch back onto the working branch. NOTE: this is an
# OCTOPUS merge (multiple branches at once) — it auto-succeeds ONLY when the branches
# don't touch the same lines. If it reports a conflict it aborts cleanly (no data loss):
#   git merge --abort   # then merge sequentially and resolve each in turn:
#   git merge --no-ff wave/unitA   # resolve + commit
#   git merge --no-ff wave/unitB   # resolve + commit   (or cherry-pick specific commits)
git merge --no-ff wave/unitA wave/unitB
# tear down — worktrees are scratch, never left lying around (safe -d: the branches
# are merged above, so they delete cleanly; force -D is unnecessary and is deny-listed)
git worktree remove ../wt-unitA && git branch -d wave/unitA
git worktree remove ../wt-unitB && git branch -d wave/unitB
git worktree prune
```

Then the normal close: integrate → **one** `npm run ship` over the combined result → commit +
push. Cautions: worktrees live OUTSIDE the repo dir (siblings), never nested; each is a full
checkout (disk cost); the shared `.git` means a branch is checked out in at most one worktree at
a time; and `node_modules`/`.env` are per-worktree, so a unit that needs deps/DB pays the
bootstrap in its own tree. If the units can be made write-disjoint instead, do that — the
overlap gate + one shared tree is cheaper.

## Skip-when

- **One unit, or the units share files** → just do the work (or serialize); a wave of one
  is overhead. Overlapping sets fail the gate by design.
- **B depends on A's output** → sequential chain, not a fan-out. Run A, then B.
- **50+ near-identical per-file edits** → that is `/batch` (capped headless loop), not a
  fan-out of distinct units.
- **Visibly-coordinated agents that message each other** → native Agent Teams territory;
  `/fan-out` is for independent write-disjoint units, not a shared task list.

## Verification

Before calling this done:

- [ ] a manifest exists at `docs/blueprints/.fan-out.json` with a disjoint
      file-glob set + tier per unit
- [ ] `npm run fan-out -- check-overlap docs/blueprints/.fan-out.json` exited
      zero before the wave was dispatched
- [ ] the wave was dispatched as parallel subagents in one message, each told
      to write only its declared file set
- [ ] `npm run fan-out -- verify-scope docs/blueprints/.fan-out.json` reports
      every changed file matching exactly one declared set (no 0-match or
      ≥2-match files)
- [ ] one `npm run ship` ran over the combined result, green, before commit + push

**Emits:** the `docs/blueprints/.fan-out.json` manifest plus a clean `verify-scope` result.
