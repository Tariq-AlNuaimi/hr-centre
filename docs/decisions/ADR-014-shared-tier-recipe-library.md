# ADR-014 — Shared-tier capability recipes live in `docs/recipes/`, not the base

**Status:** Accepted
**Date:** 2026-06-04
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on:** ADR-006 (prototype rail), ADR-007 (tiers), ADR-011 (tenancy-by-deployment), ADR-013 (API/SSO seams). Does not supersede them.

## Context

The `shared`-tier security and SaaS capabilities (account lockout, MFA, nonce-CSP,
atomic audit, column encryption; SSO, per-consumer API keys + OpenAPI, webhooks,
SCIM) are real and well-understood, but they:

- require **external services** that can't run or be tested in the base (Upstash,
  an IdP, an SMTP server, a webhook receiver), and
- would add **~10 runtime deps and 3+ Prisma models** to **every** fork if baked
  into the template — directly contradicting the lean prototype-rail principle
  (ADR-006) and the per-deployment tenancy model (ADR-011).

A `personal`-tier prototype must not pay that weight; a `shared`-tier project
heading to handoff must be able to add any of them **without a design exercise**.

## Decision

Ship each capability as a **complete, ready-to-apply recipe** under
`docs/recipes/`, **not** as base code:

- `docs/recipes/shared-security/` — `1-account-lockout`, `2-mfa-totp`,
  `3-nonce-csp`, `4-atomic-audit-triggers`, `5-column-encryption` (the SECURITY.md
  §16 shared-tier checklist items).
- `docs/recipes/saas/` — `1-sso-oidc-saml`, `2-api-keys-openapi`, `3-webhooks`,
  `4-scim-provisioning`.

Each recipe is **template-specific** (real copy-paste code against the actual
`lib/auth.ts`, `lib/api-helpers.ts` wrappers, `withApiAuth`/`mapSsoRole` seams,
the audit extension, `next.config.ts` CSP, the `/api/v1` rewrite) and carries:
when-to-add trigger, exact deps, the precise files to change, env vars,
how-to-test, rollback, and the `SECURITY.md` rows to add.

The base stays **green and lean**; applying a recipe to a fork is a copy-paste +
`/code-review` + `/ship`, not a re-litigation of the design. The `/scale-up` skill
indexes the library, and `SECURITY.md` §16 (the shared-tier checklist) links the
security recipes directly.

## Consequences

- **Positive:** the prototype rail keeps zero enterprise weight; every `shared`
  fork inherits a documented, no-design-debt path to each capability; the seams
  added in ADR-013 (and `mapSsoRole`, `withApiAuth`, `recordAudit`) are exactly
  the integration points the recipes use, so there is **no refactor** to apply one.
- **Negative:** a recipe is reference code, not a shipped+tested implementation —
  a fork applying one owns its testing (each recipe ships a "how to test"
  section). Recipes can drift from the base over time; they cite the files/line
  patterns they touch so drift is detectable, and `/conform` can re-check.
- Two recipes (`api-keys-openapi`, several security ones) edit CLAUDE.md
  "Ask before" files and/or add >50 KB deps — each recipe flags this inline and
  prescribes `/code-review` + an ADR per the existing hard rules.

## Alternatives considered

1. **Bake all capabilities into the base (opt-in via env flags).** Rejected:
   ~10 deps + 3 models + dead-until-configured code in every fork; breaks ADR-006.
2. **A separate "enterprise" template variant/branch.** Rejected: doubles the
   maintenance surface and the fork would diverge; recipes keep one base.
3. **Leave them as the `/scale-up` one-line pointers (status quo).** Rejected:
   that left the actual design+code to each fork; the recipes remove that cost.

## Related

- `SECURITY.md` §16 — shared-tier security checklist (links the security recipes)
- `docs/decisions/ADR-013-api-versioning-and-seams.md` — the API/SSO seams the recipes build on
- `.claude/skills/scale-up/SKILL.md` — indexes the recipe library
