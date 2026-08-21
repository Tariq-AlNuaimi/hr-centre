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
  (Narrowed 2026-07-25 — see below: the sets photographing the removed demo domain went to the
  archive; the sets documenting surviving surfaces stayed.)

---

## Second pass — the Asset-Tracker demo domain (2026-07-25)

The template shipped the **V2-210 Asset Tracker pilot** as if it were product: `Asset`, `Category`,
`Manufacturer`, `AssetModel`, `CustomFieldDef` — ~2,800 LOC hard-wired into the sidebar, inherited
by every fork, never named in `README.md`'s feature list, with no documented removal path. It was
built to exercise the harness loop (ADR-059), not to be a feature. Removed so the template boots
baseline-only again; `/scaffold-entity` regenerates the shape in one command.

**Archive point: commit `4b73206`** — the last commit where all of it existed in the tree. It is an
ancestor of `main` and already on the remote, so everything is recoverable by SHA from any clone:

```bash
git show 4b73206:docs/blueprints/asset-tracker.md                    # the pilot blueprint
git show 4b73206:docs/decisions/ADR-059-asset-tracker-architecture.md
git show 4b73206:docs/benchmarks/it-asset-management.md              # the ITAM parity benchmark
git show 4b73206 --stat -- prisma/schema.prisma                      # the domain models
git checkout 4b73206 -- docs/verification/asset-tracker              # a whole capture set back
```

**What moved to the archive:**

| Removed                                                                                                                                                           | Why                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 5 Prisma models + 5 migrations, 15 pages, 12 API routes, 12 components, 5 zod modules, sidebar nav, seed data, 33 message keys, 2 contract tests, the BDD feature | pilot residue; every fork paid a teardown to remove somebody else's app                                                 |
| `lib/csv.ts` + `tests/contracts/csv.test.ts`, `components/shared/RelationSelect.tsx`                                                                              | zero consumers once the demo forms were gone — the scaffold emits its own inline picker (`scripts/scaffold-entity.mjs`) |
| `docs/verification/{asset-tracker,asset-category-entity,asset-fields,asset-bulk-actions,custom-fields}/` (~3.4 MB)                                                | captures of screens that no longer exist                                                                                |
| `docs/blueprints/asset-tracker.md`, `docs/benchmarks/it-asset-management.md`, `ADR-059`                                                                           | pilot-specific, but classified fork-inherited — they shipped to forks as if they were template guidance                 |

**Kept in the tree:** `docs/verification/{design-system,v2-305-copy,atomic-audit-triggers}/` — they
document surfaces that still exist and back live register entries. The two harness citations of a
worked example (`.claude/rules/design.md`, `.claude/skills/design-qa/SKILL.md`) were re-pointed at
`docs/verification/design-system/`.

**Also removed from `main` in the same pass:** `docs/SESSION-HANDOFF.md` + `docs/session-state.json`.
`.claude/rules/harness.md` ("Memory lifecycle") says both are branch-only and **never merged to
`main`** — they were on `main` anyway, so every fork inherited this template's harness-v2 program
state as its own starting point. They are not lost and nothing breaks: the SessionStart hook writes
a fresh valid skeleton when `docs/session-state.json` is absent (V2-006,
`.claude/hooks/session-start.sh`), which is exactly the intended fork experience.

---

## Third pass — cold governance documentation (2026-08-17)

Unlike the two passes above, **nothing left the working tree here.** The governance docs were
carrying their entire resolved history on the hot path — `docs/findings-register.md` was 615 lines
with **zero open wave-offs**, and `docs/OPEN-ITEMS.md` listed twelve already-closed rows. Resolved
content moved into `docs/archive/`, in-tree and committed, so it stays greppable.

| Moved from                                   | To                                       | What moved                                                                                                                  |
| -------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `docs/findings-register.md` (615 → 90 lines) | `docs/archive/findings-register-2026.md` | 40 resolved entries (`status: fixed(...)` / `adjudicated(...)` with no pending work). 7 unresolved/re-openable entries stay |
| `docs/OPEN-ITEMS.md` (166 → 78 lines)        | `docs/archive/open-items-2026.md`        | 12 rows closed ✅ DONE / ⬜ MOOT / ❌ WON'T-DO. Items 8–11 (dormant, blocked on external config) stay                       |

**The `/ship` `wave-offs` gate is unaffected.** It parses `docs/findings-register.md` only, splitting
it into entry blocks on the `\n- YYYY-MM-DD` boundary and flagging any block carrying
`status: open`. Every archived entry was already resolved, so the gate's verdict is identical
(0 open, before and after). The live file keeps its header, its format rules, and its trailer
verbatim.

**Still do not delete `docs/verification/**`** — those capture sets are the evidence behind entries
that now live in `docs/archive/findings-register-2026.md`. Archiving the narrative did not archive
its proof.

### Three overlapping map docs merged into one

`docs/repo-architecture.md` (158 lines), `docs/harness-orientation.md` (98) and
`docs/token-policy.md` (114) restated each other — the same layers, the same gates, the same
model-tier table, three times. They are now **`docs/ARCHITECTURE.md`**, which preserves every unique
fact: the O1–O8 objective table, both mermaid diagrams, the five layers, the eight harness systems,
contributor onboarding, and the full token policy (repo side, session habits, the ADR-022 routing
tiers, the automation table, the operator-only table).

**Path map for any link you find in older text:**

| Old path                      | New location                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `docs/repo-architecture.md`   | `docs/ARCHITECTURE.md` §1–§3, §5                                                   |
| `docs/harness-orientation.md` | `docs/ARCHITECTURE.md` §4, §6                                                      |
| `docs/token-policy.md`        | `docs/ARCHITECTURE.md` §7 (7a repo side · 7b habits · 7c tiers · 7d/7e automation) |

The three originals are recoverable from git history; the merge commit is the archive point.

### ADR supersession is now labelled

`docs/decisions/` held 61 ADRs with **no file marked superseded**, so dead decisions read as live.
No ADR was moved or renamed (that would break links repo-wide). Instead: ten ADRs with in-file
evidence of supersession gained a banner directly under the title, and
**`docs/decisions/README.md`** is the new status index (🟢 current / 🟡 partially superseded /
🔴 superseded) plus a supersession map. Decisions that are _re-targeted_ or _reframed_ rather than
superseded (ADR-015, ADR-011, ADR-030) are explicitly called out as NOT superseded.
