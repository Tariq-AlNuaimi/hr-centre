# Full template-adoption prompt

A durable, reusable prompt for a **fresh session**. Paste the block below to have
Claude drive any fork repo to **100% parity with this template's rail** — agents,
skills, hooks/watchdogs, settings bindings, permission rules, ESLint rules, gates,
invariants, and governance — so the fork behaves exactly like the template as you
build features, while its own feature code stays intact.

This is an **active adoption** prompt (it applies changes and proves parity), not a
read-only audit. It works on a branch and leaves merging to the fork's `main` to you.

> Scope discovery is built in: it lists the in-scope repos and asks which to adopt.
> It uses `/sync-from-template` as the backbone, then goes beyond it to force parity.

---

## The prompt

```
FULL TEMPLATE ADOPTION — bring repo(s) to 100% parity with this template's rail.

ROLE & GOAL: This template (the Fullstack Next.js "Prototype Rail") is the single source
of truth — its `main` branch. Your job is not to report drift but to ELIMINATE it: make
each target repo ADOPT 100% of the template's harness/rail so it behaves EXACTLY like the
template as features get built — the agents, skills, hooks/watchdogs, settings bindings,
permission rules, ESLint rules, gates, invariants, and governance must all be present and
behavior-identical. Nothing is allowed to be missing. Then PROVE parity.

CRITICAL DISTINCTION:
- THE RAIL (template-owned — force to 100% parity, must behave identically): everything
  below. If the fork's copy differs from the template's, the template wins (reconcile
  mixed/Ask-before files carefully — see METHOD).
- THE FORK'S OWN WORK (never overwrite): its feature code (app/ business pages + components
  for its domain), its own Prisma models + validations + services for its entities, its
  identity (package name, app display name, README/CLAUDE headers, deploy/domain config),
  its own ADRs, and its own docs/agent-memory entries. Adopting the rail must NOT clobber
  these. If a rail file and fork feature-code are entangled, STOP and ask me.

THE RAIL — every item must reach 100% parity (enumerate and check each off; miss nothing):
1. AGENTS: every subagent definition the template ships (e.g. scout, senior-code-reviewer,
   Explore/Plan configs) under .claude/agents/ (or wherever defined) — present + identical.
2. SKILLS: every .claude/skills/*/SKILL.md AND its backing scripts — every skill present,
   same version/behavior. No skill missing, none stale.
3. HOOKS / WATCHDOGS: every .claude/hooks/* (session-start, session-stop, context-watchdog,
   and any others) present AND correctly BOUND to its event in .claude/settings.json.
   KNOWN TRAP: a hook script copied without its settings.json event binding does nothing —
   verify the binding exists and fires, don't just verify the file is present.
4. PERMISSIONS: .claude/settings.json allowlist + deny-list identical (npm/prisma/docker/
   make/non-destructive git allowed; destructive git denied; read-denials for .next/
   node_modules/generated).
5. ESLINT RAIL: eslint-rules/ (all 10 local rules) + eslint config wiring them at `error`.
6. INVARIANT LIB (Ask-before — reconcile, don't blind-overwrite): lib/prisma/* (audit-
   extension + SCRUB_FIELDS, soft-delete), lib/api-helpers.ts (auth wrappers), lib/
   rate-limit.ts, lib/email.ts, lib/export.ts, middleware.ts — behavior must match the
   template's invariants.
7. GATES: scripts/ship.mjs (the /ship gate with all phases) + npm scripts; scripts/
   install-senior-review.mjs; .github/workflows/* (senior-review.yml etc., dormant OK).
8. GOVERNANCE: CLAUDE.md hard rules + standing instructions + Ask-before surface; SECURITY.md
   scaffolding; every docs/decisions/ADR-*; docs/token-policy, REPO-MAP, agent-memory
   (structure), findings-register, uat-rubric, recipes, design-recipes.
9. CONFIG SURFACE: project.config.json schema (tier/tierAck, config-driven locales), i18n/
   config.ts derivation, tokens.css / antd-theme.ts, contract tests (tests/contracts/*).

METHOD (apply, don't just report):
1. Baseline the template `main`: build the full template-owned manifest (the 9 groups above
   — list every actual path so nothing is missed).
2. Discover targets via mcp__claude-code-remote__list_repos (load via ToolSearch); if which
   repos is ambiguous, list candidates and ask me. add_repo as needed. Audit only in-scope repos.
3. Per repo, on a NEW working branch (never the fork's main directly):
   a. Run /sync-from-template as the backbone (path-scoped, additive checkout of template-
      owned layers + the version marker).
   b. Go BEYOND it: for EVERY manifest path, diff fork-vs-template and bring to identical.
      Pure template-owned files (agents/skills/hooks/eslint-rules/scripts/ADRs/workflows) →
      make byte-identical. Mixed/Ask-before files (lib/*, CLAUDE.md, middleware, project.
      config.json) → produce a review diff and reconcile to template semantics; surface any
      genuine conflict with the fork's feature work to me before overwriting — never silently
      drop fork logic.
   c. Re-bind hooks: confirm each hook script has its settings.json event binding and the
      permission allow/deny lists match the template.
4. PROVE PARITY (the deliverable): a diff of every template-owned path returns ZERO drift;
   every agent/skill/hook is present and bound; `npm run ship` goes GREEN; senior-review is
   wired. Record the sync-from-template version marker so future drift is detectable.
5. Use scout/Explore agents for breadth sweeps (token thrift); verify by reading real files.

OUTPUT (per repo):
- ADOPTED: files added/updated to reach parity, grouped by the 9 rail groups.
- CONFLICTS: mixed/Ask-before files where the template and fork feature-code disagreed —
  what I reconciled vs what needs your decision.
- PARITY PROOF: the zero-drift path list + `npm run ship` result + hooks-bound confirmation.
- VERDICT: "Behaves exactly like the template? YES / NO" with any residual gap and why.
- Left the work on a branch; nothing merged to the fork's main without your sign-off.

RULES: Never force-push or touch a fork's main without my approval. Never overwrite the
fork's feature code, identity, or data. Verify by reading actual files — no assumptions.
The success bar is literal: every rail item present, identical, and behaving — nothing missed.
```
