# C04 — Authorization & policy-as-code

> Enterprise-benchmark v2, exhaustive 4-lens pass. Scored against the fixed stack
> (Next.js 16.2.9 RSC + Node-runtime middleware, Prisma 7.7 + Postgres 17,
> Auth.js v5 JWT sessions, 3-role enum, TypeScript 5, Docker-first, **deploy-per-tenant**).
> Lens tags: `BT`=battle-tested · `HS`=highest-star/popular · `ENT`=enterprise-grade · `OSS`=best pure open-source.
> **Scope note (binding pivot):** isolation is at the *deploy boundary* (one container/DB per tenant), so
> nothing here is about tenant/row isolation. This category is strictly **in-app permission granularity** —
> how a single tenant's users get finer-than-3-roles access to resources.

---

### Item 1 — Current role model (3-role enum + `withAuth/withAdminAuth/withEditorAuth`) — KEEP/extend or REPLACE?

**One line:** Today = a Postgres `Role` enum (`ADMIN|EDITOR|VIEWER`, `prisma/schema.prisma:12`) surfaced on the JWT (`session.user.role`, typed in `types/index.ts`) and enforced by four composable wrappers in `lib/api-helpers.ts` (`withAuth`, `withAdminAuth`, `withEditorAuth`, `withInternalAuth`/`withApiAuth` for machines) plus the `no-any-cast-on-session` ESLint rule. This is **coarse RBAC hardcoded at the route boundary**.

What it does well (keep): every route is auth-gated by construction; the wrapper composition is clean; role is on the session so no per-request DB read; audit attribution is wired through `withAuditContext`; `withRateLimit`-outside-auth ordering is lint-enforced. For a deploy-per-tenant enterprise tool this is a **correct, cheap floor**.

What breaks at enterprise scale (the gap): (a) permissions are **role-shaped, not resource-shaped** — there is no `can(user, "approve", thisInvoice)`; a route can only ask "is this user an EDITOR". (b) Role checks are **string literals scattered across handlers** (`ctx.session.user.role !== "ADMIN"`) — adding a 4th role or a "can only edit rows they own" rule means editing every route. (c) No **per-record / ownership / hierarchy / delegation** logic. (d) No **externalized, auditable policy** — the rules live in imperative TS, invisible to compliance review.

| # | Option | Lens tag(s) | Effort | One-line why-it-ranks |
|---|--------|-------------|--------|-----------------------|
| 1 | **KEEP the enum + wrappers as the floor** | BT | 0 | Correct, cheap, already lint-enforced; every route gated by construction. |
| 2 | **Add a `permissions` abstraction seam** (`authorize(session, action, resource)`) | BT/ENT | S | Routes ask for an *action on a resource*, not a role string; enum becomes one input. Forward-compatible with any engine below. |
| 3 | Expand enum to N roles | — | S | Buys time but same architectural dead-end (more string checks). |
| 4 | Replace enum wholesale with a ReBAC/ABAC engine | ENT | L | Premature for v1; see Item 2. |

**Recommendation:** **KEEP+HARDEN.** Do **not** replace the enum. Instead evolve the wrappers behind a single **policy seam** — one `authorize(session, action, resource): Decision` function (start as a pure-TS permission map keyed by `role × action × resourceType`, with an ownership predicate hook). Route handlers call `authorize(...)` instead of comparing role strings; `withEditorAuth` et al. stay as thin coarse pre-filters. This (i) removes scattered string checks (a `no-inline-role-check` lint rule can enforce it), (ii) gives one place to later delegate to Cerbos/Cedar without touching routes, and (iii) makes the policy *readable in one file* for compliance. **Fit 5/5** (pure additive TS, no new dep, no runtime). **ADR impact:** new ADR "authorization architecture — policy seam over the role enum"; touches `lib/api-helpers.ts` + a new `lib/authz/` (Ask-before surface).

---

### Item 2 — Fine-grained ReBAC/ABAC engine (NET-NEW — none today)

**One line:** NET-NEW. The candidate field for externalized fine-grained authZ, scored for **TS-native fit · self-hostable · Prisma/Next-16 fit · latency · deploy-per-tenant (single-container) fit.**

