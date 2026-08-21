# ADR-045 — Enterprise SSO (SAML→OIDC) + SCIM 2.0 via an Ory Polis sidecar

**Status:** **SUPERSEDED (2026-08-21)** — the implementation was removed as the last
unexecuted item of the audit's A1 dormant-layer cut (operator-approved; see
`docs/AUDIT-DECISIONS.md` A1 and the Round 13 entry in `docs/findings-register.md`).
The decision recorded below is kept verbatim as the historical record of what was built
and why. It is NOT the current state of the tree. To re-adopt, follow
`docs/recipes/saas/1-sso-oidc-saml.md` (SSO) and `docs/recipes/saas/4-scim-provisioning.md`
(SCIM), which carry the same design.

_Original status: Accepted (enterprise pivot, WS-6 Identity, operator-directed 2026-07-11)._
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Builds on / extends:** ADR-024 (SSO via Microsoft Entra ID — the OIDC-direct
reference, generalized here to "one OIDC provider per deployment"), ADR-013 (the
identity/API seams — `mapSsoRole` as the single claims→Role point), and ADR-035
(Docker-first, one dockerized deployment per tenant — the shape that makes a
single-IdP service-provider the right answer over a multi-tenant broker).

## Context

The v2 enterprise benchmark (C03 — Auth & enterprise identity) found two NET-NEW
gaps: the stack does **OIDC** today (Entra, ADR-024) but has **no SAML** and **no
SCIM 2.0** directory provisioning. Deploy-per-tenant (ADR-035) reshapes the whole
category: one deployment = one tenant = one IdP. That collapses the value of
multi-tenant SSO brokers (WorkOS/Clerk/Auth0 — SaaS + per-connection "SSO tax") and
elevates a **self-hostable service-provider** that federates a single upstream IdP.

Auth.js is now maintenance-only under Better Auth (2025-09-26); a rewrite to Better
Auth's native SAML/OIDC/SCIM is a tracked **P1** — not this phase. For v1 we keep
Auth.js and add the missing protocols with the least new surface.

Ory Polis (ex-BoxyHQ **SAML Jackson**, Apache-2.0) bridges a tenant's SAML into a
standard **OIDC** endpoint AND exposes **SCIM 2.0** — both jobs in **one sidecar**.
Because it speaks OIDC, Auth.js consumes it exactly like Entra: another OIDC
provider, no library rewrite. The alternatives are heavier full IdPs (Keycloak /
Authentik / Zitadel — a whole identity microservice suite), a runtime-dep NextAuth
provider package (`@boxyhq/saml` — on the Ask-before surface), or building SCIM
in-house (the 2026 consensus is buy/adopt: SCIM is harder than SSO — PATCH quirks,
few OSS scaffolds).

## Decision

**Adopt Ory Polis as an opt-in compose sidecar + build a thin, dep-free app-side
seam (`lib/sso/**`) that is a silent no-op until configured.** Concretely:

1. **SAML→OIDC = a generic OIDC provider, no new dep** (`lib/auth.ts`). When
   `POLIS_ISSUER` + `POLIS_CLIENT_ID` + `POLIS_CLIENT_SECRET` are all set (required
   together, mirroring Entra's three-var gate — a half-config renders no broken
   button), `buildProviders()` registers a config-driven generic OIDC provider whose
   `issuer` is Polis's `/.well-known/openid-configuration`. Optional
   `POLIS_SAML_TENANT`/`POLIS_SAML_PRODUCT` pass through as authorization params for
   the deploy's SAML connection. `allowDangerousEmailAccountLinking` stays **OFF**
   (no takeover via a spoofable email claim). `ssoProviderPlan` generalizes:
   `configured`/`ssoEnabled` = Entra **or** Polis, with new `entraEnabled` /
   `polisEnabled` booleans; the SSO-only enforcement (`AUTH_ENFORCE_SSO`) applies to
   whichever provider is configured.

