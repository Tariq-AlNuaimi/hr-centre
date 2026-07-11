# Enterprise Identity & Data Protection — Benchmark (Axis 3)

> Research-grade benchmark for the enterprise repositioning. Domain: **enterprise identity & data protection**. Today: 2026-07. Scored against the FIXED stack — Next.js 16 · Prisma 7 + PostgreSQL 17 · **Auth.js v5 (JWT sessions; the `sessions` table is OAuth account-linking only)** · zod · TypeScript — under the operator's binding constraints: **deploy-per-tenant (NO in-app row-level multi-tenancy — ADR-011 KEPT)**, **enterprise-only**, **self-hosted dockerized Postgres default**.

**Summary.** The pivot's identity floor (pivot-analysis Axis 3) must rise from "opt-in single-provider Entra ID (ADR-024)" to a real enterprise floor: multi-IdP SSO (SAML + OIDC) + SCIM provisioning + fine-grained authZ + field encryption + secrets management + tamper-evident audit. The decisive constraint is **deploy-per-tenant + self-hosted-dockerized**: each deployment serves exactly one organization, so per-connection SaaS pricing (WorkOS at ~$125/SSO-connection/mo, +$125 for SCIM [8]) is structurally wrong here — one deployment = one customer = one connection, and the value of hiding multi-tenant connection management evaporates. The clean architecture keeps **Auth.js v5 as the in-app session/RBAC layer (locked stack, incumbent)** and adds a **self-hostable SAML/OIDC+SCIM bridge in its own container** (Ory Polis, formerly BoxyHQ SAML Jackson) that Auth.js already ships a first-party provider for [6][7]. Everything else is a Prisma-extension or sidecar-container pattern that mirrors invariants the repo already has (audit + soft-delete extensions, `SCRUB_FIELDS`). This maps directly to Axis 3's "floor rises to SSO/SAML/OIDC + SCIM as default; fine-grained RBAC/ABAC; column-level encryption; audit retention + compliance export; secrets management."

