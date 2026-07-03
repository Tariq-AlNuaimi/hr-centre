# Repo Inventory & Metrics

A catalog of the harness assets in this template: skills, agents, hooks, ESLint
rules, scripts, npm actions, docs/ADRs, and external MCP tools — with a one-line
explanation, an approximate run time, and lines of code.

> **On "time to run":** skills orchestrate agents, browsers, and scripts, so
> their durations scale with scope and are estimates. The only hard numbers are
> `/ship` (~45s warm) and the network provisioners (`/deploy`, `/new-project`
> ~3–5 min). Hooks and ESLint rules run in milliseconds per invocation.

## Totals at a glance

- **26 skills** (~3,954 lines of SKILL.md)
- **2 custom agents** (172 lines)
- **11 hooks** (~1,019 lines)
- **10 ESLint rules** (~949 lines + index)
- **18 scripts + lib** (~6,509 lines)
- **44 npm actions**
- **32 ADRs + template**
- **13 `docs/` files + 5 root docs**

---

## 1. Skills — `.claude/skills/` (26)

Claude-invocable slash commands.

| Skill | Lines | ~Time | What it does |
|-------|------:|-------|--------------|
| `scale-up` | 537 | varies | Recipe table for adding capabilities the rail doesn't ship (uploads, cron, jobs, realtime, domains, flags, observability). Suggests, never auto-installs. |
| `manual-uat` | 359 | 15–40 min | Agent drives a real browser as a real user — happy + worst path per flow, live RBAC checks per role. |
| `handoff` | 351 | 2–5 min | Produces the IT-team handoff package (HANDOFF.md: state, env vars, schema, routes, run-locally). |
| `blueprint` | 266 | 2–10 min | Pre-build gate — user stories, happy/worst scenarios, architecture sketch, tier, open questions. |
| `uat` | 223 | lean ~5 / full 30–60 min | Browser-driven acceptance testing; Lean smoke vs Full deep audit + HTML/PDF report. |
| `new-project` | 176 | ~3 min | One-prompt provisioner: GitHub repo + Neon + Vercel + Cloudflare CNAME. |
| `first-fork` | 172 | 10–20 min | Guided first-time fork setup for non-developers. |
| `scaffold-entity` | 170 | 1–2 min | End-to-end CRUD entity: Prisma model + zod + routes + pages + nav + recycling bin. |
| `quickstart` | 159 | ~10 min | One paragraph of an idea → live shareable URL. |
| `deploy` | 130 | 3–5 min | Provision Neon + Vercel for the current repo → live URL. |
| `audit` | 121 | 1–3 min | Security scan: gitleaks + npm audit + Semgrep. |
| `stack-advisor` | 116 | inline | Build-time stack expert for correct RSC/Prisma/Postgres patterns. |
| `sync-from-template` | 113 | 1–3 min | Pull later template enhancements into a fork (path-scoped, additive). |
| `migrate-from` | 112 | 10–30 min | Pull schema + data from a source Postgres into a fork. |
| `design-qa` | 105 | 5–15 min | Screenshot every screen + component state, run axe, diff vs design source. |
| `qa` | 104 | 20–60 min | QA orchestrator — gates design-qa → ship → uat in order. |
| `conform` | 103 | 10–30 min | Bring foreign code up to template standard, then push to a new repo. |
| `handoff-session` | 94 | 1–2 min | Committed + inline session handoff for continuing in a fresh session. |
| `ship` | 94 | ~45s warm | The gate: typecheck + lint + tests + build + secret scan + dep audit. |
| `design-system` | 89 | inline | Proactive front-half — build on-token, RTL/dark-correct, accessible UI on first pass. |
| `docker` | 79 | 2–5 min | Containerize the app (build image / run / full local stack). |
| `cover` | 77 | 5–15 min | AI test generation to close the coverage floor (node:test runner). |
| `remember` | 77 | <1 min | Append a durable dated entry to `docs/agent-memory.md`. |
| `batch` | 48 | varies | Run a repetitive per-file job as capped headless `claude -p` runs. |
| `rebrand` | 45 | <1 min | Sweep hardcoded identity defaults → fork identity. |
| `adr` | 34 | ~1 min | Create a new ADR under `docs/decisions/`. |

## 2. Agents — `.claude/agents/` (2)

| Agent | Lines | Model | Role |
|-------|------:|-------|------|
| `senior-code-reviewer` | 139 | — | Post-push whole-change/whole-repo breadth review (invariants, threat model, drift). |
| `scout` | 33 | haiku | Cheap read-only investigator for repo-wide searches and orientation. |

Harness-provided runtime agents also available: `claude`, `Explore`,
`general-purpose`, `Plan`, `claude-code-guide`, `statusline-setup`.

## 3. Hooks — `.claude/hooks/` (11)

Event handlers wired in `settings.json` across 7 events (SessionStart,
UserPromptSubmit, PreToolUse, PostToolUse, Stop, PreCompact, SessionEnd). Each
runs in milliseconds per event.

