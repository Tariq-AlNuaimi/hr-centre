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

---

## Round 7/8 — closeout decisions (2026-08-17)

Put to the operator after the Phase 2/3 wave landed, covering everything still open.

| Item                                | Decision                                                                 | Note                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Landing the work**                | **Open PRs, do not merge**                                               | My own R2b fix denies `git push origin main` in every spelling — the guard blocks me from landing this, by design. Merging stays a human action.                                                                                                                                                                                                                                                      |
| **Review before merge**             | **Full audit: `senior-code-reviewer` + `security-architect`**            | CLAUDE.md's review rail was not run during implementation (I self-verified with `/ship` + probes). Four scoping errors traced to trusting my own summaries, so an independent read of the real diff is the control that was missing. The security-architect pass covers the reshaped trust boundaries: fail-closed `clientIp`, the permission model, the agent-memory boundary, gates going advisory. |
| **B3 hooks**                        | **Finish — merge the overlapping hooks**                                 | `skill-activation` + `rules-injection` duplicate glob/relPath logic verbatim by their own comments. PreToolUse hot path, so tests must move with them.                                                                                                                                                                                                                                                |
| **C2**                              | **Move `copy` + `size-limit` too**                                       | Completes the approved 7. Neither is security-bearing; both still run in `ship:full`.                                                                                                                                                                                                                                                                                                                 |
| **`isSharedTier()`**                | **Move to `.claude/hooks/lib/scope-cover.mjs`**                          | Three verbatim copies of the DENY-vs-advise decision is exactly the drift `scope-cover.mjs` exists to prevent (V2-001 F#3).                                                                                                                                                                                                                                                                           |
| **Verification PNGs**               | **Re-track only the sets an archived finding cites; gitignore the rest** | C1 and C4 collided: untracking the images turned archived findings into claims with no evidence — the dead-evidence-pointer defect the 2026-07-24 challenge audit closed.                                                                                                                                                                                                                             |
| **`/docs-current` skill**           | **Fix**                                                                  | Still advertises context7 as its primary path; that MCP server was removed, so it silently falls back to WebSearch.                                                                                                                                                                                                                                                                                   |
| **`docs/doc-manifest.json`**        | **Fix**                                                                  | `docs/archive/**` classified `fork`, so forks would inherit the template's own resolved-findings history.                                                                                                                                                                                                                                                                                             |
| **`AGENTS.md` senior-review block** | **Leave removed**                                                        | An ADR-020-named artifact deleted when cutting AGENTS.md to a pointer. It restated the rail already binding in CLAUDE.md, cost 1.1 KB of always-on context, and `scripts/install-senior-review.mjs` is idempotent so a fork re-appends it. Operator-confirmed after the fact.                                                                                                                         |

**Still an operator action, not mine:** deleting the withdrawn red-team artifact at
`claude.ai/code/artifacts` (contents stripped; version history may retain the original).

---

## Round 9 — the two reviews' findings, all fixed (2026-08-21)

The full audit approved above (`senior-code-reviewer` + `security-architect`) ran on the real diff
and returned findings on both code PRs. The operator's instruction was **"fix all"**. Every claim
was reproduced by execution before being fixed and re-verified after; the one that did not survive
verification is recorded as a non-finding rather than quietly dropped or cosmetically "fixed".

### PR #103 — `claude/security-phase1` (commit `b21ed8e`)

| Finding                                     | Severity | Resolution                                                                                                                                                                                                                                                   |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R1 fail-closed IP source is a DoS lever** | High     | Split by failure asymmetry. Attribution (`clientIp`) still fails closed — forged beats absent is false for a forensic record. Throttling uses a new `throttleKey()` that always partitions, plus an optional per-account bucket. Detail in SECURITY.md T-01. |
| `protect-secrets` glob check over-blocks    | High     | `".env".startsWith("")` is always true, so `cat *.ts` was denied. Now decides on expansion, honouring dotglob semantics.                                                                                                                                     |
| push-to-main bypassable by full refspec     | High     | `/(^\|:)(main\|master)$/` never saw `HEAD:refs/heads/main`. Now resolves the destination ref.                                                                                                                                                                |
| interpreter lists miss modern runners       | Medium   | `npx tsx -e` / `bun -e` / `ts-node -e` / `sh -c` added to **both** guards.                                                                                                                                                                                   |
| `npx prisma@6 migrate reset` allowed        | Medium   | Exact-word lookup missed a version-pinned spec, and the not-found branch then read the whole arg list as the subcommand. Now matches a pinned or path-qualified spec.                                                                                        |
| `guard-probe.mjs` never ran                 | Medium   | `test:hooks` globs `*.test.mjs`; the probe was a document with an exit code. Now an importable module + `guard-probe.test.mjs` on the `/ship` rail. 25 + 28 + 40 cases, all clear.                                                                           |
| Caddyfile uses the direct peer              | Medium   | `{http.request.remote.host}` collapses every user onto the LB behind a CDN. Now `{http.request.client_ip}` through `trusted_proxies static private_ranges`. The Polis SSO ingress had no `header_up` at all and now matches.                                 |
| doc drift                                   | Low      | `lib/env.ts`, `.env.example`, SECURITY.md T-01 rewritten, each saying plainly what the previous wording got wrong.                                                                                                                                           |

### PR #104 — `claude/cut-dormant-layer` (commit `00b2887`)

| Finding                                  | Severity | Resolution                                                                                                                                                                     |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `doc-manifest.json` crashes the prune    | High     | My archive entry used `match`/`audience`; the reader wants `glob`/`inheritance`. Fixed, and the reader now names the bad rule instead of stack-tracing on the fork-setup path. |
| `.claude/settings.local.json` committed  | High     | This is red-team R5, and R5's own remediation (`.example` + gitignore) had never been written. Untracked, gitignored, `.example` created.                                      |
| CODEOWNERS lost the agent trust boundary | High     | The rule files moved to `docs/rules/` and the whole R4 block is absent from this branch. Restored, covering both paths.                                                        |
| `ship.mjs` calls a deleted script        | Medium   | The `design-parity` block outlived its npm script and its spec; it stayed green only because it skips when no app is reachable. Removed.                                       |
| `uat:full` matches zero tests            | Medium   | `--grep @full` with nothing tagged `@full`. Now `UAT_MODE=full`: 41 tests in 8 files, up from 0.                                                                               |
| export-column test deleted as collateral | Medium   | It never imported `lib/export.ts` — it guards SCRUB_FIELDS ↔ export-denylist drift. Restored, passing.                                                                         |
| three blueprints outlived their scope    | Low      | The gate matches the `Scope:` glob, not whether the spec still describes anything, so a resurrected path would inherit a stale contract. Archive-bannered, not deleted.        |
| CLAUDE.md R6 wording                     | Low      | Applied here too, so both branches agree that the quartet are process gates that fail open.                                                                                    |

### Reported but NOT a finding

**"Prune stale SECURITY.md §1/§6 env entries."** Checked each: `SENTRY_ORG` / `SENTRY_PROJECT` are
read by `next.config.ts` (a file the reviewer's grep did not cover), `lib/account-lockout.ts` exists
so `ACCOUNT_LOCKOUT_*` is live, and `MINIO_ROOT_PASSWORD` appears only inside the 2026-06-12 incident
record, which is history and should stay. No edit was warranted, so none was made. Recorded here
because a review finding that is silently not acted on is indistinguishable from one that was missed.

### Note on the correction direction

R1's first fix was itself a correction — of a real spoofing bug — and it over-corrected into a worse
one. "Throttles harder" read as the safe direction to fail, and it was not: the auth buckets are
small and process-wide, so one stranger could lock every user out of signing in. The lesson worth
keeping is that **"fails closed" is only a virtue once you have named who bears the cost of the
closure.** For a forensic record the cost falls on the forger, so closed is right. For a shared
throttle it falls on every innocent user, so closed is an outage. The two consumers looked like one
question and were two.

**Still an operator action, not mine:** merging #103, #104 and #105, and deleting the withdrawn
red-team artifact at `claude.ai/code/artifacts`.
