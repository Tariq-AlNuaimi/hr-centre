# Maintainer runbook — evolving the harness safely

**Answers:** I need to change a gate / hook / ESLint rule / ADR / permission — how do I do
it without silently weakening the floor? · **Owner:** Maintainer · **Last reviewed:** 2026-07-17

This is the **bus-factor floor** (V2-505): the procedure a NEW maintainer follows to evolve
the harness — the `.claude/` machinery, the `/ship` gates, the ESLint rules, the ADRs — without
breaking an invariant or loosening security without a paper trail. The other runbooks in this
folder are for operating a _deployment_; this one is for operating the _template itself_.

> **New here? Read `docs/harness-orientation.md` first** (#27) — the mental model of the eight
> harness systems and how they connect. This runbook is the _procedures_; that doc is the _map_ that
> makes them make sense.

Ground rule, above every procedure below: **a change that loosens an autonomous-agent boundary
(what a hook denies, what a rule catches, what a permission allows) is security-sensitive — it
needs an explicit human decision on the record (an ADR or a `docs/findings-register.md` line),
never a silent edit.** Tightening is cheaper than loosening; when in doubt, tighten.

## Before you touch anything

- [ ] Read `CLAUDE.md` (the constitution) + the matching `.claude/rules/*.md` for the area
      (a PreToolUse hook also surfaces the rule file when you edit a matching path).
- [ ] Check the **Ask-before** list in `CLAUDE.md`. If the file is on it
      (`lib/auth.ts`, `lib/api-helpers.ts`, `middleware.ts`, `eslint-rules/**`, `lib/prisma/**`,
      `.claude/settings.json` permissions, the `Role` enum, …), STOP and get explicit operator
      sign-off first, and note it in `docs/findings-register.md`.
- [ ] Work on the branch, never `main` directly when branch protection is on. `/ship` green
      before every push (`npm run ship`).

## Change an ESLint rule (`eslint-rules/**`) — Ask-before

The thirteen `rihal-template/*` rules are the security floor. To change one:

1. [ ] Edit the rule in `eslint-rules/rules/<name>.mjs`.
2. [ ] Update its RuleTester cases in `tests/eslint-rules/rules.test.mjs` (valid AND invalid);
       a rule change with no test change is a red flag.
3. [ ] `npm run test:lint-rules` — the rule's tests must pass.
4. [ ] `npm run ship` — the rule runs at `error` across the repo; fix or justify any new hit.
5. [ ] If you **weakened** the rule (it now catches less): record why in `SECURITY.md §12` +
       get operator sign-off (this is loosening a security gate).
6. [ ] A one-off suppression is a single-line `// eslint-disable-next-line rihal-template/<rule>`;
       if security-related, log it in `SECURITY.md §12`. Never disable a rule repo-wide to dodge it.

## Change a hook (`.claude/hooks/**`) — Ask-before for the security hooks

Hooks gate what the agent reads/runs/writes at tool-time. The two **deny** hooks
(`protect-secrets.mjs`, `dangerous-commands.mjs`) fail **closed** (WS-8/ADR-047).

1. [ ] Edit the hook. Keep the fail-closed catch intact on the security hooks — a guard that
       can't evaluate must block, not allow.
2. [ ] Add/adjust the negative test in `tests/harness/hooks.test.mjs` (deny AND allow cases,
       plus the malformed-stdin fail-closed case).
3. [ ] `npm run test:hooks` — must pass.
4. [ ] If you changed the hook's **matcher** in `.claude/settings.json` (widening what it
       guards is fine; NARROWING what it guards is loosening — get sign-off + a register line).
5. [ ] The semantic backstop under the lexical deny-list is `dangerous-commands.mjs` — extend
       IT for a new dangerous pattern, don't rely on prefix patterns alone.

## Add or change a `/ship` gate (`scripts/ship.mjs`)

1. [ ] Decide the tier: **warm** (`/ship`, DB-free, ~60–90s — a normal push) vs **full**
       (`ship:full`/`SHIP_FULL=1` — +docker/bdd/integration; ADR-061). App/DB-dependent checks
       go in the FULL path (or `/qa`), never the warm loop (it must stay fast — Pillar 1).
2. [ ] A new gate that can't run everywhere must **degrade to WARN**, never a false RED (mirror
       the docker/integration gates: skip-with-note when the infra is absent).
3. [ ] Give it an escape hatch if it can block legitimately: an `*Ack` flag in
       `project.config.json` + an **adjudicated** `docs/findings-register.md` line (the ADR-025
       pattern — never a silent bypass).
4. [ ] `npm run ship` (and `npm run ship:full` if you touched the full path) — green.
5. [ ] Update the gate list in `.claude/rules/harness.md` ("Warm `/ship` vs `ship:full`").

## Write or supersede an ADR (`docs/decisions/**`)

1. [ ] Use `/adr` (it enforces the MADR template: decision drivers + per-option trade-offs).
       Preflight requires `docs/decisions/ADR-TEMPLATE.md`.
2. [ ] Changing the **ADR-001 locked stack** needs a _superseding_ ADR first — never edit the
       stack and backfill the rationale.
3. [ ] A **quarterly stack-refresh** ADR (ADR-017 track 2) fills the "Platform doctrine sync"
       section (V2-505) — check whether a native platform feature has obsoleted a custom harness
       piece (precedent: V2-105 → ADR-057), and record keep/thin/retire per area.
4. [ ] Cross-link related ADRs in `## Related`; mark the superseded ADR's status.

## Widen `.claude/settings.json` permissions — Ask-before (security-sensitive)

1. [ ] Widening `permissions.allow` (or shrinking `permissions.deny`) lets an autonomous agent
       run more without a human — **stop, get explicit operator sign-off**, and record it in
       `docs/findings-register.md` (V2-107).
2. [ ] Prefer extending the semantic `dangerous-commands.mjs` backstop over broadening a prefix
       allow.
3. [ ] `npm run test:hooks` still green.

## Add a dependency

1. [ ] Runtime dep > 50 KB minified → Ask-before (needs an ADR or a `/scale-up` recipe).
2. [ ] Any new capability under `lib/**`, `components/shared/**`, `scripts/**` → do the
       build-vs-buy scan and record a `docs/build-vs-buy-ledger.md` entry with a `Considered:`
       line (the gate denies the new file until one exists).
3. [ ] `npm run ship` — knip must see it used; `npm audit` gate must stay green (High+).

## After any harness change

- [ ] `npm run ship` green (the active gate).
- [ ] For a code push touching auth/schemas/API routes/`lib/`, run `/code-review` (pre-push)
      and invoke the `senior-code-reviewer` (post-push) — the two-stage review rail (V2-206).
- [ ] Durable decisions/gotchas → `docs/agent-memory.md` via `/remember`.
- [ ] Land green work on `main` (the fork source-of-truth); never land red.
