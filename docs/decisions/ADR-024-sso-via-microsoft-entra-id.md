# ADR-024 — MFA via Microsoft Entra ID SSO (flag-enforced)

**Status:** Accepted
**Date:** 2026-06-24
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Closes:** SECURITY.md finding **T-02** (No MFA, open High) — for any deployment
that enables and enforces SSO.
**Builds on:** ADR-013 (the SSO seam + `mapSsoRole`), ADR-001 (Auth.js v5 locked).

## Context

T-02 (no MFA) has been the only open High finding. SECURITY.md §16 offered three
ways to close it: WebAuthn, TOTP, or fronting the app with an SSO provider that
enforces MFA itself. The operator chose **SSO**, delegating the second factor to
the organization's IdP rather than building/operating an in-app factor.

`lib/auth.ts` already had the seam — `mapSsoRole()` and commented OIDC stubs — but
no functional provider. The credentials-only login meant a single stolen password
was full account takeover.

## Decision

Wire **Microsoft Entra ID** (Auth.js `microsoft-entra-id` provider) into
`lib/auth.ts`, gated entirely on env:

- **Dormant by default.** No Entra env → behavior is unchanged (password login only).
  This matches the template's other opt-in features (Sentry, cron, Docker).
- **`AUTH_MICROSOFT_ENTRA_ID_ID` set** → the provider is registered and a "Sign in
  with Microsoft" button appears alongside the password form.
- **`AUTH_ENFORCE_SSO=true`** → the credentials provider is removed from the list
  entirely (SSO-only). Password login is gone, so the IdP — and its MFA — is the
  only way in. **This is what actually closes T-02** for that deployment.

No new dependency (the provider ships with `next-auth`). **No DB migration:**
`PrismaAdapter` is already wired and the `Account`/`Session` tables exist; OAuth
tokens persisted in `Account` are already covered by `SCRUB_FIELDS`.

### Security decisions baked in

- **Least privilege:** new SSO users get `VIEWER` (`mapSsoRole` default). An admin
  promotes them in-app. A misconfigured IdP cannot mint an ADMIN. Group/role-claim
  auto-mapping is a documented, opt-in extension a trusting fork can add.
- **No dangerous account linking:** `allowDangerousEmailAccountLinking` stays OFF.
  An Entra login whose email matches an existing password user is **not** silently
  linked — prevents takeover via a spoofable/unverified email claim.
- **Enforcement is per-deployment**, not per-fork: the same codebase ships both
  modes; a fork that ships with both providers (no enforcement) leaves T-02 open
  for itself and must risk-accept in writing (SECURITY.md §11).

## Consequences

- A fork closes T-02 by registering an Entra app, setting three env vars, the
  redirect URI `{AUTH_URL}/api/auth/callback/microsoft-entra-id`, and
  `AUTH_ENFORCE_SSO=true`.
- The full IdP round-trip can't run in `/ship` (needs a real tenant) — it's manual
  UAT. Unit/contract tests cover `mapSsoRole` (least privilege) and provider gating.
- Another IdP (Okta/Auth0/generic OIDC) is a small follow-up: add the provider in
  `buildProviders()` and, if desired, map claims in `mapSsoRole`.
- **Activation requires id + secret + issuer (all three).** Issuer is mandatory so
  the provider can't silently default to the any-tenant `common` endpoint (which
  would let any Microsoft account sign in). A `signIn` callback blocks new sign-ins
  by soft-deleted SSO users (the adapter path, unlike credentials, doesn't filter
  `deletedAt`); already-issued JWTs persist to `maxAge` — rotate `AUTH_SECRET` to
  revoke now. An optional `CSP_REPORT_URI` is unrelated but ships alongside.
- **Operational cost:** the existing jwt callback runs one indexed `users` read per
  authenticated request; SSO users hit the same path (no extra cost vs credentials).
  A shared-tier fork at high RPS can drop that block and lean on `maxAge` (documented
  in `lib/auth.ts`).

## Alternatives considered

- **TOTP (recipe `2-mfa-totp`)** — in-app authenticator-app factor. Self-contained
  but adds a Restricted `totpSecret` column, enroll/verify/recovery-code UX, and
  more attack surface to operate. Kept available as a recipe; not the chosen path.
- **WebAuthn / passkeys** — strongest phishing resistance but the heaviest change
  (credential storage, ceremony APIs, fallback UX). Deferred.
- **Generic OIDC instead of Entra-specific** — rejected for now in favor of the
  concrete provider the operator targets; the seam keeps generic OIDC easy to add.