| Hook | Lines | Fires on | Purpose |
|------|------:|----------|---------|
| `session-start.sh` | 129 | SessionStart | Installs deps, generates Prisma client, refreshes repo-map, prints handoff. |
| `post-tool-scan.mjs` | 128 | PostToolUse | Scans tool output (secret/finding detection). |
| `protect-secrets.mjs` | 114 | PreToolUse | Blocks reads/writes that would touch secrets. |
| `skill-activation.mjs` | 114 | UserPromptSubmit | Suggests/activates skills from `skill-rules.json`. |
| `auto-handoff.mjs` | 110 | SessionEnd/Stop | Auto-generates session handoff. |
| `session-stop.mjs` | 95 | Stop | Hard-blocks ending the turn with unpushed commits. |
| `dangerous-commands.mjs` | 89 | PreToolUse | Blocks destructive git/shell commands. |
| `pre-compact-refresh.mjs` | 88 | PreCompact | Refreshes state before context compaction. |
| `context-watchdog.mjs` | 61 | UserPromptSubmit | Warns at 60/80/90% token-window depth. |
| `session-receipt.mjs` | 51 | SessionEnd | Writes a session receipt. |
| `verbose-guard.mjs` | 40 | PreToolUse | Guards against overly verbose output. |

## 4. ESLint rules — `eslint-rules/rules/` (10)

All at `error`; run as part of `npm run lint` / `/ship` (seconds).

| Rule | Lines | Blocks |
|------|------:|--------|
| `no-unaudited-bulk-write` | 180 | Prisma bulk/upsert on audited model bypassing audit log. |
| `no-restricted-export-column` | 115 | Secret-named field as an Excel export column. |
| `no-prisma-unfiltered-import` | 106 | `prismaUnfiltered` outside allowlisted files. |
| `no-prisma-in-client` | 87 | `prisma` imported in client components. |
| `no-rate-limit-inside-auth` | 82 | `withRateLimit` composed inside the auth wrapper. |
| `no-raw-hex-color` | 79 | Raw hex colors instead of tokens. |
| `no-secret-env-in-console` | 79 | Logging Restricted env vars. |
| `no-bare-internal-route` | 77 | `/api/internal/*` route without `withInternalAuth`. |
| `no-any-cast-on-session` | 74 | Casting `session` to `any`. |
| `no-raw-sql-unsafe` | 70 | `$queryRawUnsafe` / `$executeRawUnsafe`. |

## 5. Scripts — `scripts/` (18 + lib)

The executable engines behind the skills/commands.

| Script | Lines | ~Time | Backs |
|--------|------:|-------|-------|
| `scaffold-entity.mjs` | 1412 | seconds | `/scaffold-entity`, `npm run scaffold` |
| `ship.mjs` | 879 | ~45s warm | `/ship`, `npm run ship` |
| `uat-pdf.mjs` | 656 | ~10–30s | `npm run uat:pdf` |
| `deploy.mjs` | 581 | 3–5 min | `/deploy` |
| `new-project.mjs` | 548 | ~3 min | `/new-project` |
| `rbac-matrix.mjs` | 423 | seconds | `manual-uat:matrix` |
| `sync-from-template.mjs` | 337 | 1–3 min | `/sync-from-template` |
| `uat-recommend.mjs` | 327 | seconds | `uat:recommend` |
| `migrate-from.mjs` | 281 | minutes | `/migrate-from` |
| `render-handoff.mjs` | 197 | instant | handoff rendering |
| `rebrand.mjs` | 144 | seconds | `/rebrand` |
| `manual-uat-users.mjs` | 137 | seconds | `manual-uat:users` |
| `uat-benchmark.mjs` | 134 | seconds | `uat:benchmark` |
| `auto-spawn-guard.mjs` | 129 | instant | session automation |
| `install-senior-review.mjs` | 98 | seconds | senior-review portability |
| `auto-spawn-fire.mjs` | 93 | instant | session automation |
| `repo-map.mjs` | 65 | seconds | `npm run repo-map` |
| `build-tokens.mjs` | 14 | instant | `tokens:build` |
| `lib/log.mjs` | 54 | — | shared logging util |

## 6. Actions — `package.json` npm scripts (44)

Notable: `ship` (the gate), `dev`/`build`/`start`, `test` +
`test:property`/`:integration`/`:components`/`:coverage`/`:lint-rules`,
`prisma:*` (generate/migrate/push/seed/studio),
`uat`/`uat:full`/`uat:pdf`/`uat:recommend`/`uat:benchmark`, `scaffold`,
`rebrand`, `deploy`, `new-project`, `sync-template`, `repo-map`, `analyze`,
`scan` (react-scan), `lhci`, `sbom`, `audit:warn`, `changeset*`.

## 7. Documents

**Root (5):** `SECURITY.md` (344), `README.md` (199), `CLAUDE.md` (99),
`AGENTS.md` (61), `CHANGELOG.md` (58).

**`docs/` (13):** `design-recipes.md` (431),
`claude-ecosystem-comparison-part2.md` (391),
`claude-ecosystem-comparison.md` (218), `agent-memory.md` (201),
`uat-rubric.md` (196), `deferred-adoption-plan.md` (184),
`SESSION-HANDOFF.md` (162), `plugin-eval-2026-07.md` (142),
`token-policy.md` (112), `REPO-MAP.md` (110), `recipes.md` (86),
`findings-register.md` (64), `mcp.md` (35).

**ADRs — `docs/decisions/` (32 + template):** ADR-001 through ADR-031 plus
`ADR-TEMPLATE.md`. Largest: ADR-004 ci-driven-ops (151), ADR-029
antd→tailwind replatform (154), ADR-015 design-taste-layer (147), ADR-025
tiered-enforcement (137), ADR-027 ui-library-skeleton (132). Covers stack lock
(001), Vercel/Neon pivot (006), audit completeness (010), design system
(026/028/029), Docker (023/030), and structured-DB mandate (031).

## 8. External tools (MCP servers, session-provided)

- **github** — full PR/issue/CI/repo API
- **playwright** — browser automation (drives design-qa / uat / manual-uat)
- **Figma** — design ↔ code bridge
- **context7** — live library docs
- **Replit** — requires authorization
