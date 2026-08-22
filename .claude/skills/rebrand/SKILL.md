---
name: rebrand
description: Sweep the template's hardcoded identity defaults (package name, app display name, CLAUDE.md / README headers) and replace them with the fork's identity. Backed by scripts/rebrand.mjs. Use after forking the template, or when the user says "rebrand", "rename the project", "set the project name", "/rebrand".
---

# /rebrand — Project rename sweep

Replace the template's defaults with the fork's project identity. **Run this immediately after forking the template, BEFORE `/first-fork`** — the bootstrap assumes the identity is already swept. Idempotent: running twice with the same args is a no-op.

> The Vercel + Neon pivot (ADR-006) deleted the Docker/GHCR/Portainer surface, so
> rebrand no longer touches any container/image strings — there is nothing to rename
> there. `docker-compose.yml` (local Postgres only) and `Makefile` carry no
> template-specific identity and are left untouched.

## Inputs to gather

- **Project slug** (kebab-case): e.g. `acme-portal`. Becomes the `package.json` name.
- **Display name**: human-readable, e.g. `"Acme Portal"`. Becomes `NEXT_PUBLIC_APP_NAME` and the CLAUDE.md / README headers.
- **Owner** (`--owner`): the GitHub org/user that owns the repo. Defaults to the current repo's owner.
- **Owner display name** (optional, `--owner-name`): the human owner in CLAUDE.md's first paragraph. Defaults to the git user.name.

## Steps

1. Confirm inputs with the user. Show what will change (use `--dry-run` first).
2. Run:
   ```
   npm run rebrand -- --slug <slug> --name "<Display Name>" --owner <gh-owner> [--owner-name "<Owner Name>"] [--dry-run]
   ```
3. The script edits only the identity strings that exist on the current rail (it prints which files it changed):
   - `package.json` name: `"fullstack-next-template"` -> `"<slug>"`
   - `.env.example`: `NEXT_PUBLIC_APP_NAME="My App"` -> `"<Display Name>"`
   - `CLAUDE.md`: the H1 + tagline line (name, stack, owner)
   - `README.md`: the H1 title
4. Report the diff to the user (filenames + rule counts). If the script reports **no changes**, say _why_ — usually the fork is already rebranded, or the slug/display name drifted from the defaults the script matches on — rather than reporting a silent success.
5. Suggest: commit + push, then `/first-fork` for the rest of the bootstrap.

## Hard rule preserved

The script never touches:

- `.claude/` (harness is project-name-agnostic)
- `docs/decisions/` (ADRs are stable references)
- `prisma/schema.prisma` (data model)
- `lib/` source (code is project-name-agnostic)
- `tests/`
- `SECURITY.md` (project owner gets filled in via the first project ADR, not by rebrand)

## Dry-run

Pass `--dry-run` to preview the changes without writing. Useful when the operator is unsure about the slug.

## Fork doc-payload prune (V2-506)

`npm run rebrand -- --prune-docs` (standalone mode; needs no `--slug`/`--name`/`--owner`) reads
`docs/doc-manifest.json` and prints the **prune list**: the `template-dev` docs (the harness-v2 /
enterprise program artifacts, research, deep-comparison, verification evidence) that a FORK does not
need, vs the `fork`-inherited docs it keeps (ADRs, runbooks, recipes, rubrics, ledgers). It is
**non-destructive — a LIST only**. On a fork, archive the pruned set to a `template-history` branch
reference and remove it from the working tree; **never delete from template main.** Classification is
first-match-wins globs in the manifest with a catch-all defaulting to `fork` (KEEP is the safe
failure) — a new `template-dev` doc needs an explicit rule added above the catch-all.

## Verification

Before calling this done:

- [ ] `npm run rebrand -- --dry-run ...` was shown to and confirmed by the
      operator before the real run.
- [ ] The script's changed-file report was reviewed — `package.json` name,
      `.env.example`'s `NEXT_PUBLIC_APP_NAME`, `CLAUDE.md`'s H1 + tagline, and
      `README.md`'s H1 all match the new slug/display name/owner.
- [ ] A **no-changes** result was explained (already rebranded, or a
      slug/display-name mismatch against the script's match targets) rather than
      reported as a silent success.
- [ ] None of the hard-preserved paths (`.claude/`, `docs/decisions/`,
      `prisma/schema.prisma`, `lib/`, `tests/`, `SECURITY.md`) were touched.
- [ ] The result was committed and pushed, ready for `/first-fork` to run next.

**Emits:** the swept identity defaults (`package.json` name, `.env.example`
`NEXT_PUBLIC_APP_NAME`, `CLAUDE.md` header, `README.md` H1) — the input the rest
of the fork lifecycle (`/first-fork`, `/new-project`) assumes is already correct.
