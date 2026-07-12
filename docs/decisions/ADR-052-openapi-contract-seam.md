# ADR-052 — OpenAPI contract seam for `/api/v1` (zod-openapi → Scalar → Schemathesis)

**Status:** Accepted (2026-07-12, Tariq Al-Naaimi)
**Date:** 2026-07-11
**Decision owner:** Tariq Al-Naaimi
**Reviewers:** —

## Context

The template is REST + zod: every API route validates its input at the boundary
with a schema under `lib/validations/` (the Secure pillar's zod-at-every-boundary
rule), and ADR-013 carved out a stable, versioned **`/api/v1/*`** seam for machine
consumers (Bearer-auth via `withApiAuth`). Between those two facts sits a gap the
v2 enterprise sweep flagged (`docs/research/v2/20-remaining-sweep.md` §7a, "OpenAPI

- API contract testing"): **there is no machine-readable contract for the seam and
  no test that the running API still matches it.**

Today a machine consumer integrating against `/api/v1` has to:

- read TypeScript route handlers (or the `lib/validations/` zod files) by hand to
  learn request/response shapes — there is no spec to code-generate a client from;
- discover error shapes and status codes empirically;
- trust that the deployed API still behaves as documented, with nothing catching
  **contract drift** when a route's zod schema changes but a consumer's expectation
  (or the published docs) doesn't.

The enterprise pivot (deploy-per-tenant, "gates not vibes") wants the same
governance-by-artifact posture applied to the API surface: a machine-readable
contract, rendered human docs, and an automated drift check. The sweep's verdict
was explicit — because we already write zod at every boundary, an OpenAPI spec is
available for **near-zero incremental cost**, making this the highest-ROI item in
the remaining sweep (P1).

## Decision drivers

- **Zero schema duplication.** We already author zod at every route boundary; the
  contract must be _generated from those schemas_, never a second hand-maintained
  artifact that drifts from the code.
- **Self-hostable, license-clean, on-rail.** Deploy-per-tenant + redistribution to
  tenants rules out SaaS docs (Mintlify/GitBook) and copyleft snags; MIT/Apache,
  Next-mountable tools only.
- **Drift must be caught automatically, not by review.** A contract nobody tests is
  documentation, not a gate. CI should fail when the running API diverges from its
  own spec.
- **Thin, additive, dormant-friendly.** The seam must be a thin generation layer
  over existing zod, add no runtime cost to non-consumers, and not touch the
  Ask-before auth/validation surface.

## Considered options

### Option 1 — zod-openapi (chosen) + Scalar + Schemathesis

Generate an OpenAPI 3.1 document from the existing zod schemas with
**`zod-openapi`** (register each `lib/validations/` schema, emit the spec at
`GET /api/openapi`); render it with **Scalar** (a self-hosted, MIT API-reference
UI) at an in-app docs page; fuzz the deployed API against its own spec with
**Schemathesis** as a CI contract-drift check.

- Good, because the spec is _generated from the zod we already write_ — one source
  of truth, no duplicated schema, satisfies the zero-duplication driver directly.
- Good, because `zod-openapi` (samchungy, v6, MIT) targets OpenAPI **3.1**, the
  version that aligns with JSON-Schema/zod semantics, so the generated spec is
  faithful rather than lossy.
- Good, because all three tools are MIT and self-hostable — Scalar mounts inside the
  existing Next app (one build, one Docker image, no second toolchain), and
  Schemathesis runs as a CI container against a preview URL.
- Good, because Schemathesis is _property-based_: it derives thousands of cases from
  the spec and finds contract drift (undeclared 500s, schema-violating responses)
  automatically — the "drift caught by CI, not review" driver.
- Good, because it is dormant-friendly: the generation layer lives under
  `lib/openapi/**` and the CI job is opt-in, so a fork that never exposes `/api/v1`
  pays nothing.
- Bad, because `zod-openapi` requires each schema to carry OpenAPI metadata
  (`.meta()`/registration) to produce a _rich_ spec — a small per-schema annotation
  cost (mitigated: unannotated schemas still emit a valid, if terse, spec).

### Option 2 — @asteasolutions/zod-to-openapi + Scalar + Schemathesis

Same architecture, but use the other mature zod→OpenAPI generator.

- Good, because it is also MIT, mature (~2k stars), and battle-tested.
- Bad, because it leans on a registry object you thread through call sites, a
  slightly heavier integration than `zod-openapi`'s per-schema `.meta()` for our
  file-per-entity `lib/validations/` layout.
- Bad, because its OpenAPI 3.1 story has historically trailed `zod-openapi`'s 3.1
  focus — and 3.1 is the version that matches zod/JSON-Schema semantics, a driver
  concern for spec fidelity. (Kept as the drop-in fallback if `zod-openapi`
  stalls — same architecture, one dependency swap.)

### Option 3 — Hand-written OpenAPI spec

Author and maintain `openapi.yaml` by hand alongside the routes.

- Good, because it is dependency-free and gives total control over the document.
- Bad, because it **duplicates every schema** — the exact drift-prone second source
  of truth the zero-duplication driver forbids; the hand-spec and the zod boundary
  will diverge the first time a route changes and the YAML doesn't.
- Bad, because it puts the maintenance burden on the operator with no gate ensuring
  the spec matches reality — it rots by default.

### Option 4 — tRPC

Replace the REST + zod seam with end-to-end typesafe RPC.

- Good, because it gives compile-time-typed client/server calls with zod inference
  and no manual spec at all — excellent DX for a TypeScript-to-TypeScript consumer.
- Bad, because it **abandons the language-agnostic REST contract** ADR-013's
  `/api/v1` seam exists to provide — a non-TypeScript machine consumer (partner
  integration, another service) cannot code-gen a client from tRPC's wire format.
- Bad, because it is a stack change to the locked REST + zod boundary (ADR-001/012),
  requiring a superseding stack ADR — far more blast radius than a generation layer.
- Bad, because it does not produce an OpenAPI document, so it fails the "publish a
  machine-readable contract" outcome entirely rather than achieving it differently.

## Decision

Adopt **Option 1**: `zod-openapi` generates an **OpenAPI 3.1** document from the
zod schemas already written under `lib/validations/`, served at
`GET /api/openapi`; **Scalar** renders it as an interactive API reference page in
the app; and **Schemathesis** runs as a (dormant-until-enabled) CI job that fuzzes
the deployed API against that spec to catch contract drift.

The zero-duplication driver is decisive: because every route already validates with
zod, the contract is _derived from code that must exist anyway_, so the spec cannot
silently diverge from the boundary the way a hand-written spec (Option 3) would, and
we keep the language-agnostic REST contract that tRPC (Option 4) would discard. This
gives ADR-013's `/api/v1` seam a real, testable, machine-readable contract at
near-zero incremental cost — the highest-ROI item in the remaining sweep.

The layer is thin and additive: a `lib/openapi/` registry + document builder, two
routes (`/api/openapi`, the docs page), and one CI job. It touches no auth wrapper
and no validation semantics — it _reads_ the existing zod schemas, it does not
change them.

## Consequences

### Positive

- The `/api/v1` seam gains a machine-readable OpenAPI 3.1 contract that consumers
  code-generate clients from — no more reading route handlers by hand.
- Developers get self-hosted Scalar API docs inside the app, updated automatically
  because the spec is generated, not authored.
- CI catches contract drift automatically: a route whose response stops matching its
  declared schema fails Schemathesis before it reaches a consumer.
- Near-zero cost and fully dormant for non-consumer forks — the generation layer and
  CI job add nothing to a fork that never exposes `/api/v1`.
- Reinforces the Secure + Maintainable pillars: one source of truth (zod), no
  duplicated schema, a gate rather than prose.

### Negative

- Rich spec output requires per-schema OpenAPI metadata annotations in
  `lib/validations/` — a small, ongoing authoring cost as new entities are added.
- Three new dev/tool dependencies (`zod-openapi` runtime + Scalar UI + Schemathesis
  in CI) to keep current under the ADR-017 dependency cadence.
- Schemathesis needs a reachable deployed/preview URL and seeded auth to fuzz
  authenticated routes — CI wiring, not free.
- The spec is only as complete as the schemas registered; an unregistered route is
  invisible to the contract (mitigated below).

### Mitigations

- Ship a `lib/openapi/` registry helper so registering a route's schema is one line;
  `/scaffold-entity` can emit the OpenAPI metadata for new entities so coverage grows
  by default rather than by remembering.
- Keep `@asteasolutions/zod-to-openapi` as the documented drop-in fallback (same
  architecture, one dependency swap) if `zod-openapi` stalls.
- Scope Schemathesis to the `/api/v1` seam with a seeded machine token; run it
  non-blocking first (report-only), promote to a hard CI gate once green — mirrors
  the dormant-then-enforced posture of the existing gates.
- Fold the Scalar docs page into the Fumadocs docs site (sweep §1) if/when a fork
  adopts it, so API reference and prose docs share one surface.

## Alternatives considered

See Considered options.

1. **@asteasolutions/zod-to-openapi** — viable, kept as the fallback; heavier
   registry threading and a weaker 3.1 story than `zod-openapi`.
2. **Hand-written OpenAPI spec** — duplicates every schema, drifts by default, no
   gate — rejected against the zero-duplication driver.
3. **tRPC** — abandons the language-agnostic REST contract the `/api/v1` seam exists
   for and produces no OpenAPI document — rejected against the seam's purpose and the
   locked stack.

## Migration triggers

Revisit this decision when any of:

- A fork's `/api/v1` seam gains its first real external machine consumer (moves the
  Schemathesis job from report-only to a hard CI gate).
- `zod-openapi` is abandoned or its OpenAPI 3.1 support regresses — switch to the
  `@asteasolutions/zod-to-openapi` fallback (same architecture).
- The template pivots its API layer from REST + zod to typesafe RPC (would require a
  superseding stack ADR against ADR-001/012 and retire this seam).
- A fork adopts the Fumadocs docs site (sweep §1) — fold the Scalar reference into it
  rather than serving a standalone page.
- Contract testing needs to graduate from spec-drift fuzzing to consumer-driven
  contracts across multiple services (Pact territory) — an estate-level concern, not
  a single deploy-per-tenant fork.

## Related

- **ADR-013** — public API versioning (`/api/v1/*`) and the machine-consumer auth
  seam (`withApiAuth`); this ADR gives that seam its contract.
- **ADR-012** — REST + zod boundary; the schemas this spec is generated from.
- **ADR-001** — locked stack + zod-at-every-boundary; the invariant that makes the
  spec free.
- **ADR-017** — dependency cadence (keeps the three new deps in-range).
- `docs/research/v2/20-remaining-sweep.md` §7a — the OpenAPI + contract-testing
  benchmark and P1 verdict this ADR implements.
- Blueprint: `docs/blueprints/openapi-contract-seam.md`.
