# C03 — Auth & Enterprise Identity (exhaustive 4-lens benchmark)

> Scored against the fixed stack (METHODOLOGY §"ground truth"): Auth.js v5
> (`next-auth@5.0.0-beta.31`) + `@auth/prisma-adapter` + `bcryptjs`, JWT sessions,
> 3-role enum, Entra ID opt-in (ADR-024). Pivot honored: **enterprise-only**,
> **deploy-per-tenant** (NO in-app row-level multi-tenancy — each deployment fronts
> **one** tenant/org and **one** IdP), **Docker-first self-hosted**, compose-now.
> Claude-first is irrelevant to this category. Today: **2026-07**.

**Why deploy-per-tenant reshapes this whole category:** the classic B2B-SaaS auth
problem — *one* app instance serving *N* enterprise customers, each with their own
IdP, each self-configuring their SSO connection — is the exact problem WorkOS/Stytch/
Clerk's per-connection pricing and "admin portal" exist to solve. **We do not have
that problem.** One deployment = one tenant = one IdP connection. That collapses the
value of managed multi-tenant SSO brokers and elevates *self-hostable, single-IdP-
per-deployment* solutions. Read every recommendation below through that lens.

---

### next-auth@5 / Auth.js v5 (+ `@auth/prisma-adapter`)

**One line:** Our incumbent session/auth framework — credentials + OAuth/OIDC providers, JWT sessions, PrismaAdapter for OAuth account linking. **Current choice; the question is KEEP vs REPLACE for enterprise.**

**4-lens top-10 (auth frameworks/libraries for a Next.js 16 RSC app):**

| # | Candidate | Lens | Stars (2026-07) | License | Maturity | One-line why-it-ranks |
|---|-----------|------|-----------------|---------|----------|-----------------------|
| 1 | **Auth.js v5 / next-auth** | BT, HS | ~28.3k | ISC | 2018; v5 perma-beta | Ubiquitous Next-native incumbent; huge provider catalog; **now maintained by the Better Auth team (maintenance-only)** |
| 2 | **Better Auth** | HS, OSS, ENT | ~29k | MIT | 2024; 1.x stable | TS-native, plugin arch; **native SSO(SAML+OIDC) + SCIM + organization plugins**; now stewards Auth.js; maintainers' pick for new projects |
| 3 | **Clerk** | ENT, HS | ~n/a (SaaS) | Proprietary (SaaS) | 2021; mature | Drop-in hosted auth + prebuilt UI; SSO/SCIM in higher tiers; per-MAU + SSO tax; not self-hostable |
| 4 | **Auth0 (Okta)** | BT, ENT | ~n/a (SaaS) | Proprietary (SaaS) | 2013; the enterprise default | Deepest enterprise/compliance surface; SSO/SCIM/MFA/audit; quote-only B2B track, expensive; not self-hostable |
| 5 | **WorkOS** | ENT | ~n/a (SaaS) | Proprietary (SaaS) | 2020; mature | Purpose-built B2B SSO/SCIM/audit; hosted admin portal; per-connection ($125) — value muted by deploy-per-tenant |
| 6 | **SuperTokens** | OSS, ENT | ~14.8k (core) | Apache-2.0 (core) | 2020; mature | Self-hostable open-core; SAML/SCIM via paid add-ons or Jackson; separate Java core service to operate |
| 7 | **Ory Kratos** (+ Hydra) | OSS, BT, ENT | ~13.6k (Kratos) | Apache-2.0 | 2020; scaled | Headless Go identity; used by OpenAI (Hydra); powerful but a microservice suite to run — heavy for our shape |
| 8 | **Keycloak** | BT, ENT, OSS | ~35.5k | Apache-2.0 | 2014 (Red Hat/IBM) | Full self-hosted IdP: SAML IdP+SP broker, SCIM, MFA, admin UI; the enterprise OSS standard — but a whole IdP, not a lib |
| 9 | **Zitadel** | OSS, ENT | ~13.4k | Apache-2.0 (community) | 2020; cloud-native | Go, API-first, container-friendly; **native SCIM 2.0**; SAML is **IdP-only** (no SP/broker) |
| 10 | **Lucia** | — | ~10k (**deprecated**) | MIT | v3 EOL 3/2025 | **Do not adopt** — deprecated; now a "build-your-own-auth" learning resource only |
| — | Stytch / Authentik | ENT / OSS | SaaS / ~20.7k | Prop. / MIT+ent | mature | Stytch = WorkOS-class SaaS; Authentik = homelab-favorite self-host IdP (Python/Go) — see SSO row |

