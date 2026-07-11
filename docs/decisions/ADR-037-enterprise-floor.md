# ADR-037 — The enterprise floor (reframing the solo prototype rail)

**Status:** Accepted (enterprise pivot, operator-directed 2026-07-11)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —
**Reframes:** ADR-007 (solo operator on a free plan, CI-off, enforcement local-only → enterprise rail with hard blocking CI); ADR-011 (tenancy-by-deployment reaffirmed, now dockerized per tenant per ADR-035).
**Builds on:** ADR-025 (tiered enforcement gates).

## Context

ADR-007 optimized the template for a solo, non-developer operator on a free GitHub plan: the CI
workflows (`verify.yml`, `secrets-scan.yml`, `sast.yml`) sit **dormant** and do not run,
enforcement was re-homed into the local `/ship` gate, and branch protection is off because it
cannot be enforced without a paid plan. That posture is correct for the audience ADR-007
described — a lone operator iterating toward a shared preview URL — and it stays correct for
prototype and personal forks.

The enterprise pivot (source of truth: `docs/research/v2/enterprise-benchmark-v2.html`) changes
the audience the *template itself* targets. Enterprise customers do not accept a gate that lives
only on the operator's laptop and can be skipped; they require hard, **blocking** CI checks on
every change. They require **SSO + SCIM** for identity, not a single email/password login. And
they require a **least-privilege authorization seam** — a place where "can this actor do this
action on this resource" is decided — rather than role strings scattered inline across routes.

None of this invalidates ADR-007; it establishes a **floor an enterprise deployment must
exceed**. The 3-role model (ADR-024 identity, the `Role` enum) works and is not being rewritten.
The deploy-isolation tenancy model (ADR-011: one deployment = one tenant, now dockerized per
tenant under ADR-035) works and is not being rewritten. The pivot raises the default posture and
adds seams; it does not restructure the core.

## Decision drivers

- Enterprise buyers require **blocking CI** (not a local-only, skippable gate), **SSO/SCIM**
  identity, and a **least-privilege authZ** decision point.
- The **low-ceremony solo/personal tier must stay available** — prototype and personal forks
  still live on the ADR-007 rail and should not pay enterprise ceremony.
- **No rewrite** of the working 3-role model or the deploy-isolation tenancy model; the pivot is
  additive seams and an activated CI, not a re-architecture.

## Considered options

### Option 1 — Enterprise floor as a reframe, tiers retained (chosen)

Reframe the template so `enterprise` is the default posture for its stated audience, while the
lighter tiers remain first-class:

- **(a) Activate CI as a hard blocking gate.** Promote the dormant CI workflows from
  `workflow_dispatch`-only to real `push:`/`pull_request:` triggers that **block merge**; they
  mirror the local `/ship` checks (typecheck → lint → tests → build → secret scan → dependency
  audit) so nothing new is invented — CI just becomes the server-side authority the solo rail
  lacked. Add a **Prettier format gate**. ESLint stays authoritative for the 10 custom AST
  rules (`no-prisma-in-client`, `no-any-cast-on-session`, … `no-prisma-unfiltered-import`);
  Prettier owns formatting, ESLint owns the invariants. (CI security-gate specifics land in
  ADR-041.)
- **(b) An authorization policy seam.** Introduce `lib/authz/authorize(session, action,
  resource)` as the single decision point, plus a `no-inline-role-check` ESLint rule that denies
  ad-hoc `session.user.role === "ADMIN"` comparisons outside the seam. **KEEP the 3-role enum** —
  the behavior is unchanged today — but route every check through the seam so a future policy
  engine has exactly one integration point. Engine choice (Cerbos as the default, OpenFGA as the
  relationship/ABAC escape hatch) is **DEFERRED to P2**; the seam ships now, the engine later.
- **(c) Harden and generalize identity.** Add a "**maintenance-only upstream under Better
  Auth**" note plus an advisory watch on Auth.js; a **Better Auth migration is a tracked P1
  eval**, not a commitment. Generalize the Entra ID integration (ADR-024) to
  **one-OIDC-provider-per-deployment** so any enterprise IdP fits the per-tenant deployment.
  Enterprise **SSO + SCIM** is delivered via a dockerized **Ory Polis** sidecar (SAML→OIDC
  bridge + SCIM user provisioning), **P1**.
- **(d) Tiers retained.** The `personal` / `shared` tiers (ADR-025) stay exactly as they are;
  `enterprise` becomes the *default* posture for the template's stated audience, layered on top
  of them.

**Good:** no rewrite; incremental; each seam is a single, testable integration point; the solo
rail (ADR-007) survives intact for the forks that want it.
**Bad:** more ceremony for small forks — mitigated by the tier switch, which lets a personal fork
opt back down to the ADR-007 posture.

