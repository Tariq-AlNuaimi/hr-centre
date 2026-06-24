# Session handoff

> New session: we are mid-stream on fullstack-vibe-template. Read this, confirm
> the branch matches, then start on "Next steps" item 1. Do not re-explore what
> it answers.

**Goal** — Operator: "do we have docker as a standard for the apps" → then "yes plus
[list all agents and skills in detail so we improve them one by one]". Two
workstreams, both requested in full ("all", "everything at the same time"):
(1) standardize Docker as an opt-in self-host rail; (2) review + improve every
harness item (2 agents, 4 hooks, 21 skills). Sub-goal now: post-push verification.

**State** — Branch `claude/docker-standardization-apps-rmanu4`, in sync with origin
(0 ahead). Tree **clean**. Last `/ship`: **green** (typecheck+lint+tests+component
+build+gitleaks+npm audit, ~42s). Not deployed (template repo). HEAD = 6fdb92f.

**Done** (this session)
- 6fdb92f — Add opt-in Docker self-host rail (ADR-023) + harness improvements
  (all 27 items: agents, hooks, skills) + README/CLAUDE.md docs. Green + pushed.

**In flight**
- `senior-code-reviewer` agent launched post-push on 6fdb92f (background, id
  a81b5dd2406816757). Findings had NOT returned before handoff. NEXT SESSION:
  retrieve/await its findings; if it flags anything real, fix on this branch.
- Full proposal register (74 proposals, all 27 items + Docker D.1–D.6 + cross-cutting)
  lives at scratchpad/harness-improvements.md — but scratchpad is session-local and
  will NOT survive a fresh container. All ACCEPTED items were already implemented in
  6fdb92f, so this is reference only.

**Decisions**
- Docker = opt-in SECOND rail; Vercel+Neon stays default (ADR-006 preserved).
  `output:"standalone"` gated on DOCKER_BUILD so Vercel build is unchanged. (ADR-023)
- Harness improvement pace: implement everything (all risk tiers) in one pass, one ship.
- "replit is done" — operator confirmed it meant nothing; disregard.

**Landmines**
- gitleaks is NOT on PATH in fresh remote containers → `/ship` goes red at phase B.
  Installed v8.21.2 to ~/.local/bin this session (gone in a fresh container).
  Re-install from gitleaks releases before `/ship`.
- This session hit the documented stale-deps trap (missing @tanstack/react-query,
  @axe-core/playwright, stale Prisma client w/o passwordChangedAt). Fixed by
  `npm install` + `npx prisma generate`. The session-start.sh fix in 6fdb92f now
  auto-handles this on STALE (not just missing) — confirmed firing on resume.

**Next steps**
1. Retrieve the senior-code-reviewer findings (agent a81b5dd2406816757); triage +
   fix any real findings on this branch, re-`/ship`, push.
2. If operator wants it on main: verify origin/main is an ancestor, FF-merge, push.
3. Optional: open a PR for the branch (operator hasn't requested one yet).
