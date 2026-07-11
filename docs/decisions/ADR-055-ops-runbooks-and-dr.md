# ADR-055 — Operational runbooks + DR restore-drill (`docs/runbooks/`)

**Status:** Proposed
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The v2 enterprise benchmark's remaining-surface sweep (`docs/research/v2/20-remaining-sweep.md`, surface #5 — "DR / runbooks / status page / chaos") named a specific asymmetry: the harness ships an **`sre` role-agent** (`.claude/agents/sre.md`, ADR-047) whose whole job is to review operational readiness — observability, failure modes, rate-limits, deploy/rollback, and _runbook & on-call_ — but there is **no runbook artifact for it to review**. Its fifth readiness lens ("Is there enough written down that someone who is not the author can operate it?") has nothing to trace against. The same gap shows up at `/deploy` and `/handoff`: we hand a live URL (or a Docker image) to a reviewer or an IT team with no incident-response procedure, no rollback checklist, and — most acutely — **no evidence that the database can actually be restored from a backup**.

Backup _tooling_ is owned elsewhere (the sweep's C02 lane — WAL-G for self-host Postgres; Neon's managed PITR for the default Vercel + Neon rail per ADR-006). What is missing is the _practice_ layer on top: the runbooks that turn tooling into a repeatable operator procedure, and the **restore drill** that proves a backup is restorable _before_ an incident, not during one. An untested backup is a hope, not a control — the failure mode this ADR closes is the classic "backups ran green every night for a year and none of them restored."

The sweep graded this **ADOPT (net-new), Fit 5/5, P1** — the highest-value governance gap after a docs site, and cheap: it is documentation, not a dependency. This ADR is the decision of record for that adoption.

## Decision drivers

- The `sre` agent (ADR-047) reviews runbooks but **has no runbook to review** — the artifact is the missing half of a control that already exists.
- `/handoff` (ADR-006: prototype → IT team in a different repo) must hand over an _operational_ package, not just code — the receiving team needs the "what to do at 3am" doc.
- An **untested backup is not a backup.** Deploy-per-tenant (one Neon/Postgres stack per deploy) means every tenant needs a restore procedure that has actually been exercised.
- Zero new runtime dependency, zero new `/ship` phase — this is docs + a checklist, so it does not touch any fork's green.
- Config-as-code / everything-in-repo ethos: runbooks live in the repo next to the ADRs and the code they operate, versioned and reviewable, not in an external wiki that drifts.

## Considered options

### Option 1 — Markdown runbooks in-repo under `docs/runbooks/` (chosen)

A committed `docs/runbooks/` set (README index + restore-drill + deploy-rollback + incident-response + database-operations), checklist-driven and tied to this repo's real files/commands (`vercel.json`, `Makefile` targets, `/ship`, `/deploy`, `lib/prisma/*`, `app/api/health`, `app/api/internal/audit-purge`).

- Good, because it is the artifact the `sre` agent's runbook lens traces against — the review target and the operated procedure are the same versioned file.
- Good, because it travels with `/handoff` and `/deploy` for free (the IT team clones the repo and has the ops package), and diffs in review like any other change.
- Good, because it stays in lockstep with the code: a PR that changes `vercel.json` or a migration convention updates the runbook in the same diff, and `senior-code-reviewer` / `/code-review` can flag drift.
- Good, because it is stack-grounded — steps name real commands (`make docker-prod-up`, `prisma migrate deploy`, `curl /api/health`) instead of generic SRE boilerplate.
- Bad, because markdown runbooks are passive — nothing _enforces_ the restore drill actually runs on a cadence (mitigated by wiring a "restore-drill green" checklist item into `/handoff`, and by the review cadence in the README).

### Option 2 — External runbook wiki (Confluence / Notion / GitBook)

Runbooks in a hosted wiki linked from the repo.

- Good, because richer editing, cross-project linking, and non-developer contributors can edit without git.
- Bad, because it drifts from the code — the wiki says `output: "standalone"`, the repo pivoted to Vercel + Neon (ADR-006), and nobody notices; the `sre` agent (read-only, repo-scoped) cannot read it, so the runbook lens still has nothing to trace against.
- Bad, because it fails the self-host / data-sovereignty pivot and the "everything-in-repo" ethos — a per-tenant deploy that is air-gapped cannot reach a SaaS wiki, and the `/handoff` package is no longer self-contained.
- Bad, because it adds an integration boundary (auth, access, export) of exactly the kind ADR-006 spent its budget removing.

### Option 3 — No runbooks; rely on the `sre` agent + tribal knowledge

Keep the status quo: the agent reviews readiness ad hoc, the operator remembers the procedures.

- Good, because zero authoring cost.
- Bad, because it leaves the `sre` agent's runbook lens permanently un-anchored — the gap the sweep flagged stays open.
- Bad, because "the operator remembers" is exactly the single-point-of-failure a runbook exists to remove; at `/handoff` the receiving team inherits nothing operable, and a 3am incident is debugged from scratch.
- Bad, because the restore path is never exercised until a real data-loss event — the untested-backup failure mode ships to every tenant.

## Decision

Adopt **Option 1**: a committed `docs/runbooks/` operational-runbook system plus a periodic **restore drill** that proves backups actually restore. The starter set ships five files — `README.md` (index + how-used + review cadence), `restore-drill.md`, `deploy-rollback.md`, `incident-response.md`, `database-operations.md` — each concrete and checklist-driven, tied to this repo's real commands and files. Drivers 1 and 2 tip it: the runbooks are simultaneously the `sre` agent's review target and the `/handoff` operational package, and only an in-repo artifact can be both. The restore drill (driver 3) is the load-bearing one — a dated, repeatable procedure that restores a Neon PITR snapshot (default rail) or a WAL-G base backup (self-host) into a throwaway target and verifies row counts + `/api/health`, so "can we restore?" is answered by evidence, not assumption.