2. **SCIM provisioning = an internal webhook, `withInternalAuth` + optional HMAC**
   (`app/api/internal/scim/route.ts` → `lib/sso/scim.ts`). Polis Directory Sync
   POSTs dsync events; the route is gated by the template's `withInternalAuth`
   shared-secret primitive (`SCIM_INTERNAL_SECRET`, bearer, `skipWhenUnconfigured` →
   `200 { skipped: true }` while unset, so SCIM is dormant by default), and
   additionally verifies the BoxyHQ HMAC-SHA256 signature (timing-safe) when
   `SCIM_WEBHOOK_SECRET` is set. `provisionDirectoryEvent` maps events onto the
   existing `User` model through the **audited** `prisma` client:
   - `user.created` → create at **VIEWER** (least privilege; an admin promotes
     in-app),
   - `user.updated` → update name only — **never the role** (an in-app promotion
     survives a re-sync, the same invariant as the jwt callback not re-mapping IdP
     claims),
   - `user.deleted` / `active:false` → **soft-delete** (`prisma.user.delete`, which
     the soft-delete extension converts to a `deletedAt` write) — off-boarding that
     reuses the recycling-bin + audit invariants,
   - unknown/group events → `{ skipped: true }` (no crash),
   - a create colliding with a soft-deleted email (rehire) → `noop` (documented v1
     limitation; manual restore via the recycling bin).
     `withRateLimit` composes OUTSIDE `withInternalAuth` (OWASP A04); the handler is
     traced via `withSpan("sso.scim.provision")` (reusing the WS-4 backbone).

3. **Sidecar = the OSS `boxyhq/jackson` image (Apache-2.0), pinned, behind an `sso`
   compose profile** in `compose.prod.yaml`. Ory's enterprise Polis image is a
   drop-in swap for license holders. The base topology (app + Caddy [+ db]) is
   unaffected; bring identity up with
   `--profile bundled-db --profile sso`.

4. **Entra stays (ADR-024), generalized** to "one OIDC provider per deployment":
   Entra is the cheapest OIDC-direct path; SAML-only tenants route through Polis.
   Keep least-privilege `mapSsoRole` (VIEWER default) and the soft-deleted-user
   sign-in block.

The env contract (`lib/env.ts`, all optional) is the loud boot validator;
`lib/sso/config.ts` reads `process.env` at call time (Edge-safe), the same seam
shape as `lib/ai` (ADR-036) and `lib/observability` (ADR-040).

## Consequences

- **Positive.** SAML + SCIM with **zero new runtime dependency** and **no Auth.js
  rewrite**; fully OSS/self-hostable; one sidecar covers both NET-NEW rows; inert on
  every fork that doesn't opt in (default posture byte-for-byte unchanged); off-board
  is automatic and audited; least-privilege by construction.
- **Negative / risk.** The sidecar is **infra-unverified** in-session (no live Polis
  booted) — the OIDC handshake params and dsync webhook shape are wired to the
  documented contract but not end-to-end tested; this is a wave-off in
  `docs/findings-register.md` that re-opens when a compose-up + real IdP verifies the
  round-trip. Rehire/reactivation of a soft-deleted user is a documented v1 gap.
  Polis runs its own DB (point `POLIS_DB_URL` at the bundled Postgres or any managed
  Postgres). `POLIS_CLIENT_SECRET` / `SCIM_INTERNAL_SECRET` / `SCIM_WEBHOOK_SECRET`
  are **Restricted** (SECURITY.md §1); `POLIS_ISSUER` is an egress destination
  (SECURITY.md §7, a T4 sub-case like `AI_BASE_URL`).

## Alternatives considered

- **Keycloak / Authentik / Zitadel** — full self-hosted IdPs; a whole identity
  service to run, heavy for the single-IdP deploy-per-tenant shape. Documented as the
  BYO-IdP option, not wired.
- **`@boxyhq/saml` NextAuth provider dep** — turnkey tenant/product wiring but a
  runtime dep on the Ask-before surface + coupling to its Auth.js-v5 support.
  Rejected in favor of the dep-free generic OIDC provider.
- **Better Auth native SAML/OIDC/SCIM plugins** — in-app, but only reachable by
  rewriting off Auth.js — the tracked P1 migration, not v1.
- **WorkOS / Clerk / Auth0** — managed B2B SSO; SaaS + per-connection tax, value
  muted by deploy-per-tenant, contradicts the self-host pivot.
- **Build SCIM in-house** — 2026 consensus is adopt: SCIM PATCH semantics + few OSS
  scaffolds make it costlier than the sidecar.

## Amendment (2026-07-11, WS-6 closeout — senior-review fixes)

The first senior-code-reviewer pass on the WS-6 diff surfaced four open findings.
Two of them require a design decision recorded here (they change the identity
trust boundary), so they are adjudicated in this ADR rather than as a rushed edit:

### A1 — SCIM-provisioned users MUST be able to complete SSO login (the [High])

**Problem.** `provisionDirectoryEvent` creates a `User` row with **no linked
`Account`**. On the user's first Polis login, Auth.js matches the email but finds
no `polis` account and — with `allowDangerousEmailAccountLinking:false` — throws
`OAuthAccountNotLinked`, a hard block. This breaks the flagship US-1/US-2 workflow:
an auto-provisioned (US-2) user can never actually sign in (US-1). The whole seam
is inert until this is fixed.

