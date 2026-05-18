## Summary
<!-- One sentence: what does this PR do and why? -->

## Related
<!-- Issue / ADR number(s). e.g. "Closes #42 / Implements ADR-007". -->

## Change shape
- [ ] Pure refactor (no behavior change)
- [ ] Bug fix
- [ ] New feature
- [ ] Security fix (closes a SECURITY.md §11 finding -- note which: T-NN)
- [ ] Dependency bump
- [ ] Docs / ADR

## CLAUDE.md hard-rule checklist
- [ ] No `.env` content in the diff (gitleaks will block anyway)
- [ ] Restricted values (passwordHash, tokens, secrets, salaries) never appear in logs / responses / audit metadata
- [ ] New API handlers wrap with `withAuth` / `withAdminAuth` / `withInternalAuth` -- no bare handlers
- [ ] New raw SQL (if any) uses `prisma.$queryRaw` with parameter placeholders
- [ ] No new model added to the audit `EXCLUDE` set
- [ ] If a Restricted column was added to a model: extended `SCRUB_FIELDS` in `lib/prisma/audit-extension.ts` in this PR
- [ ] If a model added `deletedAt`/`deletedBy`: added it to `SOFT_DELETE_MODELS` in the same PR (or `/scaffold-entity` was used and did this automatically)
- [ ] No new client-bundle dep > 50 KB without an ADR
- [ ] No new `"use client"` component imports from `lib/prisma`

## SECURITY.md
- [ ] Touches auth / roles / data classification / encryption / audit / secrets / retention / external network calls
  - [ ] **If checked:** updated SECURITY.md in this same PR (§1, §6, §7, §10, or §11 as applicable)
- [ ] No new finding introduced; or if introduced, opened a `security` issue with the T-NN slot
- [ ] Any SAST / gitleaks / npm-audit suppression is logged in SECURITY.md §12 with rule ID, location, justification, reviewer, date

## Verification
- [ ] `verify.yml` is green on this PR (typecheck + lint + node:test + build + npm audit + scaffold smoke)
- [ ] `secrets-scan.yml` is green
- [ ] `sast.yml` is green
- [ ] If touching backup chain: `restore-test.yml` `workflow_dispatch` was triggered and passed
- [ ] If touching audit: `audit-retention.yml` `workflow_dispatch` was triggered against staging and returned a sensible count

## Rollback plan
<!-- One sentence: how to undo this if it breaks prod. "Set IMAGE_TAG=sha-<previous> in Portainer" is usually enough for runtime changes. -->
