# Blueprint — session automation: auto-handoff + auto-start

**Status:** BUILT (2026-07-03, session 4) — all 4 open questions answered; Parts 1/2/3
shipped (Part 3 auto-spawn ships **disabled by default**). See §What shipped.
**Owner:** Tariq Al-Naaimi

## What shipped (2026-07-03, session 4)

Operator answered the 4 open questions: **1 → (b)** auto-start incl. guarded
auto-spawn; **2 →** adopt `session-state.json` as the rendered source; **3 →**
SessionEnd + watchdog-80% trigger; **4 →** template-wide scope.

- **Part 1 — canonical status as DATA.** `docs/session-state.json`
  (+ `docs/session-state.schema.json`); `scripts/render-handoff.mjs` renders the two
  status tables into the marked `<!-- BEGIN/END:auto-status -->` region of
  `docs/SESSION-HANDOFF.md`. `--stdout` prints the block; `--check` fails on drift;
  marked-region merge leaves all operator prose untouched.
- **Part 2 — auto-handoff.** `.claude/hooks/auto-handoff.mjs` (wired into **SessionEnd**
  in `settings.json`) stamps `lastShip.sha` + re-renders the handoff + reports push
  durability. `context-watchdog.mjs` re-renders at the **80%** threshold. Both run the
  renderer with `RENDER_HANDOFF_SOFT=1` so a hook can never trap the session.
- **Part 3 — auto-start (guard + signal; NOT yet zero-touch).** `session-start.sh` surfaces
  the handoff FIRST (standing directive + the auto-status block). `scripts/auto-spawn-guard.mjs`
  is the safety kernel: it PERMITS a successor only when `autoSpawn.enabled=true` **and** the
  branch is pushed **and** the gitignored `.claude/state/last-green-sha` (written by `/ship`)
  equals **the current HEAD** **and** `consecutiveCount < cap`. It **fails closed** — a missing/
  stale signal blocks. The SessionEnd hook writes `.claude/state/auto-spawn-request.json`
  (gitignored) + prints the exact `create_trigger` params only when PERMITTED. Ships **disabled**
  (`autoSpawn.enabled=false`) so nothing is scheduled until the operator opts in.

**Firing boundary + consumer (built 2026-07-03):** hooks/scripts cannot call the Claude Code
Remote MCP and `SessionEnd` is terminal, so the *one* component that can schedule a successor is
the **agent, at closeout, in a live turn**. The consumer is `scripts/auto-spawn-fire.mjs`: it
re-checks the guard and, when PERMITTED, prints the exact `create_trigger` payload for the agent to
pass to `mcp__Claude_Code_Remote__create_trigger`, and records the spawn against the cap. Closeout
contract: (1) push + `/ship` green, (2) `node scripts/auto-spawn-fire.mjs`, (3) if it prints a
`CREATE_TRIGGER_PAYLOAD`, fire the MCP tool with it. **ENABLED for this program**
(`autoSpawn.enabled=true`, operator 2026-07-03); the **template default stays `false`** so forks
don't auto-spawn on inherit. Cap=3 backstops runaway; a human runs `auto-spawn-guard.mjs --reset`
to re-arm. Parts 1 & 2 remain fully autonomous; Part 3 is now a guarded, cap-limited, agent-fired
loop rather than just a printed hint.

**Green-for-HEAD is the gitignored signal, not `lastShip`:** `/ship` writes
`.claude/state/last-green-sha` for the exact tree it verified; the guard trusts only that (fails
closed if absent/stale). `session-state.json.lastShip` is a **display-only** value for the tables
and may lag HEAD — it is never the safety input. This avoids the defect where restamping a sha
onto a `green` status could mark an unverified commit "green for HEAD."
**Why now:** this is a long, multi-session program. The operator is losing status and
context at every manual session boundary — restarts are slow, partial context loads
lose track of the real status, and work gets interrupted. Automating the handoff→start
loop de-risks every remaining session, so build this **before C3**.

## Problem (operator's words, 2026-07-03)
> "I am tired from moving between sessions… I want this automated so the session
> auto-handoffs and auto-starts, because in many cases we lose some info, work gets
> interrupted and needs me to restart, and sometimes it takes time to load previous
> work so the agent understands where we are — and sometimes it only loads partially
> and loses track of the actual status."

Three distinct failure modes, three fixes:
1. **Lost info at the boundary** → handoff must be *always current*, not a manual step
   the session might skip. → **auto-handoff**.
2. **Slow / partial reload of "where are we"** → status must be *compact + canonical +
   machine-readable*, not reconstructed from prose each time. → **structured state file**.
3. **Manual restart friction** → the next session should *start itself* (or one click)
   already pointed at the handoff. → **auto-start**.

## Design — three parts (each independently shippable)

