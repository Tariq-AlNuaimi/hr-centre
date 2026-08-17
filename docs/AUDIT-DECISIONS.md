# Audit decisions — operator sign-off record

**Date:** 2026-08-17 · **Operator:** Tariq Al-Naaimi · **Source:** the complexity audit
(`docs/COMPLEXITY-AUDIT.md`) and the red-team assessment (`docs/RED-TEAM.md`).

Every item below was put to the operator individually with its rationale and risk, and answered.
This file is the contract the implementation branches trace against. **No item outside this list is
approved.**

## Execution parameters

| Parameter     | Decision                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Sequencing    | **Security first**, one commit per fix, `/ship` green between each                                       |
| Branching     | **Fresh branch per phase, off `main`**; `claude/template-complexity-audit-dqxq52` stays the audit record |
| Session       | Implement in-session                                                                                     |
| Reversibility | Every fix independently revertable; stop at any commit                                                   |

> **Note:** each phase branch must carry the `deepmerge-ts` override (below), or the pre-push
> `npm audit` gate blocks the push. Cherry-pick it as the first commit on each branch until it
> reaches `main`.

## Already landed (retroactively approved)

| ID    | Change                                                               | Decision                                                                            |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A3    | `overrides: {"deepmerge-ts": "^8.0.1"}` clearing GHSA-ggr8-5vv4-36mx | **Keep as-is** (`^8.0.1`, not pinned)                                               |
| A1    | `docs/COMPLEXITY-AUDIT.md`, `docs/RED-TEAM.md` at `docs/` root       | **Leave in place**                                                                  |
| A2/A4 | Red-team report + `tests/harness/guard-probe.mjs` committed          | **Keep both**; fix the findings, then they read as history                          |
| B1    | Complexity-audit artifact published to claude.ai                     | **Keep published**                                                                  |
| B1    | Red-team artifact published                                          | **Withdrawn** — contents stripped; operator to delete at `claude.ai/code/artifacts` |

## Phase 1 — security (red-team findings)

| ID      | Approved action                                                                                                                                                                                                                                                                                      | Risk accepted                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **R1**  | `clientIp()` fails closed (ignore `x-real-ip` unless `RATE_LIMIT_TRUSTED_IP_HEADER` names it) **AND** Caddyfile `header_up -X-Real-IP` + re-set from `{http.request.remote.host}`                                                                                                                    | Forks behind an unconfigured proxy fall back to XFF/`unknown` until they set the env var             |
| **R2**  | Narrow **all four** allowlist wildcards. `npx prisma *` → `generate`, `migrate dev`, `migrate deploy`, `studio`, `seed` only (**`migrate reset`, `db execute`, `db push` will prompt**). `find . *` → deny `-delete`/`-exec`. `docker compose down*` → deny `-v`. `git push *` → non-`main` refspecs | New permission prompts for unlisted verbs. Requires a `docs/findings-register.md` note per CLAUDE.md |
| **R2b** | Extend `dangerous-commands.mjs`: `find -delete`/`-exec`, `shred`, `node -e`/`python3 -c` bodies, `>` truncation, destructive subcommands                                                                                                                                                             | Fail-closed file — a bad pattern blocks legitimate work. Probe-first, prove allow→deny               |
| **R3**  | Close **all six** `protect-secrets.mjs` bypasses: glob expansion, `tar`/`cpio`, interpreter bodies, `curl`/`wget` `@file`                                                                                                                                                                            | Over-blocking risk on a security-critical guard                                                      |
| **R4**  | CODEOWNERS on `docs/agent-memory.md` **AND** SessionStart renders the digest as delimited untrusted data                                                                                                                                                                                             | Adds review friction to `/remember`                                                                  |
| **R5**  | Third-party plugins become **fork-opt-in** (move `superpowers` enablement to local gitignored settings)                                                                                                                                                                                              | Operator keeps it locally; forks and `/handoff` no longer inherit it                                 |
| **R6**  | Reword `CLAUDE.md` — stop calling the fail-open governance gates "hard gates"                                                                                                                                                                                                                        | Docs only; no behavior change                                                                        |
| **R7**  | Surface the `next-auth@5.0.0-beta.32` pin in the `/handoff` package                                                                                                                                                                                                                                  | Docs only                                                                                            |
| **R8**  | Correct the CSP/AntD claim in `.claude/rules/design.md`                                                                                                                                                                                                                                              | Docs only                                                                                            |

## Phase 2 — dead code and dormant layer

| ID        | Approved action                                                                                                                                                                             | Explicitly excluded                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **A1**    | Remove the dormant layer — `lib/ai`, `lib/queue`, SSO/SCIM, observability/Sentry, Valkey, `lib/export.ts` — **code + 8 runtime deps + 12 contract tests**, relocated to `/scale-up` recipes | **Migrations stay.** `pgvector_rag` and `scim_external_id` are applied history; deleting them causes drift on any fork whose DB ran them |
| **A2/A3** | Delete `KanbanBoard`+`.impl`, `OrgSwitcher`, `NotificationsMenu`, `@dnd-kit/core` **and** move the two demo pages (`design-system`, `style-guide`, 890 lines)                               | —                                                                                                                                        |
| **A4**    | Retire **all six**: StrykerJS, `playwright-bdd`, CycloneDX SBOM, `jscpd`, visual-regression, changesets. Keep the recipes in `docs/` so a fork can re-adopt                                 | Removing the SBOM costs the `/handoff` compliance artifact — accepted                                                                    |
| **C1**    | Delete the 6.7 MB of PNGs from HEAD + gitignore future captures                                                                                                                             | **No history rewrite** — clone size is unchanged; this stops growth only                                                                 |

> A4 retires visual-regression, which removes the only consumer of the demo pages — so A2/A3's
> fuller cut is consistent, not breaking.

## Phase 3 — harness and context

| ID     | Approved action                                                                                                                                                          | Explicitly excluded                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **B1** | Stop the eager rules load (relocate `.claude/rules/`, repoint `rules-injection.mjs`); split `harness.md`; cut `AGENTS.md` to a pointer; prune MCP to **playwright only** | Verify by reading the NEXT session's system prompt — cannot be proven in-session |
| **B2** | Fix **all three** blind gates: knip `entry` config, `context-tax.mjs` (measure all 8 sources), `db-structure` degradation                                                | **`/ship` goes RED** until Phase 2's cleanup lands. Accepted deliberately        |
| **B3** | Consolidate `scripts/`, npm scripts, and hooks                                                                                                                           | **Skills are NOT merged** — 34 stay. The interface is unchanged                  |
| **C2** | Warm `/ship` 25 phases → ~12. Moves: knip, duplication, coverage, skill-check, size-limit, db-structure, copy                                                            | **Every security check stays warm**                                              |
| **C3** | Blueprint + build-vs-buy gates: **deny → warn for quickstart/personal tier only**                                                                                        | Deny retained for multi-file/shared-tier work                                    |
| **C4** | Archive cold governance docs to `docs/archive/`, merge the three map docs, file superseded ADRs                                                                          | Archive, never delete — the registers are audit trails                           |

## Not approved / not proposed

- Skill merge (34 → 18) — **declined**, keep the current interface
- Git history rewrite for the PNGs — **declined**
- Deleting the pgvector / SCIM migrations — **declined**
- Any change to the security floor: auth wrappers, zod boundary, the ESLint rules, audit log,
  gitleaks, `/ship`-before-push

## Standing requirement

**Every fix gets a regression test.** `tests/harness/guard-probe.mjs` is the model for the guard
work; the existing `tests/eslint-rules` suite is the model overall. A fix without a test that proves
the failure mode is closed does not count as done.