| # | Candidate | Lens tag(s) | Stars (as-of) | License | Maturity / first release | One-line why-it-ranks |
|---|-----------|-------------|---------------|---------|--------------------------|-----------------------|
| 1 | **Cerbos** (PDP) | OSS/ENT | ~4.5k (Jul 9 2026) [1] | Apache-2.0 (open core) | GA; 2021 | Stateless YAML/git-ops PDP, **sub-1ms**, RBAC+ABAC in one model, 8 SDKs incl. **JS/TS**, embeddable / Lambda / air-gapped — no new datastore. |
| 2 | **OpenFGA** | HS/OSS/ENT | ~6.5k (2026) [2] | Apache-2.0 | GA; **CNCF Incubating (Oct 2025)** [2] | Zanzibar ReBAC from Auth0/Okta; stateless engine + its own store; official TS SDK; easiest ReBAC onramp; the safe standards bet. |
| 3 | **SpiceDB** (AuthZed) | BT/OSS/ENT | ~6.7k (2026) [3] | Apache-2.0 | GA; 2021 | Most Zanzibar-faithful; ZedTokens fix the "new-enemy" cache race; per-request consistency; used at Netflix/RedHat scale. Needs its own datastore. |
| 4 | **Apache Casbin** | HS/BT/OSS | ~20k Go core / ~2.9k node-casbin (2026) [4] | Apache-2.0 | Mature; 2017; Apache project | In-process library (no service), ACL/RBAC/ABAC via model+policy files, **node-casbin** is native TS. Lowest ops, oldest model DSL. |
| 5 | **AWS Cedar** (+ engine) | ENT/OSS | ~2.6k (2026) [5] | Apache-2.0 | GA; 2023 | Formally-verified, **analyzable** policy lang; **wasm → runs in-process in Node/TS**; ABAC+RBAC+ReBAC-lite. See also Item 3. |
| 6 | **Permit.io** (+ OPAL) | ENT | OPAL ~5k (2026) [6] | commercial + OPAL Apache-2.0 | GA; 2022 | Managed control-plane over OPA/OpenFGA/Cedar; OPAL (open) syncs policy+data to sidecars. SaaS-leaning; good UI. |
| 7 | **Ory Keto** | OSS | ~5.4k (2026) [7] | Apache-2.0 | GA; 2018 (first OSS Zanzibar) | Zanzibar ACL/RBAC server, Go, headless/API-first; part of the Ory suite; smaller ecosystem than OpenFGA/SpiceDB. |
| 8 | **Topaz** (Aserto) | OSS | ~1.3k (May 2026) [8] | Apache-2.0 | GA; 2022 | Combines OPA (Rego) decisions + a Zanzibar directory; sidecar/edge; niche, small community. |
| 9 | **WorkOS FGA** (ex-Warrant) | ENT | OSS repo stale [9] | commercial (OSS abandoned) | acquired by **WorkOS Apr 2024** [9] | Managed Zanzibar FGA; solid if already buying WorkOS SSO. **Current-events catch:** the open-source Warrant is effectively EOL. |
| 10 | **Oso** (Polar) | — | OSS **deprecated** [10] | Apache-2.0 (deprecated) | 2020; OSS lib deprecated | **Current-events catch:** the embeddable open-source Oso/Polar library is **officially deprecated** — the company redirects to managed **Oso Cloud**. Do not adopt the OSS lib for new work. |

**Head-to-head (the real trade-offs):**
- **Cerbos vs OpenFGA/SpiceDB — the axis that matters for us.** OpenFGA and SpiceDB are **relationship databases**: you store tuples (`doc:1#viewer@user:9`) in *their* store and query a graph. That is the right tool for Google-Docs-style sharing, org hierarchies, nested groups — but it introduces a **second stateful service to run, back up, and keep consistent with Postgres**, which fights our deploy-per-tenant "one container + one Postgres" simplicity. **Cerbos is a stateless decision point**: policies are YAML in git, the PDP holds *no data*, it evaluates `principal × action × resource+attributes` in <1ms and can run **embedded / as a Lambda / as a compose sidecar** — no new datastore, trivially air-gapped. For a template whose fine-grained needs are mostly **role + ownership + attribute** ("editors can edit rows they own, in status=draft"), Cerbos covers 90% of cases with the least ops.
- **When you genuinely need ReBAC**, OpenFGA is the standards-safe pick (CNCF, TS SDK, largest community, Auth0 lineage) and SpiceDB the correctness-purist pick (ZedTokens/consistency). Prefer **OpenFGA** as our documented ReBAC escape hatch.
- **Casbin** is the zero-service option (in-process TS lib) but its model/policy-file DSL is dated and awkward next to Cerbos YAML or Cedar; good for simple embedded ABAC, weak for relationships.
- **Cedar** is the dark-horse: **wasm means it runs in-process in our Node runtime** (no sidecar, fits single-container), it's Apache-2.0, and it's the only candidate that's *formally verified and statically analyzable* (you can prove "no policy grants delete to VIEWER"). Weaker turnkey ReBAC tuple-storage story than OpenFGA, smaller ecosystem than Cerbos.
- **Permit.io / WorkOS FGA / Oso Cloud** are managed control-planes — they trade self-hosting for a UI and a SaaS bill; they cut against "self-hosted, Docker-first, air-gap-capable."

