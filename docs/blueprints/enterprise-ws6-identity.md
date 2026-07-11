# Blueprint — Enterprise WS-6: Identity (Ory Polis SAML/SCIM sidecar)

Scope: app/api/internal/scim/**, lib/sso/**

> Governs WS-6 Identity: enterprise SSO (SAML→OIDC) + SCIM 2.0 directory provisioning via an
> **opt-in Ory Polis sidecar**. The `Scope:` line above satisfies both hooks: `blueprint-gate.mjs`
> (ADR-033) for the new `app/api/internal/scim/route.ts`, and it documents the `lib/sso/**` surface
> whose build-vs-buy adjudication lives in `docs/build-vs-buy-ledger.md` (2026-07-11 — Enterprise
> SSO + SCIM identity seam). Decision of record: **ADR-045** (extends ADR-024 OIDC-direct / ADR-013
> the identity seam). This is the requirements contract `/qa` and `/uat` trace against.

## Open questions — RESOLVED

The full-track blueprint resolves open questions with the operator. This session is **non-interactive**
(the harness `AskUserQuestion` channel was unavailable — two attempts returned a closed permission
stream), so each question is resolved to its **recommended default** — every one the conservative,
benchmark-aligned (`docs/research/v2/enterprise-benchmark-v2.html` C03), template-faithful choice —
and recorded here for operator audit/override. None changes the security floor.

1. **How does Auth.js consume Polis's SAML→OIDC bridge?** → **A config-driven GENERIC OIDC provider**
   in `lib/auth.ts` (issuer = Polis `/.well-known/openid-configuration`), mirroring the existing Entra
   OIDC wiring. **Zero new runtime dep** (honors the Ask-before ">50 KB runtime dep" rule); the
   `@boxyhq/saml` NextAuth provider package is the rejected alternative (adds a dep + couples us to its
   Auth.js-v5 support).
2. **How is the SCIM provisioning endpoint authenticated?** → **`withInternalAuth` + optional BoxyHQ
   HMAC.** The template's shared-secret internal primitive is the enforced floor (dormant until
   `SCIM_INTERNAL_SECRET` is set, exactly like the cron endpoint), and the BoxyHQ dsync HMAC signature
   is verified additionally when `SCIM_WEBHOOK_SECRET` is set. The benchmark explicitly names
   `withInternalAuth`; this satisfies the "auth wrapper on every route" hard rule and still honors the
   real Polis webhook contract.
3. **Which Polis image does the compose sidecar default to?** → **`boxyhq/jackson` (OSS core,
   Apache-2.0), pinned.** Ory's enterprise Polis image is documented as a drop-in swap for license
   holders. Keeps the seam fully OSS/self-hostable and matches the benchmark's Apache-2.0 finding.

## Problem & outcome

The stack does OIDC today (Microsoft Entra, ADR-024) but has **no SAML** and **no SCIM** — the two
NET-NEW enterprise-identity rows in the v2 benchmark (C03). Deploy-per-tenant reshapes the category:
one deployment = one tenant = one IdP, which collapses the value of multi-tenant SSO brokers and
elevates a self-hostable **service-provider** answer. Ory Polis (ex-BoxyHQ SAML Jackson) turns any
customer's SAML into a standard OIDC endpoint — so **Auth.js stays as-is** and merely gains another
OIDC provider — and it also speaks SCIM 2.0, covering both rows with **one sidecar**.

When this ships: a fork sets `POLIS_*` env and a SAML-only tenant can sign in through Polis exactly
like an Entra OIDC tenant; and a fork sets `SCIM_INTERNAL_SECRET` and directory add/remove events
from the tenant's IdP create/off-board users automatically — **least-privilege VIEWER on create**,
**soft-delete on de-provision** — reusing the existing audit + soft-delete invariants. With no env
set, the whole layer is a **silent no-op** (SSO dormant, SCIM endpoint returns `{ skipped: true }`),
so this template's default posture is byte-for-byte unchanged. Seam pattern mirrors `lib/ai` (ADR-036)
and `lib/observability` (ADR-040): config gate reads `process.env` at call time; env contract in
`lib/env.ts` is the loud boot validator.

## User stories

- **US-1 (SAML tenant sign-in).** As a user at a SAML-only enterprise IdP, I can sign in to the app,
  because Polis bridges my IdP's SAML into an OIDC login Auth.js consumes. My first login lands me at
  the **VIEWER** role; an admin promotes me in-app.
- **US-2 (auto on-boarding via SCIM).** As an IT admin, when I add an employee to the corporate
  directory, a user row is created in the app automatically (VIEWER), so I don't hand-provision.
- **US-3 (auto off-boarding via SCIM).** As an IT admin / security owner, when I remove or deactivate
  an employee in the directory, their app user is **soft-deleted** and can no longer sign in — closing
  the orphaned-access gap. Their audit history is preserved.
- **US-4 (dormant by default).** As the template maintainer, a fork that never configures SSO/SCIM is
  entirely unaffected: no new required env, no behavior change, `/ship` stays green.
- **US-5 (OSS self-host).** As a self-hosting operator, I can run the identity sidecar with a fully
  OSS Apache-2.0 image via one compose profile, no SaaS/per-connection tax.

## Scenarios (happy + worst path)

- **SSO happy.** `POLIS_ISSUER`+`POLIS_CLIENT_ID`+`POLIS_CLIENT_SECRET` all set → a "Sign in with SSO"
  provider registers; a SAML tenant completes login; `signIn` callback rejects the login if the linked
  row is soft-deleted; new user = VIEWER; an in-app role promotion **survives** the next SSO login
  (the jwt callback deliberately does not re-map from IdP claims — same invariant as Entra).
- **SSO worst.** Only `POLIS_ISSUER` set (id/secret missing) → provider does **not** register (no broken
  button), SSO stays dormant. A spoofable email claim does **not** auto-link to an existing password
  user (`allowDangerousEmailAccountLinking` stays OFF). Enforcing SSO-only (`AUTH_ENFORCE_SSO=true`)
  with any SSO configured removes the credentials provider so IdP MFA is mandatory.
- **SCIM happy.** Polis POSTs a `user.created` dsync event with a valid bearer (+ HMAC if configured)
  → a VIEWER user is created; `user.updated` name change updates the name (**never the role**);
  `user.deleted` / `active:false` soft-deletes the user (off-board).
- **SCIM worst.** Wrong/missing bearer → 401 (constant-time compare in `withInternalAuth`). Bad/absent
  HMAC when `SCIM_WEBHOOK_SECRET` is set → 401 (constant-time compare). Malformed JSON → 400. An event
  for a user who doesn't exist being deactivated → `noop` (no error). A group event or unrecognized
  event type → `{ skipped: true }` 200 (no crash). A rehire (SCIM re-create of a previously
  soft-deleted email) → **v1 limitation**: returns `noop` (the audited client can't see the
  soft-deleted row to restore it); documented + adjudicated (see Non-goals). Endpoint dormant (secret
  unset) → `200 { skipped: true }`, never provisions.
- **Flood.** SCIM endpoint is `withRateLimit`-wrapped OUTSIDE the auth wrapper (OWASP A04) so a burst is
  throttled (429 + Retry-After) before auth work runs. The limit is tuned for bulk initial-directory
  sync and is operator-tunable.

## Architecture sketch

```
Tenant SAML IdP ──SAML──▶ Ory Polis sidecar ──OIDC (.well-known)──▶ Auth.js generic OIDC provider
                          (boxyhq/jackson,        lib/sso/config.ts gate + lib/auth.ts buildProviders()
                           `sso` compose profile)  → VIEWER on first login, soft-delete sign-in block
Tenant directory ─SCIM──▶ Ory Polis Directory Sync ──dsync webhook──▶ POST /api/internal/scim
                                                     withInternalAuth("SCIM_INTERNAL_SECRET", bearer)
                                                     + optional BoxyHQ HMAC (SCIM_WEBHOOK_SECRET)
                                                     → lib/sso/scim.ts provisionDirectoryEvent()
                                                        → audited prisma.user create/update/delete
                                                          (VIEWER default; soft-delete off-board)
```

- `lib/sso/config.ts` — call-time gate: `isPolisSsoConfigured()`/`polisSsoConfig()` (issuer+id+secret
  required together), `scimWebhookSecret()`, `verifyScimSignature()` (HMAC-SHA256, timing-safe),
  `SsoNotConfiguredError`. Reads `process.env` directly (Edge-safe), mirroring `lib/ai/config.ts`.
- `lib/sso/scim.ts` — `normalizeDirectoryEvent(raw)` (BoxyHQ dsync shape → `{type,email,name,active}`),
  `provisionDirectoryEvent(evt)` (audited `prisma` only; VIEWER on create; soft-delete via
  `prisma.user.delete`; never mutates an existing role; P2002 on a soft-deleted-email create → noop).
- `lib/sso/index.ts` — barrel.
- `app/api/internal/scim/route.ts` — thin: rawText → optional HMAC → JSON parse → normalize → traced
  `withSpan("sso.scim.provision")` provision. Wrapped `withRateLimit(withInternalAuth(...))`.
- `lib/auth.ts` — generalize `ssoProviderPlan` to fold in Polis (`configured` = Entra **or** Polis;
  new `entraEnabled`/`polisEnabled`), and push a generic OIDC provider when `polisEnabled`.
- `lib/env.ts` + `.env.example` — `POLIS_*` / `SCIM_*` contract (all optional; dormant by default).
- `compose.prod.yaml` — `polis` service under a new `sso` profile (boxyhq/jackson, Apache-2.0).
- `docs/decisions/ADR-045-*` + `SECURITY.md` (POLIS_CLIENT_SECRET / SCIM secrets = Restricted; Polis
  egress = a T4 sub-case) + `tests/contracts/sso.test.ts`.

## Tier

`shared` — enterprise identity (SSO/SCIM) is a shared-tier concern; the seam is inert on personal
forks (no env → no-op), so it imposes nothing on the `personal` default.

## Closeout (2026-07-11 — senior-review fixes, ADR-045 amendment)

Four open senior findings were fix-forwarded before landing WS-6 (decisions in **ADR-045
amendment A1–A4**):

- **A1 [High] SCIM users can now complete SSO login.** A SCIM row has no linked `Account`, so
  first Polis login threw `OAuthAccountNotLinked`. Fix: `allowDangerousEmailAccountLinking:true`
  scoped to the **Polis provider only**, paired with `isFederatedSignInAllowed` in the `signIn`
  callback — auto-link happens **only when the matched row is passwordless** (a SCIM row); a real
  password user with a colliding email still hard-blocks (no takeover). Contract test proves the
  `passwordHash!==null` block.
- **A2 [Med] Polis public ingress** via a `POLIS_DOMAIN` Caddy site block → `polis:5225`;
  `POLIS_EXTERNAL_URL` must equal `https://<POLIS_DOMAIN>`.
- **A3 [Med] email-rename no longer orphans access.** New nullable-unique `scimExternalId`
  column (forward-compatible migration); `provisionDirectoryEvent` correlates on the stable
  directory id first (email fallback), so a `user.updated` rename updates the row in place.
- **A4 [Low] zod at the boundary:** `lib/validations/sso.ts` `normalizedScimEventSchema`
  (`.email()`) → the SCIM route returns 400 on a non-conforming event.

## Non-goals / follow-ons (tracked)

- **Infra-unverified seam** (like the pgvector RAG seam, ADR-043): no live Polis is booted in-session,
  so the OIDC handshake params (Jackson-compat `client_secret_post` / `checks`) and the dsync webhook
  shape are wired to the documented contract but **not** end-to-end verified. Wave-off in
  `docs/findings-register.md`; re-opens when a compose-up + real IdP verifies the round-trip.
- **Rehire / SCIM reactivation of a soft-deleted user** — v1 returns `noop` (audited client can't see
  soft-deleted rows; using `prismaUnfiltered` here would trip `no-prisma-unfiltered-import` and widen
  the trust surface). Manual restore via the recycling bin covers it; a later increment can add an
  allowlisted restore path.
- **Better Auth migration** (native SAML+OIDC+SCIM in-app) — the tracked P1 alternative to the sidecar;
  out of scope here (ADR-045 keeps Auth.js).
- **Keycloak BYO-IdP** — documented as the heavier alternative; not wired.
