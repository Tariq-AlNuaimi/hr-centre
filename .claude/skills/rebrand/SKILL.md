---
name: rebrand
description: Sweep the template's hardcoded defaults (project name, GHCR image, container names, app display name) and replace them with the fork's identity. Backed by scripts/rebrand.mjs. Use after forking the template, or when the user says "rebrand", "rename the project", "set the project name", "/rebrand".
---

# /rebrand — Project rename sweep

Replace the template's defaults with the fork's project identity. Idempotent: running twice with the same args is a no-op.

## Inputs to gather
- **Project slug** (kebab-case): e.g. `acme-portal`. Becomes `package.json` name, Docker container prefix, GHCR image name.
- **Display name**: human-readable, e.g. `"Acme Portal"`. Becomes `NEXT_PUBLIC_APP_NAME`.
- **GHCR owner**: the GitHub org or user that owns the GHCR namespace. Defaults to the current repo's owner.
- **Owner display name** (optional): the human owner that goes in CLAUDE.md's first paragraph. Defaults to the git user.name.

## Steps
1. Confirm inputs with the user. Show what will change.
2. Run:
   ```
   npm run rebrand -- --slug <slug> --name "<Display Name>" --owner <gh-owner> [--owner-name "<Owner Name>"] [--dry-run]
   ```
3. The script:
   - Replaces `"name": "fullstack-next-template"` -> `"<slug>"` in `package.json`
   - Rewrites `ghcr.io/rihal-om/fullstack-next-template` -> `ghcr.io/<gh-owner>/<slug>` in `docker-compose.yml`, `docker-compose.prod.yml`, `Makefile`
   - Replaces `next-template-*` container names with `<slug>-*` in both docker-compose files
   - Replaces `"My App"` with `"<Display Name>"` in `.env.example` and `docker-compose.prod.yml`
   - Updates the first paragraph of `CLAUDE.md` with the new project name + owner
4. Report the diff to the user (filenames + line counts).
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