### Part 1 — canonical status as DATA (`docs/session-state.json`)
The grand table + the "in progress / remaining" cut become a single small JSON file the
agent updates incrementally as work lands (not regenerated from memory). Shape (sketch):
```json
{
  "program": "replatform-and-adoption",
  "branch": "claude/ui-layer-signoff-replatform-onjlrr",
  "lastShip": { "status": "green", "sha": "365fa85", "date": "2026-07-03" },
  "items": [
    { "id": "C2", "title": "primitive layer", "status": "done", "commit": "194637c" },
    { "id": "C3", "title": "screen migration", "status": "remaining", "blockedBy": [] }
  ],
  "deferred": [ { "id": "tremor", "trigger": "react19 peer" } ],
  "nextActions": ["run C3 …"]
}
```
- `SESSION-HANDOFF.md`'s grand table + in-progress/remaining table are *rendered from*
  this file (a tiny `scripts/render-handoff.mjs`), so they can never drift or partially
  load — the JSON is the source, the markdown is a view.
- Solves failure mode #2: a fresh session reads one small deterministic file to know the
  exact status, instead of parsing long prose that may load partially.

### Part 2 — auto-handoff (hooks; Ask-before)
- **`Stop` + `SessionEnd` hooks** (extend the existing `session-stop.mjs` /
  `session-receipt.mjs`): before the turn/session ends, (a) re-render `SESSION-HANDOFF.md`
  from `session-state.json`, (b) verify `git rev-list --count @{u}..HEAD == 0` (already
  hard-blocked for unpushed commits), (c) stamp `lastShip`. Handoff is now a *guaranteed
  artifact*, not a skill the session must remember to run.
- **`PreCompact` hook** (already exists — `pre-compact-refresh.mjs`): also re-inject the
  compact status table so a mid-session compaction never loses the thread.
- Keep `/handoff-session` as the *manual, richer* path (operator narrative notes); the
  hook guarantees the *baseline* is always current even if the session dies abruptly.
- **Never auto-overwrite the operator's prose notes** — the hook regenerates only the
  machine sections (tables, state), leaving hand-written landmines/lessons intact
  (marked-region merge, e.g. between `<!-- auto:start -->…<!-- auto:end -->`).

### Part 3 — auto-start (SessionStart hook + optional scheduled trigger)
- **`SessionStart` hook** (extend `session-start.sh`): load `SESSION-HANDOFF.md` FIRST
  and print the standing prompt verbatim — "show the grand table + in-progress/remaining,
  then continue at Next actions." Today it surfaces `agent-memory.md`; add the handoff at
  higher priority so the agent orients instantly.
- **Optional true auto-start** via the Claude Code Remote MCP (`create_trigger` with
  `create_new_session_on_fire: true`): when a session ends near the context limit, it
  schedules the *next* session in the same environment, whose prompt is the standing
  directive. This is the "I don't restart it myself" piece.
  - **Guardrails (mandatory):** cap consecutive auto-spawns (e.g. stop after N with no
    human turn), require the branch to be pushed + `/ship` green before spawning, and
    make it opt-in per program (a flag in `session-state.json`) so it can't run away or
    burn tokens unattended.

## Open questions (operator — answer before build)
1. **Auto-start depth:** (a) SessionStart hook only (fast manual restart, you type
   "continue"), or (b) also the scheduled-trigger true auto-spawn (zero-touch, but needs
   the runaway guardrails)? *Recommend (a) first, add (b) behind a flag once trusted.*
2. **State file vs prose:** adopt `session-state.json` as the rendered source (Part 1),
   or keep hand-maintained markdown tables? *Recommend the JSON — it's the actual fix for
   the "partial load / lost status" complaint.*
3. **Auto-handoff trigger:** on every `Stop`, only on `SessionEnd`, or only when the
   context-watchdog crosses 80%? *Recommend SessionEnd + watchdog-80%, not every Stop
   (too chatty).*
4. **Scope:** template-wide (all forks inherit) or just this program's branch?
   *Recommend template-wide — every fork benefits.*

## Effort / risk
~1–2 sessions. Ask-before (hooks + `settings.json`). Main risk is the auto-spawn runaway
/ cost — fully mitigated by the Part-3 guardrails (cap + push-green precondition + opt-in
flag). Part 1 + Part 2 are safe and high-value on their own; ship them first, Part 3 after
the operator okays the guardrails.

## Acceptance (EARS)
- **AC-1:** WHEN a session ends, THE SYSTEM SHALL leave `SESSION-HANDOFF.md` reflecting the
  current `session-state.json` with `@{u}..HEAD == 0`, with zero manual steps.
- **AC-2:** WHEN a new session starts, THE SYSTEM SHALL surface the grand table +
  in-progress/remaining + next actions before any other work.
- **AC-3:** WHEN context crosses 80%, THE SYSTEM SHALL refresh the compact status so a
  compaction cannot lose the thread.
- **AC-4:** WHERE auto-spawn is enabled, THE SYSTEM SHALL NOT spawn a successor unless the
  branch is pushed and `/ship` is green, and SHALL stop after the configured consecutive-
  spawn cap.