**Head-to-head:** The decisive 2025 event: **Auth.js is now part of Better Auth** (announced 2025-09-26) [1]. The original maintainers' pace slowed; the Better Auth team took stewardship, promising Auth.js gets **security/urgent fixes only** while **new projects are pointed at Better Auth** [1][2]. v5 remains labeled beta with *"no immediate plans"* for a stable cut [2]. So the incumbent is production-solid but strategically frozen. Better Auth is the same team's forward path and — critically for us — ships **native SAML+OIDC SSO and SCIM plugins** [7][8], which Auth.js has **never** had (Auth.js does OAuth/OIDC social/enterprise providers, but **no SAML, no SCIM**). Clerk/Auth0/WorkOS/Stytch are SaaS and collide with the Docker-first self-host pivot; Keycloak/Ory/Zitadel/Authentik are full self-hosted IdPs you run *beside* the app (they don't replace the in-app session lib). For our deploy-per-tenant shape, the app only needs to consume **one** OIDC/SAML provider per deployment — a job Auth.js already does for OIDC (ADR-024 Entra).

**Recommendation:** **KEEP+HARDEN for v1; Better Auth is the P1 migration target.** Auth.js v5 + PrismaAdapter already satisfies the per-tenant model: credentials for internal users, one OIDC provider per deployment (ADR-024), `AUTH_ENFORCE_SSO` delegating MFA to the IdP (closes T-02). Harden by: (a) pinning off `-beta` risk with a documented "maintenance-only upstream" note + a `senior-review` watch on `next-auth` advisories; (b) adding the **SAML seam** (next row) since Auth.js can't do SAML alone. **Do not chase a rewrite in v1** — but log an ADR that Better Auth is the consolidation play (one lib = session + SSO + SCIM + org model, actively developed by the team that now owns our incumbent). **Fit 5/5** (it's already wired). **ADR impact:** supersede/annotate ADR-001's "Auth.js locked" with the maintenance-transfer reality; open an ADR "Better Auth migration evaluation (P1)."

---

### `bcryptjs` — password hashing

**One line:** Pure-JS bcrypt used by `lib/auth.ts` credentials login. **Current choice.**

**4-lens top-10 (password hashing for Node):**

| # | Candidate | Lens | Weekly npm (2026-07) | License | Notes | One-line why-it-ranks |
|---|-----------|------|----------------------|---------|-------|-----------------------|
| 1 | **`argon2` (node bindings)** | BT, ENT | ~850k | MIT | native (node-gyp) | **OWASP 2024+ default (Argon2id)**; memory-hard, GPU+side-channel resistant [4] |
| 2 | **`@node-rs/argon2`** | OSS, ENT | rising | MIT | napi, **prebuilt** | Argon2id with no node-gyp — clean in Docker/Alpine; best-fit native path |
| 3 | **`bcrypt` (native)** | BT, HS | ~1.8M | MIT | native | Fast bcrypt; OWASP-acceptable at cost≥12 [4]; 72-byte limit |
| 4 | **`bcryptjs`** *(incumbent)* | HS | ~3.2M | MIT | pure JS | Zero-native-dep, portable; **slower**; OWASP-acceptable at cost≥12 but not the 2026 default [4] |
| 5 | **`node:crypto` scrypt** | BT, OSS | stdlib | — | built-in | No dependency; OWASP fallback (N=2^17) if Argon2 unavailable [4] |
| 6 | **`@phc/argon2` / hash-wasm** | OSS | modest | MIT | wasm | WASM Argon2id — portable, no native build; middle ground |

