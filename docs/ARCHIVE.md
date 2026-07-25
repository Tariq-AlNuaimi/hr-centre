# Archived documentation

The template's own **build history** was removed from the working tree on **2026-07-25** and
pinned at the git tag **`template-history-2026-07`**. Nothing was lost.

**Why.** The repo carried 3.23 MB of docs against 16k lines of product code. 65% of that was
`template-dev` — the record of _how the template was built_, not how to use it. Every session paid
context tax on it; forks never received it anyway (`doc-manifest.json` classified it, and
`rebrand --prune-docs` stripped it).

**What moved to the tag** (92 files, ~2.0 MB, plus ~740 KB of generated HTML reports):

|                                                                                                                      |                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/HARNESS-V2-EVIDENCE.md` (141 KB), `-CLOSEOUT`, `HARNESS-PROBLEMS`, `TRIALS`                                    | harness-v2 program record — the program is CLOSED                                                                                                                                                     |
| `docs/research/**` (30 docs, ~1 MB)                                                                                  | input that produced the ADRs; the ADRs stand on their own                                                                                                                                             |
| `docs/deep-comparison/**` (24 files)                                                                                 | one-off tooling comparison                                                                                                                                                                            |
| `docs/blueprints/harness-v2-phase-*.md`, `c3.5-*`, `c4-*`                                                            | phase blueprints for completed work                                                                                                                                                                   |
| `docs/INVENTORY-BY-OBJECTIVE.md`, `docs/REPO-INVENTORY.md`, `docs/harness-inventory.md`                              | three hand-maintained inventories of the same repo — superseded by the auto-generated `docs/REPO-MAP.md`, which cannot drift (one of them had drifted: it claimed 10 ESLint rules when there were 13) |
| `docs/claude-ecosystem-comparison*.md`, `deferred-adoption-plan`, `enterprise-pivot-analysis`, `plugin-eval-2026-07` | point-in-time analyses, already acted on                                                                                                                                                              |

**Retrieving anything.** The archive point is commit **`3e5a105`** — the last commit where these
files existed in the tree. It is an **ancestor of this branch**, so the content is on the remote and
recoverable by SHA from any clone:

```bash
git show 3e5a105:docs/HARNESS-V2-EVIDENCE.md   # one file
git show 3e5a105 --stat                        # what was there
git log --diff-filter=D --name-only -1 HEAD    # what this pass deleted
```

> The local tag `template-history-2026-07` also points at `3e5a105`, but **it did not push** (the
> git proxy refused tag pushes in that session), so do not rely on the tag name from a fresh clone
> — **use the SHA**. Re-create the tag any time with
> `git tag -a template-history-2026-07 3e5a105`.

**If you hit a dead link.** ADRs and ledgers still cite these paths — deliberately. They are
historical records citing the input that produced them, and rewriting ~70 files to strip the
references would have cost more than it returned. A path under `docs/research/`,
`docs/deep-comparison/`, or a `HARNESS-V2-*` file means: it's at the tag above.

**Verification captures.** Two closed-program capture sets were removed too (`v2-304-lint` 1.6 MB,
`style-guide` 836 KB — nothing referenced them; same SHA recovers them). `v2-305-copy` was KEPT
despite being closed-program: it holds the repo's only `baseline/` directory, which
`.claude/skills/design-qa/SKILL.md` cites as the worked example for the visual-regression workflow.

**Deliberately KEPT in the tree**, despite being `template-dev` by classification:

- `docs/verification/**` — evidence backing **live** `findings-register.md` entries. Deleting it
  would create exactly the dead-evidence-pointer defect the 2026-07-24 challenge audit fixed.
- `docs/SESSION-HANDOFF.md` + `docs/session-state.json` — live session state the SessionStart hook
  reads, not history.
