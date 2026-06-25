# Agent memory (durable, cross-session)

Long-lived knowledge that should survive across sessions **and** propagate to
forks (this file lands on `main`; forks inherit it at fork time). It is the
durable counterpart to `docs/SESSION-HANDOFF.md` — that file is transient
in-flight state on a working branch; **this** file is decisions, gotchas, and
conventions worth keeping.

The `SessionStart` hook surfaces this file into the session, so every line is a
recurring context tax — same discipline as CLAUDE.md.

## How to use it
- Append a one-line, **dated** entry to the right section (newest at top of each
  section). Use `/remember "<entry>"`, or it accrues automatically when
  `/handoff-session` promotes its "Decisions".
- **Curation rule — keep it bounded (~150 lines).** When an entry becomes a
  stable rule, promote it into CLAUDE.md or an ADR and delete it here. Prune
  entries that no longer apply. If this file is consistently over budget, the
  fix is promotion + pruning, not a bigger budget.
- One fact per line: `YYYY-MM-DD — <fact>` (add `(ADR-NNN)` / `file:line` when
  there is a canonical home).
- **Never write secrets, passwords, tokens, or Restricted values here.** This
  file is tracked, lands on `main`, is inherited by forks, and is printed into
  every session at startup — treat it like CLAUDE.md, not like `.env`.

## Durable decisions
<!-- choices made with the operator, so they are not relitigated -->
- 2026-06-25 — Harness-hardening sweep (branch `claude/repo-skills-overview-baheeu`,
  from 15 operator complaints): added `/blueprint` (tiered pre-build gate),
  `/design-system` (proactive UI), `/docker` skill; Five Pillars now binding in
  CLAUDE.md + a scalability scan in `/ship`; wave-off findings go in
  `docs/findings-register.md` (never silently dropped); `Stop` hook guards
  unpushed/uncommitted work. Operator wants these as BLOCKING gates — hardening
  roadmap is in `docs/SESSION-HANDOFF.md`.
- 2026-06-25 — Design: build a NATIVE vetted design system rather than importing
  external "Claude design skills" wholesale (consistency with the ADR-022 ruflo
  rejection — unvetted third-party skills are an Ask-before).
- 2026-06-25 — Blueprint/discovery gate applies to EVERY feature, scaled by tier
  (lightweight for `/quickstart`, full for multi-file/shared) — closes the
  "throwaway skips spec → hallucinated requirements" loophole.
- 2026-06-20 — Adopted cross-session agent memory as committed Markdown + model
  routing as a documented tier table; evaluated and rejected ruflo wholesale
  (unverified claims, destructive-preinstall history, off-Anthropic egress,
  `--dangerously-skip-permissions`). (ADR-022)

## Gotchas & landmines
<!-- non-obvious traps a future session must not trip on; prefer a code/ADR pointer -->
- 2026-06-25 — `/ship` scalability scan (`scripts/ship.mjs` `scanScalability`)
  tests bound tokens (take/skip/cursor/paginat) against each `.findMany(` CALL
  SITE (~250 chars after the call), NOT file-wide — a comment word "take"/"skip"
  must not mask a genuinely unbounded query. `walkRoutes` guards `statSync` so a
  broken symlink under `app/api` can't hard-kill `/ship`. Per-file waiver marker:
  `pillar:scalable-ok` (+ a register line).
- 2026-06-24 — `gitleaks` is NOT on PATH in fresh remote containers, so `/ship`
  goes red at phase B ("gitleaks is not on PATH"). Install the release binary to
  `~/.local/bin` (e.g. v8.21.2 from github.com/gitleaks/gitleaks/releases) and
  re-export PATH before `/ship`. The binary does not survive a new container.
- 2026-06-24 — SessionStart hook now installs deps / regenerates the Prisma client
  on **stale** (package.json or schema.prisma newer than node_modules/generated),
  not just missing (`.claude/hooks/session-start.sh`, ADR-023 commit) — this fixes
  the trap below. Until that lands on `main`, the manual workaround still applies.
- 2026-06-20 — SessionStart hook installs deps / generates the Prisma client only
  when **missing, not stale**. After checking out a branch whose `package.json` or
  `prisma/schema.prisma` moved ahead, run `npm install` + `npx prisma generate`
  before `/ship` or typecheck fails on phantom missing modules / fields.
- 2026-06-20 — Fresh containers can have local `main` far behind `origin/main`.
  Before fast-forward-merging a working branch into `main`, verify `origin/main`
  is an ancestor of the branch (`git merge-base --is-ancestor origin/main <branch>`)
  so the FF doesn't strand remote commits.

## Conventions discovered
<!-- patterns/idioms established in practice that are not yet written down elsewhere -->
- (none yet — promote stable ones into CLAUDE.md / an ADR, then remove here)