**Head-to-head:** OWASP's Password Storage Cheat Sheet puts **Argon2id first** for new apps (m=19–64 MB, t=2–3, p=1); bcrypt(cost≥12) and scrypt(N≥2^17) are "still acceptable," not "preferred" [4]. `bcryptjs` is pure-JS so it's the *slowest* real option — a lower work-factor-per-millisecond, which is the wrong direction for an enterprise floor. Since the pivot is **Docker-first**, native bindings (`argon2`) or prebuilt napi (`@node-rs/argon2`) are no longer a portability problem the way they were for serverless — the image is built once. WASM (`hash-wasm`) is the zero-native-dep hedge.

**Recommendation:** **REPLACE → `@node-rs/argon2` (Argon2id).** Prebuilt napi = no node-gyp in the Docker build, OWASP-default algorithm. Keep a `bcryptjs.compare` fallback for verifying legacy hashes and **rehash-on-successful-login** to migrate silently. If node-gyp/napi is ever a problem, `hash-wasm` Argon2id is the fallback; `node:crypto.scrypt` is the zero-dep floor. **Fit 4/5** (drop-in in `lib/auth.ts`; touches an Ask-before file). **ADR impact:** new ADR "Argon2id password hashing (supersede bcryptjs)"; update SECURITY.md password-storage note.

---

### Enterprise SSO — SAML + OIDC (NET-NEW)

**One line:** Federated login against a customer IdP (SAML 2.0 and/or OIDC). Auth.js does **OIDC** today (Entra, ADR-024) but has **no SAML**. **NET-NEW for SAML.**

**4-lens top-10 (SSO for a self-hosted, one-IdP-per-deployment app):**

| # | Candidate | Lens | Stars/Scale (2026-07) | License | Self-host? | One-line why-it-ranks |
|---|-----------|------|-----------------------|---------|-----------|-----------------------|
| 1 | **Ory Polis** *(ex-BoxyHQ SAML Jackson)* | OSS, ENT | active (Ory-owned) | Apache-2.0 | **Yes (Docker)** | **Bridges SAML→OIDC**: Auth.js consumes it as a normal OIDC provider; **also does SCIM**; dockerized; there's a NextAuth `boxyhq-saml` provider [3][10] |
| 2 | **Keycloak** | BT, ENT, OSS | ~35.5k | Apache-2.0 | **Yes (Docker)** | Full IdP: SAML **IdP *and* SP/broker**, OIDC, SCIM, MFA, admin UI; the enterprise OSS standard [5][6] |
| 3 | **Better Auth SSO plugin** | OSS, ENT | ~29k (lib) | MIT | **Yes (in-app)** | Native **SAML 2.0 + OIDC** in the auth lib itself; no sidecar — but only if we migrate off Auth.js [7] |
| 4 | **Zitadel** | OSS, ENT | ~13.4k | Apache-2.0 | **Yes (Docker)** | Cloud-native Go IdP; OIDC + **SCIM**; **SAML is IdP-only (no SP broker)** — can't federate *upstream* SAML [6] |
| 5 | **Authentik** | OSS, HS | ~20.7k | MIT (+ ent) | **Yes (Docker)** | Popular self-host IdP (SAML+OIDC+SCIM); homelab/self-host favorite; heavier Python/Go stack [6] |
| 6 | **Ory Kratos+Hydra** | OSS, BT | ~13.6k | Apache-2.0 | **Yes (Docker)** | Headless microservice identity; SAML/OIDC; overkill to operate for single-tenant deployments |
| 7 | **SuperTokens + Jackson** | OSS, ENT | ~14.8k | Apache-2.0 | **Yes** | Open-core; SAML via Jackson, SCIM via add-on; separate core service |
| 8 | **WorkOS** | ENT | SaaS | Proprietary | No | Best managed B2B SSO/SCIM + admin portal — **but per-connection $125 & multi-tenant value is moot for us** [9] |
| 9 | **Stytch** | ENT | SaaS | Proprietary | No | WorkOS-class managed SSO/SCIM; per-connection beyond 5; SaaS-only [9] |
| 10 | **Auth0 / Clerk** | ENT, BT | SaaS | Proprietary | No | Enterprise-complete but SaaS + "SSO tax" (Auth0 quote-only B2B track; Clerk ~$75/connection) [11] |