Axis-3 mapping: this doc resolves the "SSO/SCIM depth, encryption, secrets, audit" open questions the pivot brief (lines 43, 85, 104) deferred to the fresh session, and confirms in-app multi-tenancy stays **REJECTED** (ADR-011 kept, decision #1).

---

## Capability 1 — Enterprise SSO (SAML + OIDC)

**Auth.js v5 reality:** ships mature OIDC/OAuth providers (incl. `microsoft-entra-id`, generic OIDC), but has **no native SAML** — SAML is delivered by bridging it to OIDC via a `boxyhq-saml` first-party provider [6][7]. So "extend Auth.js" for SAML means "run a SAML→OIDC bridge and point an Auth.js OIDC provider at it." That bridge (Ory Polis / BoxyHQ Jackson) is self-hostable and also does SCIM (see Cap 2).

| Capability              | Battle-tested pick             | Highest-star / most-popular                    | Enterprise-grade pick            | Best pure-OSS | Recommendation (our stack)                                    | Fit 1-5 | Notes                                                                                                                                                                          |
| ----------------------- | ------------------------------ | ---------------------------------------------- | -------------------------------- | ------------- | ------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Self-hosted full IdP    | Keycloak (Red Hat, Apache-2.0) | **Keycloak** (~26k★) / Authentik (~20.7k★ [5]) | Keycloak 26                      | Keycloak      | Optional heavy alternative; overkill per-tenant               | 3       | SAML+OIDC IdP+SP, SCIM server in 26.x [2], LDAP/AD federation [1]. Heavy JVM container; a full IdP per deployment is a lot of surface for one org.                             |
| SAML→OIDC + SCIM bridge | **Ory Polis / BoxyHQ Jackson** | Authentik (~20.7k★)                            | Ory Polis (self-host or premium) | **Ory Polis** | **ADOPT — pairs with Auth.js, own container**                 | **5**   | Auth.js ships `boxyhq-saml` provider natively [6][7]; bridge speaks SAML to the IdP, OIDC to Auth.js, and adds SCIM 2.0 directory sync [6]. Minimal, deploy-per-tenant-shaped. |
| Multi-tenant SaaS IdP   | Zitadel                        | Zitadel (~13.4k★ [5])                          | Zitadel Cloud/self-host          | Zitadel       | Not needed (deploy-per-tenant)                                | 2       | Built for Instance>Org>Project multi-tenancy [1] — value we structurally don't use; AGPL-3.0 since 2025 [1].                                                                   |
| Reverse-proxy SSO       | Authentik                      | **Authentik** (~20.7k★ [5])                    | Authentik                        | Authentik     | No (we control the app; proxy mode is for opaque apps)        | 2       | Proxy/forward-auth mode is its differentiator [1] — for apps that don't speak OIDC; ours does.                                                                                 |
| OAuth2/OIDC server only | Ory Hydra                      | Ory Hydra                                      | Ory Hydra                        | Ory Hydra     | No (no SAML, no directory)                                    | 2       | Certified OIDC but BYO user-store/SAML [1]; more assembly than Polis for our need.                                                                                             |
| Managed B2B SSO         | **WorkOS**                     | WorkOS (managed)                               | WorkOS                           | —             | No — cloud + per-connection pricing misfits deploy-per-tenant | 2       | Excellent DX, hides SCIM [1]; but not self-hostable and ~$125/conn [8] for a 1-org deployment.                                                                                 |

**Pick:** Keep Auth.js as the session/RBAC layer; add **Ory Polis (BoxyHQ Jackson) as a self-hosted SAML+OIDC+SCIM bridge container**, surfaced to Auth.js via its `boxyhq-saml`/OIDC provider. Keycloak stays a documented heavier alternative for shops that already run it.

---

## Capability 2 — SCIM 2.0 provisioning / de-provisioning (the big gap)

Today: zero. New SSO users get `VIEWER` and are promoted in-app (ADR-024) — no automatic de-provisioning, the exact SOC2/leaver-risk gap.

| Capability                           | Battle-tested pick             | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS                | Recommendation (our stack)                       | Fit 1-5 | Notes                                                                                                 |
| ------------------------------------ | ------------------------------ | --------------------------- | --------------------- | ---------------------------- | ------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------- |
| Self-host SCIM (with the SSO bridge) | **Ory Polis / BoxyHQ Jackson** | Keycloak (~26k★)            | Ory Polis             | **Ory Polis**                | **ADOPT-LATER (v1.1)** — same container as Cap 1 | 5       | Directory Sync via SCIM 2.0 for auto provision/de-provision [6]; one component covers SAML+OIDC+SCIM. |
| Self-host SCIM (full IdP)            | Keycloak 26.x                  | Keycloak                    | Keycloak 26           | Keycloak                     | Alternative if Keycloak already chosen           | 4       | Built-in SCIM 2.0 server in 26.x; Entra/Okta/Google can provision into it [2].                        |
| Buy SCIM                             | WorkOS / Stytch / Descope      | WorkOS                      | WorkOS                | —                            | No — per-connection SaaS misfit [8]              | 2       | WorkOS SCIM = separate $125/conn on Growth Plus [8][1]; Stytch/Descope per-connection [2].            |
| Build SCIM endpoint                  | —                              | —                           | —                     | roll-your-own `/api/scim/v2` | Reject for v1 (build cost, edge cases)           | 2       | SCIM's filter/patch semantics are a swamp; adopt the bridge instead (build-vs-buy: ADOPT).            |

**Pick:** SCIM rides the **same bridge container** chosen in Cap 1 — no second vendor. It is **v1.1, not v1**: SAML-SSO gets someone in the door; SCIM (auto de-provisioning) is the fast-follow that closes the leaver gap for SOC2.

---

## Capability 3 — Fine-grained authZ (ABAC/ReBAC beyond the 3-role enum)

Today: a 3-value `Role` enum + `withAuth/withAdminAuth/withEditorAuth` wrappers. Enterprise wants attribute/relationship rules (owner-of, department-scoped, field-level) without exploding the enum.

| Capability                             | Battle-tested pick    | Highest-star / most-popular | Enterprise-grade pick | Best pure-OSS                     | Recommendation (our stack)                            | Fit 1-5 | Notes                                                                                                                                                                                             |
| -------------------------------------- | --------------------- | --------------------------- | --------------------- | --------------------------------- | ----------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy-as-code ABAC/RBAC (sidecar)     | **Cerbos**            | Casbin (~20k★ [4])          | Cerbos (open-core)    | **Cerbos** (~4.3k★, Apr-2026 [4]) | **ADOPT-v1** — YAML policies, TS SDK, own container   | **5**   | Decouples authZ from app; policies in YAML evaluated via lightweight PDP service or SDK [3]; RBAC+ABAC, decision tracing/unit tests. Stateless sidecar fits deploy-per-tenant + Docker perfectly. |
| Embedded library (no extra service)    | Casbin (Apache)       | **Casbin** (~20k★ [4])      | Casbin                | Casbin                            | KEEP-AS-OPTION — zero-infra fallback                  | 4       | In-process RBAC/ABAC/ReBAC, official Node/TS support [3][4]. No sidecar, but policy logic lives in-app (less clean separation than Cerbos).                                                       |
| ReBAC / Zanzibar (relationship graphs) | **SpiceDB** (Authzed) | OpenFGA (~6.5k★ [4])        | SpiceDB (~5.7k★)      | **OpenFGA** (CNCF)                | ADOPT-LATER — only if true relationship graphs appear | 3       | Zanzibar-faithful, Watch API, strong consistency [3]; but needs its own datastore + relationship-tuple modeling — heavy for per-deployment RBAC/ABAC.                                             |
| Managed authZ                          | Permit.io / Oso Cloud | Permit.io                   | Permit.io             | —                                 | Reject — SaaS misfits self-host default               | 2       | Oso moved to Oso Cloud (managed) [3]; Permit.io is managed multi-tenant [3]. Note 2026 OPA/Styra disruption (Apple acqui-hire) pushing teams to Cerbos/Cedar [3].                                 |

**Pick:** **Cerbos** as a self-hosted PDP sidecar — best TS-native + self-hostable + clean policy separation, and it maps onto the existing `with*Auth` wrapper seam (wrapper calls Cerbos `check`). Casbin is the documented zero-extra-container fallback. Reserve SpiceDB/OpenFGA for a fork that genuinely needs relationship graphs.

---

## Capability 4 — Column-/field-level encryption at rest (Restricted data)

Today: `SCRUB_FIELDS` redacts Restricted fields **in the audit log**, but the base rows are plaintext. The repo already has the perfect seam — the Prisma **audit/soft-delete extension pattern** — to add transparent field encryption.

| Capability                                       | Battle-tested pick                   | Highest-star / most-popular | Enterprise-grade pick           | Best pure-OSS            | Recommendation (our stack)                         | Fit 1-5 | Notes                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------ | --------------------------- | ------------------------------- | ------------------------ | -------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App-layer envelope encryption (Prisma extension) | **AES-256-GCM + envelope (KEK/DEK)** | —                           | Node `crypto` + KMS-wrapped DEK | roll-in-`lib/prisma/`    | **ADOPT-v1** — mirror the audit extension          | **5**   | Encrypt before it hits Postgres; keys outside the DB; plaintext never on the server [PG docs 9]. A `crypto-extension.ts` beside `audit-extension.ts` is the natural home; DEK wrapped by KEK from the secrets manager (Cap 5).  |
| DB-native                                        | pgcrypto                             | pgcrypto (ships w/ PG)      | —                               | pgcrypto                 | **REJECT** for Restricted                          | 2       | Keys + plaintext both live on the DB server during decrypt — interceptable by anyone with server access [9][PG docs]. OK only for low-sensitivity.                                                                              |
| Searchable field encryption                      | **CipherStash Protect (Prisma)**     | CipherStash                 | CipherStash Stack               | CipherStash `protect.js` | **ADOPT-LATER** — if you must query ciphertext     | 4       | Searchable + keys-out-of-DB + plaintext-never-on-server at once [CipherStash]; equality/range/free-text over ciphertext, with Prisma support [4-search]. Extra infra; adopt only when encrypted fields must be filtered/sorted. |
| Full-disk / TDE                                  | Postgres TDE / LUKS volume           | —                           | managed TDE                     | LUKS                     | KEEP-AS-OPTION (defense-in-depth, not field-level) | 3       | Protects stolen disks, not a compromised app/DB session; complementary to app-layer, not a substitute.                                                                                                                          |

**Pick:** **App-layer AES-256-GCM envelope encryption as a Prisma extension** (`lib/prisma/crypto-extension.ts`), keyed by a KEK from the secrets manager, transparently encrypting a declared Restricted field-set — the same declarative pattern as `SCRUB_FIELDS`. CipherStash is the escape hatch when a Restricted field must remain queryable.

---

## Capability 5 — Secrets management at runtime

Pivot inverts to dockerized/self-hosted, so secrets move from the Vercel dashboard to orchestrator/runtime secrets. Compose-now, k8s-ready (decision #3) rules out k8s-only tools for v1.

| Capability                 | Battle-tested pick  | Highest-star / most-popular | Enterprise-grade pick                 | Best pure-OSS   | Recommendation (our stack)                  | Fit 1-5 | Notes                                                                                                                                                                       |
| -------------------------- | ------------------- | --------------------------- | ------------------------------------- | --------------- | ------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-hosted secrets server | **HashiCorp Vault** | Vault                       | Vault (dynamic secrets, PKI, KMS)     | Vault (pre-BSL) | KEEP-AS-OPTION — heavy; license caveat      | 3       | Gold standard (dynamic secrets, encryption-as-a-service) [10] but operationally demanding, and **BSL since 2023** reshapes self-host build-vs-buy [10].                     |
| Modern OSS secrets manager | **Infisical**       | Infisical                   | Infisical (self-host, rotation, SDKs) | **Infisical**   | **ADOPT-v1** — self-hostable, OSS, best DX  | **5**   | Self-host or cloud, native CI/CD + SDK integration, automatic rotation, OSS license [10]. Fits a dockerized enterprise default better than Vault's weight.                  |
| GitOps encrypted-in-repo   | **SOPS + age**      | SOPS                        | SOPS + age/KMS                        | **SOPS + age**  | **ADOPT-v1 (baseline floor)** — zero-server | **5**   | Encrypt `.env`/YAML in the repo; age = lightweight modern backend [10]. No server to run; perfect minimum for a single dockerized deployment. Pairs with the KEK for Cap 4. |
| k8s-native                 | sealed-secrets      | sealed-secrets              | sealed-secrets                        | sealed-secrets  | ADOPT-LATER — only when k8s lands           | 2       | Kubernetes-only; irrelevant to the compose-first v1 (decision #3).                                                                                                          |
| Cloud-only                 | Doppler             | Doppler                     | Doppler                               | —               | REJECT — no self-host/air-gap [10]          | 1       | Best onboarding but cloud-only [10] — violates self-host default.                                                                                                           |

**Pick:** **SOPS+age as the always-on baseline** (encrypted secrets in the repo, no server), with **Infisical as the ADOPT-v1 upgrade** when a deployment needs central rotation/audit/dynamic secrets. Vault stays the documented heavyweight option; the KEK for field encryption (Cap 4) is sourced from whichever is in play.

---

## Capability 6 — Audit retention + tamper-evidence + compliance export

Today: `auditExtension` logs every create/update/delete (outside EXCLUDE), `SCRUB_FIELDS` redacts Restricted values — but rows are **mutable** and there's no cryptographic integrity or SOC2-shaped export.

| Capability                   | Battle-tested pick                      | Highest-star / most-popular | Enterprise-grade pick                          | Best pure-OSS                | Recommendation (our stack)                         | Fit 1-5 | Notes                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------- | --------------------------- | ---------------------------------------------- | ---------------------------- | -------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tamper-evidence (hash chain) | **HMAC-SHA256 hash chain**              | —                           | HMAC-SHA256 + canonical schema + advisory lock | roll-in-`audit-extension.ts` | **ADOPT-v1** — extend the existing audit extension | **5**   | Each record hashes its data + the prior record's hash; any edit breaks the chain forward [DEV/Tracehold 11][12]. Add `prevHash`/`hash` columns + a `verifyChain()`; HMAC key from the secrets manager. |
| Append-only enforcement      | Postgres RLS/trigger deny UPDATE/DELETE | —                           | RLS + revoke UPDATE/DELETE on audit table      | trigger guard                | **ADOPT-v1** — cheap, high-assurance               | 5       | Enforce insert-only at storage layer; append-only alone isn't tamper-evident, so pair with the hash chain [12].                                                                                        |
| DB-level audit               | **pgAudit**                             | pgAudit                     | pgAudit                                        | pgAudit                      | KEEP-AS-OPTION — complementary, not core           | 3       | Structured session/object logs for SIEM; "essential for SOC 2 Type II" [pgAudit 13]. Belongs to DB ops, complements the app-level trail.                                                               |
| Compliance export            | build `/api/audit/export` (signed)      | —                           | SOC2/ISO evidence package + chain proof        | roll-your-own                | **ADOPT-LATER (v1.1)**                             | 4       | Export formatted for SOC2/ISO/GDPR evidence with chain-verification proof [11]. Small once the chain exists.                                                                                           |

**Pick:** Extend the **existing audit extension into a tamper-evident hash chain** (HMAC-SHA256 `prevHash`→`hash`) + storage-layer append-only, then a signed compliance export as the fast-follow. This is a build (mirrors an invariant the repo already owns), not a buy.

---

## Capability 7 — Data residency / PII posting posture (brief)

Deploy-per-tenant is itself the strongest residency story: each customer's data lives in **its own dockerized Postgres in its own deployment/region** — no shared control plane, no cross-tenant path (ADR-011 rationale [ADR-011]). Coordinate with the data-protection domain: PII handling reduces to (a) field encryption for Restricted columns (Cap 4), (b) `SCRUB_FIELDS` for logs/audit (existing), (c) export column allow-lists (existing `no-restricted-export-column` rule), (d) retention/purge (existing daily audit-purge cron, ADR-018). Residency = "pick the region you deploy the container in." No in-app work beyond Caps 4/6.

---

## Seed-list verdicts

| Seed item                               | Verdict                                                          | Rationale                                                                                                                                                                                  | ADR impact                                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SSO/SAML/OIDC (default)**             | **ADOPT-v1**                                                     | Floor must rise beyond opt-in single-provider. Keep Auth.js; add self-hosted **Ory Polis/BoxyHQ** SAML→OIDC bridge (Auth.js has the `boxyhq-saml` provider [6][7]).                        | New ADR "Enterprise SSO floor (multi-IdP SAML+OIDC via self-hosted bridge)"; **supersedes/extends ADR-024** (Entra becomes one IdP among many, not the mechanism). |
| **SCIM provisioning**                   | **ADOPT-LATER (v1.1)**                                           | Rides the same bridge container as SSO [6]; auto de-provisioning closes the leaver/SOC2 gap. Not v1 only because SSO unblocks access first.                                                | Same ADR as SSO; add SCIM section + a `User` de-provisioning path (soft-delete on SCIM `active:false`).                                                            |
| **Entra ID (existing ADR-024)**         | **KEEP-AS-OPTION**                                               | Still valid as a concrete OIDC IdP; the bridge generalizes it to any SAML/OIDC IdP.                                                                                                        | ADR-024 **reframed** (not rejected): from "the SSO mechanism" to "one supported IdP."                                                                              |
| **Fine-grained RBAC/ABAC**              | **ADOPT-v1**                                                     | 3-role enum insufficient for enterprise. **Cerbos** sidecar (YAML policy, TS SDK, self-host) [3]; wire into the `with*Auth` seam.                                                          | New ADR "Fine-grained authZ via Cerbos PDP"; build-vs-buy ledger entry (Cerbos vs OpenFGA/SpiceDB/Casbin).                                                         |
| **Column-level encryption**             | **ADOPT-v1**                                                     | Restricted rows are plaintext today. **App-layer AES-256-GCM envelope** as a Prisma extension mirroring `audit-extension.ts`; keys outside DB [9]. Reject pgcrypto (keys on server).       | New ADR "Field-level encryption for Restricted data"; extends the `SCRUB_FIELDS`/audit-extension invariant set.                                                    |
| **Secrets management**                  | **ADOPT-v1**                                                     | Dockerized runtime needs off-dashboard secrets. **SOPS+age baseline**, **Infisical** upgrade; Vault optional (BSL caveat); sealed-secrets = k8s-later; Doppler rejected (cloud-only) [10]. | New ADR "Runtime secrets management (SOPS+age baseline, Infisical option)"; supersedes the Vercel-dashboard assumption.                                            |
| **Audit retention + compliance export** | **ADOPT-v1 (chain) / ADOPT-LATER (export)**                      | Extend existing audit extension to a **HMAC-SHA256 hash chain + append-only**; signed SOC2 export as v1.1 [11][12].                                                                        | New ADR "Tamper-evident audit + compliance export"; extends `audit-extension.ts` + `audit-scrub.test.ts` contract.                                                 |
| **In-app multi-tenancy (row-level)**    | **REJECTED (operator decision — context, not a recommendation)** | Deploy-per-tenant; isolation stays at the deployment boundary. Separate DBs are _stronger_ than RLS [ADR-011]. Do NOT add a tenant-column/row-level Prisma extension.                      | **ADR-011 KEPT.** Recorded here so no downstream work reintroduces it.                                                                                             |

---

## Sequencing — enterprise-floor v1 vs later

**v1 (the enterprise identity/data floor — ship together):**

1. **SSO via self-hosted SAML/OIDC bridge** (Ory Polis/BoxyHQ) + Auth.js `boxyhq-saml`/OIDC provider — the headline gap.
2. **Cerbos authZ sidecar** wired into the `with*Auth` wrappers — ABAC beyond the enum.
3. **Field-level envelope encryption** Prisma extension for Restricted columns.
4. **Tamper-evident audit** (hash chain + append-only) — extends the existing extension.
5. **Secrets baseline: SOPS+age** (feeds the encryption KEK + all runtime secrets).

**v1.1 (fast-follow, closes SOC2 evidence loop):** 6. **SCIM de-provisioning** on the same bridge. 7. **Signed compliance export** (audit chain proof) + **Infisical** if central rotation/audit is needed.

**Later / conditional:**

- SpiceDB/OpenFGA (only if relationship-graph authZ appears); CipherStash (only if encrypted fields must be queried); Keycloak (only for shops already running it); sealed-secrets + pgAudit (when k8s / DB-ops maturity lands).

**Recommended v1 enterprise-identity floor (one line):** _Auth.js v5 + a self-hosted SAML/OIDC bridge (Ory Polis/BoxyHQ) for multi-IdP SSO, Cerbos as a self-hosted ABAC PDP behind the existing auth wrappers, an AES-256-GCM envelope-encryption Prisma extension for Restricted fields, a tamper-evident (HMAC-SHA256 hash-chain + append-only) audit trail, and SOPS+age secrets — all self-hostable containers, deploy-per-tenant, ADR-011 unchanged._

---

## Sources

[1] youngju.dev — "Keycloak vs Authentik vs Zitadel vs Ory Hydra vs Auth0 vs WorkOS vs Okta — 2026 Deep Dive" — https://www.youngju.dev/blog/culture/2026-05-16-keycloak-authentik-zitadel-ory-sso-oidc-saml-fapi-2026-deep-dive.en
[2] skycloak.io — "Keycloak vs WorkOS: B2B SSO Compared" / Keycloak 26 SCIM — https://skycloak.io/blog/keycloak-vs-workos-comparison/ ; guptadeepak.com CIAM SCIM guide — https://guptadeepak.com/ciam-compass/guides/scim-provisioning/
[3] osohq.com / sph.sh / pkgpulse.com — authZ engine comparisons (Cerbos, OpenFGA, SpiceDB, Casbin, Oso, Permit.io; OPA/Styra 2026 disruption) — https://sph.sh/en/posts/external-authorization-management-systems/ ; https://www.pkgpulse.com/guides/openfga-vs-permify-vs-spicedb-zanzibar-authorization-2026
[4] GitHub star counts (as of 2026): Casbin ~20k, Cerbos ~4.3k (Apr-2026), OpenFGA ~6.5k, SpiceDB ~5.7k — https://github.com/cerbos/cerbos ; https://github.com/openfga/openfga ; https://github.com/authzed/spicedb ; https://github.com/apache/casbin ; CipherStash+Prisma search-encryption — https://cipherstash.com/docs/stack/cipherstash/encryption/storing-data
[5] GitHub star counts (2026): Authentik ~20.7k, Zitadel ~13.4k, Keycloak (most-starred IAM, ~26k) — https://wz-it.com/en/blog/authentik-vs-zitadel-identity-provider-comparison/ ; https://blog.houseoffoss.com/post/keycloak-vs-authentik-vs-zitadel-2026-which-open-source-login-tool-should-you-use
[6] Auth.js / NextAuth BoxyHQ SAML provider + Ory Polis SCIM — https://authjs.dev/getting-started/providers/boxyhq-saml ; https://github.com/ory/polis
[7] next-auth.js.org — BoxyHQ SAML provider docs — https://next-auth.js.org/providers/boxyhq-saml
[8] WorkOS pricing — AuthKit free to 1M MAU; SSO/SCIM ~$125/connection/mo — https://workos.com/pricing ; https://guptadeepak.com/startup-offers/programs/workos-startups
[9] PostgreSQL 18 docs — Encryption Options / pgcrypto (server-side key exposure) — https://www.postgresql.org/docs/current/encryption-options.html ; https://www.postgresql.org/docs/current/pgcrypto.html ; CipherStash PostgreSQL security — https://cipherstash.com/blog/postgresql-security
[10] Secrets-management comparisons (Vault BSL, Infisical OSS self-host, SOPS+age, Doppler cloud-only, sealed-secrets k8s) — https://guptadeepak.com/top-5-secrets-management-tools-hashicorp-vault-aws-doppler-infisical-and-azure-key-vault-compared/ ; https://www.pkgpulse.com/guides/infisical-vs-doppler-vs-hashicorp-vault-secrets-2026 ; https://infisical.com/blog/hashicorp-vault-alternatives
[11] Tracehold — "Immutable audit log with HMAC hash chaining" — https://tracehold.ai/blog/immutable-audit-log-hmac-hash-chain/ ; DEV veritaschain — SHA-256 hash chains — https://dev.to/veritaschain/building-a-tamper-evident-audit-log-with-sha-256-hash-chains-zero-dependencies-h0b
[12] AppMaster — "Tamper-evident audit trails in PostgreSQL with hash chaining" (append-only + HMAC + advisory lock) — https://appmaster.io/blog/tamper-evident-audit-trails-postgresql
[13] jusdb.com — "pgAudit: PostgreSQL Audit Logging for SOC2/PCI-DSS/HIPAA" — https://www.jusdb.com/blog/pgaudit-postgresql-audit-logging-compliance
[ADR-011] docs/decisions/ADR-011-tenancy-by-deployment.md (repo) · [ADR-024] docs/decisions/ADR-024-sso-via-microsoft-entra-id.md (repo) · [pivot] docs/enterprise-pivot-analysis.md (repo)

_Star counts are point-in-time (2026) and drawn from the cited comparison articles and repo pages; treat as order-of-magnitude, not exact._