**Decision.** Scope `allowDangerousEmailAccountLinking:true` to the **Polis
provider ONLY** (Entra keeps the default OFF), **paired with a
`passwordHash === null` guard** in the `signIn` callback:

- The Polis provider is _willing_ to email-link, so a SCIM-created **passwordless**
  row is claimable on first SSO login (US-1/US-2 works).
- The guard (`isFederatedSignInAllowed`, `lib/sso/config.ts`) **denies** the
  federated sign-in when the matched row has a **non-null `passwordHash`** — a real
  password user with a colliding email is NOT silently taken over by a spoofable
  SSO email claim. This preserves the exact protection `allowDangerousEmailAccountLinking:false`
  gave, narrowed to the one safe case (passwordless SCIM rows).
- A SCIM/Polis user never has a password, so a _returning_ linked user (passwordHash
  null) always passes; only a password-user email collision is blocked.

Rationale for this over an adapter wrap: the guard is a pure, unit-testable function
(no NextAuth boot, no adapter surgery), and it keeps the "dangerous" flag's blast
radius provider-scoped and paired with an explicit invariant.
`allowDangerousEmailAccountLinking` on Entra stays OFF.

**Refinement (2nd senior review, WS-6 closeout).** The block is applied ONLY at the
true first-link moment — when NO `polis` `Account` is linked to the user yet. The
`signIn` callback does an indexed `account.findFirst({ userId, provider:"polis" })`
and passes `hasLinkedProviderAccount` to `isFederatedSignInAllowed`; once an Account
exists, every later sign-in is a normal returning login and is allowed regardless of
`passwordHash`. Without this, a `passwordHash` set on an ALREADY-linked SSO user (a
forgot-password reset, an admin break-glass password — both pre-existing, unmodified
routes) would permanently lock that user out of SSO, with no path to re-null the hash
(and no login at all under `AUTH_ENFORCE_SSO=true`). `passwordHash` is not a reliable
proxy for "SSO-managed"; the linked Account is. Contract tests
(`tests/contracts/auth.test.ts`, `tests/contracts/sso.test.ts`) prove the first-link
password-user block AND the returning-linked-user allow. Secondary hardening —
forgot-password / admin-password-set refusing an already-federated identity — is a
tracked follow-on (defense in depth; the Account-consult already closes the lockout).

### A3 — SCIM correlation gains a stable directory id (the email-rename [Med])

**Problem.** SCIM was keyed solely on `email`. A directory `user.updated` that
**renames** an email doesn't match the existing row → the create branch runs → a
second VIEWER row at the new email while the old-email row stays live and loginable
(re-opens US-3's orphaned-access gap).

**Decision.** Add a **nullable, unique `scimExternalId`** column to `User` (a small,
forward-compatible additive migration — no NOT NULL, no default, existing/password
rows stay null; multiple NULLs are allowed under a Postgres unique index).
`provisionDirectoryEvent` now correlates on the **stable directory id first**
(BoxyHQ dsync `data.id`), falling back to email for events without one and for
pre-`externalId` rows (which get the id backfilled on their next update). A rename
then matches by id and updates the email **in place** — no orphan row. The email
fallback means an unverified `data.id` shape can only degrade to the _previous_
behavior, never regress (consistent with the ADR-045 infra-unverified wave-off).
Chosen over documenting the gap as a v1 non-goal because the fix is additive,
low-risk, and actually closes US-3's rename hole.

### A2 / A4 (no trust-boundary decision, recorded for completeness)

- **A2 [Med] Polis public ingress.** The `sso` profile exposed `polis:5225` only on
  the compose network; OIDC/SAML need browser- and IdP-reachable endpoints. Added a
  `POLIS_DOMAIN` Caddy site block reverse-proxying to `polis:5225` (inert on an
  unpublished port when unset); `POLIS_EXTERNAL_URL` must equal `https://<POLIS_DOMAIN>`.
- **A4 [Low] zod at the boundary.** The SCIM webhook body was validated with
  hand-rolled type guards; added `lib/validations/sso.ts` (`normalizedScimEventSchema`,
  `.email()` on the address) so a malformed email is a `400`, per the CLAUDE.md
  "validate at the API boundary with zod" hard rule.

## References

- v2 benchmark C03 (Auth & enterprise identity) — `docs/research/v2/enterprise-benchmark-v2.html`.
- Ory Polis — github.com/ory/polis; BoxyHQ SAML Jackson (`boxyhq/jackson`, Apache-2.0).
- Build-vs-buy: `docs/build-vs-buy-ledger.md` (2026-07-11 — Enterprise SSO + SCIM identity seam).
- Blueprint: `docs/blueprints/enterprise-ws6-identity.md`.