**Head-to-head:** Because each deployment fronts **one** IdP, we need a **service provider / relying party**, not a multi-tenant broker. Two self-host paths dominate: **(a) Ory Polis (ex-SAML Jackson)** — a small dockerized service that turns any customer's SAML into an OIDC endpoint, so **Auth.js stays exactly as-is** and just adds one more OIDC provider; it *also* speaks SCIM, so one sidecar covers both NET-NEW rows [3][10]. **(b) Keycloak** — a full IdP the customer's IT can run/own, brokering upstream SAML/OIDC; heavier but the recognized enterprise standard and the answer when a tenant wants a real IdP with its own user store [5]. Zitadel is out for *federating* SAML (IdP-only) [6]. Managed brokers (WorkOS/Stytch/Auth0/Clerk) are excellent but contradict the Docker-first self-host pivot and their per-connection pricing has no payoff when there's one connection per deployment [9][11]. If we ever migrate to Better Auth, its in-app SSO plugin makes the sidecar unnecessary — that's the consolidation argument again [7].

**Recommendation:** **ADOPT (net-new) — Ory Polis (ex-SAML Jackson) as the dockerized SAML↔OIDC bridge, opt-in per deployment; Keycloak as the documented "bring-your-own-IdP" option.** Auth.js consumes Polis as a standard OIDC provider next to Entra — zero change to the session model, and it doubles as the SCIM endpoint (next row). Keep OIDC-direct (Entra/generic) as the default when the tenant's IdP already speaks OIDC (no SAML, no sidecar). **Fit 4/5** (bridge preserves the Auth.js seam; adds one compose service). **ADR impact:** new ADR "Enterprise SSO via OIDC-direct + Ory Polis SAML bridge (self-hosted)"; extends ADR-024/ADR-013 SSO seam.

---

### SCIM 2.0 provisioning (NET-NEW)

**One line:** Automated user/group provisioning + deprovisioning from the tenant IdP (Okta/Entra/Workday) into the app. **NET-NEW.**

**4-lens (SCIM: buy vs self-host vs build):**

| # | Candidate | Lens | License | Self-host? | One-line why-it-ranks |
|---|-----------|------|---------|-----------|-----------------------|
| 1 | **Ory Polis (ex-SAML Jackson) Directory Sync** | OSS, ENT | Apache-2.0 | **Yes (Docker)** | **SCIM 2.0** provisioning in the *same* service as the SAML bridge — one sidecar, both jobs [3][10] |
| 2 | **Keycloak** | BT, ENT | Apache-2.0 | **Yes** | SCIM + full IdP if the tenant wants directory ownership [5] |
| 3 | **Zitadel** | OSS, ENT | Apache-2.0 | **Yes** | **Native SCIM 2.0** inbound provisioning; good if adopted as the IdP [6] |
| 4 | **Better Auth SCIM plugin** | OSS | MIT | **Yes (in-app)** | In-app SCIM if we migrate to Better Auth — no sidecar [8] |
| 5 | **WorkOS Directory Sync** | ENT | Proprietary | No | Normalizes SCIM+HRIS across a dozen IdPs via webhooks — gold standard, but SaaS + per-connection [9][12] |
| 6 | **Stytch** | ENT | Proprietary | No | Managed SCIM alongside SSO; SaaS-only |
| 7 | **Build in-house** (`app/api/scim/v2/**`) | — | — | n/a | Full control, but SCIM is *harder than SSO*: per-IdP quirks, PATCH semantics, few OSS scaffolds — a real project [12] |

**Head-to-head:** Consensus in 2026 is **buy/adopt, don't build** — SCIM's per-IdP PATCH/filter quirks make hand-rolling it more work than SSO and there's little OSS scaffolding [12]. The managed answer (WorkOS Directory Sync) is genuinely the least-effort, but it's SaaS and per-connection — wrong side of the pivot, and its multi-IdP normalization is wasted on one IdP per deployment [9]. The self-host answer that fits us is the **same Ory Polis sidecar already chosen for SAML** — it exposes a SCIM 2.0 endpoint and emits provisioning events, so we get SCIM for the marginal cost of *nothing new to deploy* [3][10]. If Better Auth is adopted later, its SCIM plugin folds this in-app [8].

