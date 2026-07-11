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

- [ ] Local `/ship` is green (typecheck → lint → tests → build → gitleaks → npm audit) — the active gate on the free plan
- [ ] (At handoff, paid Actions) `verify.yml` / `secrets-scan.yml` / `sast.yml` are green
- [ ] If touching audit / soft-delete: verified an audit row is written (CREATE / UPDATE / DELETE / RESTORE) with attribution

## Rollback plan

<!-- One sentence: how to undo this if it breaks prod. On the Vercel rail: `git revert` the commit, or "Promote to Production" on the prior deployment in the Vercel UI. -->