### Option 2 — Full multi-tenant RLS refactor

Re-architect the data layer for row-level security so one deployment serves many tenants.
**Bad — rejected:** ADR-011 deploy-isolation already gives per-tenant isolation for free (one
deployment, one database, one tenant), now dockerized per tenant under ADR-035. RLS is an
explicit, opt-in *per-fork departure* when a customer genuinely needs pooled multi-tenancy — it
is not the default and does not belong in the floor.

### Option 3 — Drop the solo tier

Make `enterprise` the only posture and delete the low-ceremony rail. **Bad — rejected:**
prototype and personal forks still use the solo rail every day, and ADR-007 remains valid *for
them*. The pivot raises the floor; it does not demolish the ground floor.

## Decision

Adopt **Option 1**. The deciding drivers are the three enterprise requirements — **blocking CI**,
an **authorization seam**, and **SSO/SCIM** identity — each of which can be satisfied **without a
rewrite** of the role model or the tenancy model. Activate the mirrored CI workflows as hard
blocking gates (plus a Prettier format gate), introduce `lib/authz/authorize()` with a
`no-inline-role-check` rule as the single authZ decision point (engine deferred to P2), and add
the Ory Polis SSO/SCIM sidecar with one-OIDC-provider-per-deployment (P1) while placing Auth.js on
a maintenance-only watch (Better Auth migration a tracked P1 eval). `enterprise` becomes the
default posture; `personal`/`shared` (ADR-025) remain available for lighter forks.

## Consequences

### Positive
- Enterprise-grade gates (blocking CI, SSO/SCIM, least-privilege authZ) are met without touching
  the working role model or tenancy model.
- Every authorization decision funnels through one seam, so a future policy engine (Cerbos/
  OpenFGA) is a single integration, not a repo-wide sweep.
- CI becomes the server-side authority the solo rail structurally could not provide; the local
  `/ship` gate and CI now agree because CI mirrors it.
- The solo/personal rail survives — the pivot is additive, so nothing regresses for prototype
  forks.

### Negative
- Small forks inherit more ceremony by default (blocking CI, format gate, the authZ seam).
- New moving parts to operate: the Ory Polis sidecar and the authZ seam add surface a personal
  fork does not need.
- Auth.js on maintenance-only watch is latent migration risk carried until the Better Auth eval
  resolves.

### Mitigations
- The tier switch (ADR-025) lets a genuinely personal fork opt down to the ADR-007 posture, so
  the ceremony is default-on but not mandatory.
- The authZ engine is DEFERRED (P2): only the seam + rule ship now, so the added surface is one
  function and one lint rule, not a runtime dependency.
- Ory Polis is a **dockerized sidecar** (ADR-035 per-tenant containers), so SSO/SCIM is opt-in
  per deployment and absent forks pay nothing.
- Auth.js risk is tracked as a P1 eval with an advisory watch, not left implicit.

## Alternatives considered
1. **Full multi-tenant RLS refactor** — rejected; ADR-011 deploy-isolation already isolates
   tenants, RLS is a per-fork departure, not a default.
2. **Drop the solo tier** — rejected; prototype/personal forks still run on it and ADR-007 stays
   valid for them.
3. **CI mirrors `/ship` but stays non-blocking** — rejected implicitly by the enterprise driver;
   a skippable gate is exactly what enterprise buyers reject.

## Migration triggers
- **Role strings scatter beyond the seam, or a customer needs ABAC/relationship-based access** —
  stand up the deferred authZ engine (Cerbos default, OpenFGA for relationship/ABAC), integrating
  at the single `lib/authz/authorize()` point (P2).
- **Auth.js security support ends** (maintenance-only upstream reaches EOL, or a CVE goes
  unpatched) — execute the tracked Better Auth migration (P1 eval → commitment).
- **A customer needs pooled multi-tenancy** (one deployment, many tenants) — adopt RLS as an
  explicit per-fork departure from deploy-isolation (ADR-011), not a default.

## Related
- ADR-007 — solo-rail optimization (the posture this reframes; still valid for prototype/personal forks).
- ADR-011 — tenancy-by-deployment (reaffirmed; per-tenant isolation without RLS).
- ADR-024 — Entra ID identity (generalized here to one-OIDC-provider-per-deployment).
- ADR-025 — tiered enforcement gates (`personal`/`shared` retained; `enterprise` layered on).
- ADR-035 — dockerized per-tenant deployment (the sidecar/tenant packaging).
- ADR-041 — CI security gates (the blocking-CI specifics referenced by driver (a)).
- `docs/research/v2/03-auth-identity.md` — auth/identity research (Auth.js watch, Better Auth eval, Ory Polis).
- `docs/research/v2/04-authz-policy.md` — authZ policy research (the seam, Cerbos/OpenFGA).