**Recommendation:** **ADOPT (net-new) via Ory Polis SCIM (the SSO sidecar), opt-in per deployment; DEFER building.** Wire an internal provisioning handler (`withInternalAuth` shared-secret) that consumes Polis's directory events to create/update/soft-delete `users` — reusing the existing soft-delete + audit invariants. Do **not** hand-write a SCIM server in v1. **Fit 4/5** (reuses the SSO sidecar + existing user lifecycle). **ADR impact:** folded into the SSO ADR above; note the `users` provisioning contract + least-privilege default role (VIEWER, per ADR-024).

---

### Entra ID (ADR-024) — keep as one provider?

**One line:** Microsoft Entra ID wired as an Auth.js OIDC provider, dormant-by-default, `AUTH_ENFORCE_SSO` closes MFA finding T-02. **Current, accepted.**

**4-lens (is Entra-as-a-provider still the right per-tenant default?):**

| # | Consideration | Verdict |
|---|---------------|---------|
| 1 | Fit to deploy-per-tenant | **Ideal** — one OIDC provider per deployment is exactly ADR-024's shape; no multi-tenant `common`-endpoint risk (issuer pinned) |
| 2 | Closes T-02 (MFA) | **Yes** — MFA delegated to Entra when `AUTH_ENFORCE_SSO=true` |
| 3 | Security posture | Strong — least-privilege `mapSsoRole` (VIEWER default), no dangerous account linking, soft-delete `signIn` block |
| 4 | Generalizes? | Yes — same `buildProviders()` seam takes Okta/Google/generic OIDC; SAML-only IdPs route through the Polis bridge |

**Head-to-head:** Entra is the single most common enterprise IdP and it speaks OIDC natively, so it needs **no** SAML bridge — it's the cheapest possible SSO path and it already ships. The only thing to add is documenting it as *one instance* of a **generic OIDC provider** pattern (so Okta/Google/Ping "just work" by env), and routing SAML-only tenants through Ory Polis.

**Recommendation:** **KEEP.** Generalize ADR-024 into a "one OIDC provider per deployment" pattern (Entra as the reference), keep least-privilege + no-dangerous-linking + enforce-SSO invariants. **Fit 5/5.** **ADR impact:** minor — annotate ADR-024 as the OIDC-direct reference within the new SSO ADR.

---

## Category verdict table

| Item | Current | Recommendation | Net-new deps to add | ADR impact | Priority |
|------|---------|----------------|---------------------|-----------|----------|
| Auth.js v5 / next-auth | incumbent | **KEEP+HARDEN** (maintenance-only upstream; Better Auth = P1 migration eval) | — | Annotate ADR-001; open "Better Auth eval" ADR | **P0** (harden) / P1 (migrate eval) |
| `@auth/prisma-adapter` | incumbent | **KEEP** (needed for OAuth/OIDC account linking + SCIM user store) | — | none | P0 |
| Password hashing (`bcryptjs`) | incumbent | **REPLACE → `@node-rs/argon2` (Argon2id)** + bcrypt legacy-verify/rehash-on-login | `@node-rs/argon2` | New ADR (supersede bcryptjs); SECURITY.md | **P0** |
| Enterprise SSO (SAML+OIDC) | none | **ADOPT** — OIDC-direct default + **Ory Polis** (ex-SAML Jackson) dockerized SAML bridge; **Keycloak** as BYO-IdP option | Ory Polis (compose service) | New SSO ADR (extends ADR-013/024) | **P1** |
| SCIM 2.0 provisioning | none | **ADOPT via Ory Polis SCIM** (same sidecar) + internal provisioning handler; **DEFER building** | (reuses Polis) | Folded into SSO ADR | P1 |
| Entra ID (ADR-024) | accepted | **KEEP** — generalize to "one OIDC provider per deployment" | — | Annotate ADR-024 | P0 |

## Recommended v1 enterprise-identity floor