**Recommendation:** **DEFER a standing ReBAC engine from v1; ADD-AS-OPTION Cerbos (default) + OpenFGA (relationship-graph escape hatch) as `/scale-up` recipes behind the Item-1 policy seam.** The perfect enterprise repo does **not** ship OpenFGA/SpiceDB in the base image — a second stateful service for authZ is over-engineering for the median internal tool and contradicts deploy-per-tenant minimalism. It ships the **seam** (Item 1) so that adopting Cerbos later is a config change, not a refactor. Default fine-grained engine = **Cerbos** (stateless, no datastore, YAML/git-ops → aligns with our gate-hook philosophy, sub-ms, Apache-2.0, embeddable). Reserve **OpenFGA** for forks with true relationship graphs. **Fit:** Cerbos 4/5 (adds a sidecar/embedded lib, but no datastore); OpenFGA 3/5 (adds a stateful service). **ADR impact:** two `/scale-up` recipe entries + a build-vs-buy-ledger line; the *engine* is opt-in, the *seam* is core.

---

### Item 3 — Policy-as-code for CI / infra governance (NET-NEW — none today)

**One line:** NET-NEW. Distinct from Item 2's *request-time app authZ*: this is **build/CI/infra-time governance** — could our existing PreToolUse gate hooks (`build-vs-buy-gate.mjs`, `blueprint-gate.mjs`, `complexity` in `/ship`) be expressed as declarative policy, and do we need Kubernetes admission control?

| # | Candidate | Lens tag(s) | Stars (as-of) | License | Maturity / status | One-line why-it-ranks |
|---|-----------|-------------|---------------|---------|-------------------|-----------------------|
| 1 | **Open Policy Agent (OPA/Rego)** | BT/HS/ENT | ~10k (2026, approx) [11] | Apache-2.0 | **CNCF Graduated** | The de-facto general policy engine; Rego evaluates *any* JSON (configs, API input, CI). Overkill for a Node template unless you standardize on Rego. |
| 2 | **Conftest** | OSS/BT | (OPA org) [12] | Apache-2.0 | GA (OPA project) | Single-binary CLI: runs Rego against Terraform/Helm/k8s/Dockerfile/JSON **in CI in a few YAML lines** — the pragmatic slice of OPA for a repo gate. |
| 3 | **AWS Cedar** | ENT/OSS | ~2.6k (2026) [5] | Apache-2.0 | GA; 2023 | Doubles as CI-time policy (analyzable, wasm), but ecosystem is app-authZ-first, not config-linting. See Item 2. |
| 4 | **Kyverno** | HS/ENT | ~9k (2026) [13] | Apache-2.0 | **CNCF Graduated (Mar 2026)** [13] | YAML-native Kubernetes admission control (no Rego). **Only relevant once we run k8s** — the pivot says *no k8s in v1*. |

**Head-to-head:**
- **Kyverno vs OPA/Gatekeeper** is a **Kubernetes admission-control** decision. Our binding pivot is **compose-now, k8s-ready-later — no k8s in v1** → **both are out of scope for v1.** Note only for the k8s-ready roadmap: when we do adopt k8s, **Kyverno** (YAML, graduated Mar 2026, no Rego to learn) is the lower-friction default for a team that isn't already invested in Rego.
- **OPA/Rego vs Conftest** for *our* CI: OPA-the-server is a daemon we don't want; **Conftest** is the right shape — a CLI that lints structured files in `/ship`. But it introduces **Rego** (a second policy language) to a repo whose governance is already expressed as **Node `.mjs` PreToolUse hooks + ESLint rules**, which are TS-native, already wired, and can call the Prisma/AST context Rego can't easily reach.
- **Cedar** overlaps Item 2; adopting it for app-authZ *and* CI would consolidate on one policy language, but that's a bigger bet than v1 warrants.

**Recommendation:** **DEFER / KEEP-as-is.** The perfect enterprise repo's **CI/infra governance stays in the existing Node hook + ESLint mechanism** — it is already the enforcement layer (`build-vs-buy-gate`, `blueprint-gate`, `no-*` security rules, the `complexity` gate) and is TS-native with full repo context; bolting Rego/Conftest on top adds a language and a binary for governance we already express better in-house. **Adopt Conftest only if/when we start shipping Terraform/Helm/k8s manifests** (there's nothing structured for it to lint today). **Kyverno is explicitly deferred to the post-v1 k8s track** per the pivot. **Fit:** Conftest 2/5 today (nothing to lint, adds Rego), 4/5 once IaC exists; Kyverno N/A in v1. **ADR impact:** none for v1; a note in the k8s-readiness ADR that Kyverno is the presumptive admission controller and Conftest the presumptive IaC gate.

---

## Category verdict table

