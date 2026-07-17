---
name: remember
description: Append a durable, dated entry to docs/agent-memory.md so a decision, gotcha, or convention survives across sessions and forks. Use when something is learned that the next session must not rediscover or relitigate. Trigger phrases - "/remember", "remember that ...", "note this for next time", "don't forget X", "add to agent memory".
---

# /remember — write to cross-session agent memory (ADR-022)

Appends one curated line to `docs/agent-memory.md` — the durable counterpart to
`docs/SESSION-HANDOFF.md`. Memory is long-lived knowledge that lands on `main`
and is inherited by forks; handoff is transient working-branch state. Use this
for the former.

## Steps

0. **Dedupe first.** Before appending, search `CLAUDE.md` and `docs/decisions/`
   for the same fact (grep a distinctive keyword). If it's already documented
   there, do NOT restate it — add only a one-line cross-reference in the right
   section (`YYYY-MM-DD — see ADR-NNN` / `see CLAUDE.md → "<heading>"`), or skip
   entirely if a pointer already exists. Memory is for what isn't written yet.
1. **Classify the entry** into exactly one `##` section of `docs/agent-memory.md`:
   - **Durable decisions** — a choice made with the operator (so it isn't relitigated).
   - a themed **Gotchas — …** section (deploy/env & CI · git & landing to main · stack & build ·
     security, auth & hooks · browser QA & egress · subagents) — a non-obvious trap that cost
     time; prefer a `file:line` or `ADR-NNN` pointer. Pick the closest theme; add a new
     `## Gotchas — <theme>` section only if none fits.
   - **Conventions discovered** — a pattern/idiom established in practice, not yet written elsewhere.
2. **Write one line**, newest at the top of its section:
   `YYYY-MM-DD — <fact>` (UTC date). Keep it to one fact; add `(ADR-NNN)` or
   `file:line` when there is a canonical home. Replace a section's `(none yet ...)`
   placeholder rather than stacking under it.
   Then **regenerate the digest**: `npm run memory-digest` (refreshes the `(N)` counts in the
   SessionStart digest block and warns if the digest >30 lines or any section >60). If you added
   a NEW section, also add a one-line digest entry for it (the tool flags a section with no digest line).
3. **Honor the curation rule (act proactively, don't wait for the wall).** Each `##` section is
   bounded at **≤60 lines**; only the digest (≤30 lines) is a recurring context tax. **When a
   section nears 60 lines, do NOT just append** — first promote any now-stable entry out (to
   CLAUDE.md / a `.claude/rules/*.md` file / an ADR) and delete it here, so the add lands under
   budget. Bounded sections in, bounded sections out; curate early rather than at overflow.
4. **Decide whether it belongs here at all** — the promotion decision tree:
   - **A choice made with the operator** (an architectural decision) → write an
     ADR (`/adr`) and leave a one-line pointer in **Durable decisions**.
   - **A permanent rule** the codebase must always follow → put it in `CLAUDE.md`
     and leave a pointer in **Conventions discovered**.
   - **A costly gotcha** with a canonical fix → if the fix is architectural, write
     an ADR and point the relevant **Gotchas — …** section at it; otherwise keep the
     dated line in that themed **Gotchas — …** section with a `file:line`.
     Memory is for the in-between — facts not yet stable enough for CLAUDE.md/an ADR.
5. **Commit on the working branch** (this file is meant to land on `main` via the
   normal merge): `git add docs/agent-memory.md && git commit -m "chore: remember <short summary>"`.
   You needn't push _solely_ for this — it can ride with the session's next
   push/`/ship` — **but the commit MUST reach the remote before the session ends.**
   An unpushed memory commit is invisible to the next container, which is the whole
   failure this skill exists to prevent (#14). If you're not confident another push
   is coming this session (e.g. the user is wrapping up, or context is high), push
   now and confirm it landed (`git rev-list --count @{u}..HEAD` → `0`). The
   `session-stop` guard will flag an unpushed commit, but don't rely on the human
   noticing it.

## Examples

Each fact lands under the section its kind maps to (decisions · a themed `Gotchas — …` section ·
conventions in `docs/agent-memory.md`):

```markdown
## Durable decisions

2026-06-24 — Rate limiter stays in-memory until multi-instance; revisit via Upstash (see ADR-007).

## Gotchas — browser QA & egress

2026-06-24 — Adding a locale also needs the regex in middleware.ts updated (next-intl strips the prefix).

## Conventions discovered

2026-06-24 — New audited Restricted columns extend SCRUB_FIELDS + its assertion in the same commit.
```

The first is a decision (pointer to an ADR), the second a costly gotcha (`file`
pointer), the third a convention now in CLAUDE.md (so this would be a
cross-reference line, not a fresh fact — see step 0).

## Rules

- One fact per line; dated; newest-first within a section.
- This file is surfaced at every SessionStart — treat every line as a recurring
  context tax, same as CLAUDE.md. When in doubt, promote-and-prune over append.
- Never put secrets/Restricted values here (it's tracked and inherited by forks).