**Future `/runbook` skill seam (recorded, not built).** A `/runbook` skill (generate a new runbook from a template; update an existing one when the code it operates changes; validate that every runbook's referenced command still exists) is the natural next step — it would do for runbooks what `/adr` does for decisions. This ADR **records the seam and does not build the skill**: the starter set is hand-authored and correct today; the skill is a P2 follow-on once the runbook shape has settled across a few forks. Building it now would be speculative tooling over a two-week-old artifact.

Scope guard: this ADR is the **runbook + restore-drill (practice) layer only**. It does not adopt a status page (Gatus / Uptime Kuma) or a chaos harness (Toxiproxy / Chaos Toolkit) — those stay `/scale-up` ADD-AS-OPTION rows per the sweep. It does not choose backup _tooling_ (WAL-G / Neon PITR — the C02 lane); it _references_ whichever the deploy uses.

## Consequences

### Positive

- The `sre` agent's runbook lens finally has a concrete artifact to trace against — the review target and the operated procedure are one versioned file, so a review finding maps to a real doc edit.
- `/handoff` and `/deploy` gain an operational package for free: the IT team (ADR-006) clones the repo and inherits incident response, rollback, and a _proven_ restore procedure.
- The restore drill converts "backups are green" into "a restore was demonstrated on `<date>`" — the untested-backup failure mode is closed with evidence, not hope.
- Zero runtime dependency, zero new `/ship` phase — no fork's green is affected; this is pure docs + a checklist.
- Runbooks stay in lockstep with the code they operate (same repo, same PR, same review), so the wiki-drift failure of Option 2 cannot happen.

### Negative

- Markdown runbooks are passive: nothing hard-_gates_ that the restore drill runs on cadence, so a lax operator can let it go stale (a green-looking runbook nobody has re-run).
- Authoring + maintenance cost: five docs must be kept accurate as `vercel.json`, the Makefile targets, and the migration conventions evolve — a stale runbook is worse than none because it is trusted.
- The starter set is grounded in _this_ stack (Vercel + Neon default, Docker/Caddy self-host, Prisma migrate-at-build); a fork that pivots off the rail must update the runbooks or they mislead.

### Mitigations

- Wire a **"restore-drill green (dated within cadence)"** checklist item into `/handoff` so a handoff cannot claim operational readiness with a stale or never-run drill; the README states the review cadence (quarterly, and after any change to the deploy/migration path).
- Keep runbooks **command-grounded** — every step names a real file/command in this repo, so a code change that breaks a step surfaces in `/code-review` / `senior-code-reviewer` as an out-of-date reference, and the future `/runbook` skill's validate mode will lint referenced commands automatically.
- The `README.md` index records **owner + last-reviewed date** per runbook, making staleness visible rather than silent.

## Alternatives considered

See Considered options.

1. **External runbook wiki** — drifts from code, unreadable by the repo-scoped `sre` agent, fails the self-host/air-gap and everything-in-repo pivot; rejected.
2. **No runbooks (agent + tribal knowledge)** — leaves the `sre` runbook lens un-anchored and ships the untested-backup failure mode to every tenant; rejected.

## Migration triggers

Revisit this decision when any of these fire:

- **The runbook set outgrows hand-authoring** (a fork maintains > ~8 runbooks, or several forks drift) → build the recorded **`/runbook` skill** (generate/update/validate) to keep them in sync mechanically.
- **A restore drill fails or is skipped at a `/handoff`** → the "restore-drill green" checklist needs teeth (a `/ship`-style gate, or a dated-drill assertion), not just a checklist line.
- **A fork adopts a status page or chaos harness** (Gatus / Toxiproxy `/scale-up` rows) → add the corresponding runbook (status-page operations, game-day procedure) to the set.
- **The deploy rail changes** (off Vercel + Neon, or k8s per the compose-now-k8s-later pivot) → the deploy-rollback + restore-drill runbooks must be rewritten for the new topology, and OpenCost-style ops tooling may join the set.

## Related

- `.claude/agents/sre.md` — the operational-readiness agent whose runbook/on-call lens this artifact anchors (ADR-047 introduced it).
- `docs/research/v2/20-remaining-sweep.md` §5 — the "DR / runbooks" surface graded ADOPT / Fit 5/5 / P1; §5 also scopes status-page (Gatus) + chaos (Toxiproxy) as separate `/scale-up` options.
- ADR-006 — Vercel + Neon as the prototype-rail deploy target; the `/handoff` model (prototype → IT team) this operational package serves.
- ADR-047 — WS-8 harness hardening (introduced the `sre` and `security-architect` role-agents).
- ADR-018 — the `CRON_SECRET`-gated daily audit-purge cron (`vercel.json`; `app/api/internal/audit-purge`) referenced in `database-operations.md` / `incident-response.md`.
- ADR-030 / ADR-035 — Docker as a mandatory build artifact; `compose.prod.yaml` (Caddy + bundled/external DB profiles) referenced in `deploy-rollback.md`.
- ADR-040 — OpenTelemetry tracing (`lib/observability` / `withSpan`), the observability entry point `incident-response.md` points at.
- `docs/runbooks/` — the starter set this ADR adopts.