| Item | Current | Recommendation | Net-new deps to add | ADR impact | Priority |
|------|---------|----------------|---------------------|------------|----------|
| Role model (enum + wrappers) | 3-role enum + 4 wrappers, string checks in routes | **KEEP+HARDEN** — add `lib/authz/` policy seam `authorize(session, action, resource)`; enforce with a `no-inline-role-check` lint rule | none (pure TS) | New ADR: authorization architecture / policy seam | **P0** |
| Fine-grained ReBAC/ABAC engine | none | **DEFER from base; ADD-AS-OPTION** — Cerbos (default, stateless PDP) + OpenFGA (ReBAC escape hatch) as `/scale-up` recipes behind the seam | Cerbos or OpenFGA (opt-in only) | Two `/scale-up` recipe ADRs + build-vs-buy-ledger | **P1** |
| Policy-as-code (CI/infra) | Node `.mjs` hooks + ESLint rules | **KEEP-as-is / DEFER** — governance stays in hooks+ESLint; Conftest only when IaC appears; Kyverno only on the k8s track | none in v1 | Note in k8s-readiness ADR | **P2** |

## Recommended v1 authZ approach — does the perfect enterprise repo ship ReBAC in v1?

**No — it ships the *seam*, not the *engine*.** The v1 enterprise authZ posture is:

1. **KEEP** the 3-role enum + auth wrappers as the always-on floor (every route gated by construction).
2. **ADD (P0)** a thin `lib/authz/` **policy seam** — `authorize(session, action, resource)` returning an explicit allow/deny, starting as a pure-TS permission map with an ownership predicate. This kills scattered role-string checks, gives compliance one readable policy file, and is the single integration point for any future engine.
3. **DEFER** OpenFGA/SpiceDB/Cerbos to opt-in `/scale-up` recipes. Standing up a second stateful authZ service in the base image is over-engineering for the median deploy-per-tenant internal tool and cuts against the Docker-first/air-gap-capable pivot. **Default engine when a fork outgrows the seam = Cerbos** (stateless, no datastore, YAML/git-ops, sub-ms, embeddable); **OpenFGA** only for genuine relationship graphs.
4. **KEEP** CI/infra governance in the existing Node-hook + ESLint mechanism; no Rego/Conftest/Kyverno in v1.

This is deliberately the *least* infrastructure that reaches "enterprise-grade fine-grained": the expensive part (relationship engines) is deferred behind a cheap abstraction the base repo ships on day one.

---

## Sources
1. Cerbos — GitHub `cerbos/cerbos` (~4,488 stars, Jul 9 2026); Help Net Security 2025-05; appsecsanta Cerbos review 2026. https://github.com/cerbos/cerbos
2. OpenFGA — GitHub `openfga/openfga` (~6.5k, 2026); CNCF "OpenFGA Becomes a CNCF Incubating Project" 2025-11-11. https://github.com/openfga/openfga · https://www.cncf.io/blog/2025/11/11/openfga-becomes-a-cncf-incubating-project/
3. SpiceDB — GitHub `authzed/spicedb` (~6.7k, 2026). https://github.com/authzed/spicedb
4. Apache Casbin — GitHub `apache/casbin` (~20k) / `casbin/node-casbin` (~2.9k), 2026. https://github.com/apache/casbin · https://github.com/casbin/node-casbin
5. Cedar — GitHub `cedar-policy/cedar` (~2,603, 2026); cedar-wasm bindings; StrongDM Cedar 2026 guide; AWS Verified Permissions docs. https://github.com/cedar-policy/cedar
6. Permit.io / OPAL — permit.io; GitHub `permitio` (OPAL ~5k). https://www.permit.io/ · https://github.com/permitio
7. Ory Keto — GitHub `ory/keto` (~5.4k, 2026). https://github.com/ory/keto
8. Topaz (Aserto) — GitHub `aserto-dev/topaz` (~1.3k, v0.33.14 May 13 2026). https://github.com/aserto-dev/topaz
9. Warrant → WorkOS FGA — "WorkOS acquires Warrant" 2024-04-23; warrant.dev redirect. https://workos.com/blog/workos-acquires-warrant
10. Oso — GitHub `osohq/oso` ("Deprecated: See README"); osohq.com (redirect to Oso Cloud). https://github.com/osohq/oso
11. Open Policy Agent — CNCF Graduated; "Apple Acquires OPA Team from Styra" (acqui-hire, Aug 2025; CNCF retains project) — Cloud Native Now / Open Source For You 2025. https://www.openpolicyagent.org/ · https://cloudnativenow.com/features/apple-buys-styra-brains-opa-remains-open/
12. Conftest — part of the OPA project; single-binary Rego CLI for CI. https://www.conftest.dev/
13. Kyverno — GitHub `kyverno/kyverno` (~9k, 2026); "CNCF Announces Kyverno's Graduation" 2026-03-16/24. https://www.cncf.io/announcements/2026/03/24/cloud-native-computing-foundation-announces-kyvernos-graduation/