1. **Session/auth:** Auth.js v5 + `@auth/prisma-adapter`, JWT sessions — **kept**, with an explicit "upstream is maintenance-only under Better Auth" note and an advisory watch. Better Auth migration is a **tracked P1**, not a v1 rewrite.
2. **Password hashing:** **Argon2id via `@node-rs/argon2`** (prebuilt napi, clean in Docker), bcrypt verify retained for legacy hashes with silent rehash-on-login. Closes the "OWASP-acceptable but not preferred" gap.
3. **Per-deployment SSO:** **OIDC-direct** (Entra reference, generic OIDC by env) as default; **`AUTH_ENFORCE_SSO`** delegates MFA to the IdP (closes T-02). Least-privilege VIEWER default, no dangerous email linking, soft-delete sign-in block — all inherited from ADR-024.
4. **SAML + SCIM:** one **dockerized Ory Polis** sidecar (opt-in per tenant) bridges SAML→OIDC *and* exposes SCIM 2.0 provisioning; **Keycloak** documented as the heavier "bring-your-own-IdP" alternative. No hand-built SAML/SCIM in v1.
5. **Invariants preserved:** every SSO/SCIM path routes through the existing auth wrappers, `mapSsoRole` least-privilege, soft-delete + audit-extension user lifecycle — the identity floor never bypasses the Prisma invariants.

---

## Sources

1. Auth.js is now part of Better Auth — nextauthjs/next-auth Discussion #13252 (announced 2025-09-26): https://github.com/nextauthjs/next-auth/discussions/13252
2. "How many more years of beta for v5?" — next-auth Discussion #13382; maintainer: "no immediate plans for v5, will maintain both": https://github.com/nextauthjs/next-auth/discussions/13382
3. Ory Polis (formerly BoxyHQ SAML Jackson) — SAML→OIDC bridge + SCIM 2.0 Directory Sync, Apache-2.0, dockerized: https://github.com/ory/polis
4. OWASP Password Storage Cheat Sheet (Argon2id first; bcrypt/scrypt acceptable): https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html — and 2026 comparison: https://securityboulevard.com/2026/06/bcrypt-vs-argon2-vs-scrypt-vs-pbkdf2-a-2026-decision-framework/
5. Keycloak vs WorkOS (SAML IdP+SP broker, SCIM, Apache-2.0): https://skycloak.io/blog/keycloak-vs-workos-comparison/
6. Keycloak vs Authentik vs Zitadel 2026 (stars; Zitadel SAML IdP-only; SCIM support): https://blog.houseoffoss.com/post/keycloak-vs-authentik-vs-zitadel-2026-which-open-source-login-tool-should-you-use — and https://skycloak.io/blog/keycloak-vs-zitadel-comparison/
7. Better Auth SSO plugin (native SAML 2.0 + OIDC): https://better-auth.com/docs/plugins/sso
8. Better Auth SCIM plugin / enterprise features: https://www.npmjs.com/package/@better-auth/sso and https://better-auth.com/docs/plugins/oidc-provider
9. WorkOS vs Auth0 vs Clerk for B2B SaaS 2026 (per-connection $125; admin portal): https://workos.com/blog/workos-vs-auth0-vs-clerk-the-best-auth-platform-for-b2b-saas-in-2026 and https://workos.com/blog/top-nextauth-alternatives-secure-authentication-2026
10. NextAuth BoxyHQ SAML provider (consume Jackson/Polis as OIDC): https://next-auth.js.org/providers/boxyhq-saml
11. The SSO tax in dollars (Auth0 quote-only B2B; Clerk ~$75/connection; Auth0 $800–1500/mo starting): https://dev.to/authagonal/the-sso-tax-in-dollars-what-saml-actually-costs-at-auth0-workos-and-clerk-3437 and https://clerk.com/articles/the-real-cost-of-enterprise-sso-per-connection-vs-per-mau-pricing
12. Build vs buy SSO/SCIM in-house (SCIM harder than SSO; few OSS scaffolds): https://workos.com/blog/build-vs-buy-part-i-complexities-of-building-sso-and-scim-in-house and https://clerk.com/articles/scim-2-0-explained-a-practical-guide-for-saas-auth
13. Lucia deprecated (v3 EOL March 2025; learning resource only): https://github.com/lucia-auth/lucia/discussions/1714 and https://www.wisp.blog/blog/lucia-auth-is-dead-whats-next-for-auth
14. LogRocket "best Next.js auth library 2026" (maintainers point new projects to Better Auth): https://blog.logrocket.com/best-auth-library-nextjs-2026/
