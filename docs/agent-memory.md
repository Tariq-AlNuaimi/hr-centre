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
- 2026-06-20 — Adopted cross-session agent memory as committed Markdown + model
  routing as a documented tier table; evaluated and rejected ruflo wholesale
  (unverified claims, destructive-preinstall history, off-Anthropic egress,
  `--dangerously-skip-permissions`). (ADR-022)

## Gotchas & landmines
<!-- non-obvious traps a future session must not trip on; prefer a code/ADR pointer -->
- (none yet — add traps that cost you time so the next session skips the lesson)

## Conventions discovered
<!-- patterns/idioms established in practice that are not yet written down elsewhere -->
- (none yet — promote stable ones into CLAUDE.md / an ADR, then remove here)
